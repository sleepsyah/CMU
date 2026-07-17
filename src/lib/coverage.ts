import type { Analysis, ExtractedPage, OutletCoverageEstimate } from "../types";

const WINDOW_DAYS = 7;
const FEED_TIMEOUT_MS = 4_500;
const MAX_INDEX_URLS = 8;
const MAX_FEED_BYTES = 1_800_000;
const STOP_WORDS = new Set([
  "about", "after", "again", "against", "also", "amid", "among", "article", "because", "before", "being", "between", "could", "during", "from",
  "have", "into", "more", "news", "over", "people", "report", "said", "says", "than", "that", "their", "there", "these", "they", "this",
  "through", "under", "were", "what", "when", "where", "which", "while", "with", "would", "will", "your"
]);

interface CoverageCandidate {
  title: string;
  url: string;
  publishedAt: string;
}

export async function estimateOutletCoverage(page: ExtractedPage, analysis: Analysis): Promise<OutletCoverageEstimate | undefined> {
  if (analysis.contentType !== "article") return undefined;
  const outletHost = hostFor(page.url);
  if (!outletHost) return undefined;

  const topicTerms = topicTermsFor(analysis);
  const topicLabel = topicTerms.slice(0, 3).join(", ") || "this topic";
  const sameOutletLinks = sameOutletArticleLinks(page, outletHost);
  const sitemapCandidates = sitemapUrlsFor(page, outletHost);
  const feedCandidates = feedUrlsFor(page, outletHost);

  if (typeof DOMParser !== "undefined" && typeof fetch !== "undefined") {
    const sitemapItems = await fetchSitemapCandidates(sitemapCandidates, outletHost);
    const recentSitemapItems = sitemapItems.filter((item) => isWithinWindow(item.publishedAt, WINDOW_DAYS));
    if (recentSitemapItems.length >= 10) {
      return coverageFromCandidates({
        candidates: recentSitemapItems,
        outletHost,
        topicTerms,
        topicLabel,
        method: "dated outlet sitemap URLs",
        status: "estimated",
        note: "Estimated from dated sitemap entries published by the outlet in the past week. This is closer to a full-week count when the outlet exposes complete sitemaps, but it can still omit sections or syndicated updates."
      });
    }

    const feedResults = await Promise.all(feedCandidates.map(async (feedUrl) => ({
      feedUrl,
      recentItems: (await fetchFeedItems(feedUrl)).filter((item) => isWithinWindow(item.publishedAt, WINDOW_DAYS))
    })));
    const usableFeed = feedResults.find((result) => result.recentItems.length >= 5);
    if (usableFeed) {
      return coverageFromCandidates({
        candidates: usableFeed.recentItems,
        outletHost,
        topicTerms,
        topicLabel,
        method: `RSS/feed sample from ${new URL(usableFeed.feedUrl).pathname || "/"}`,
        status: "estimated",
        note: "Estimated from dated feed items published by the same outlet in the past week. Feeds can omit newsletters, wires, live updates, or paywalled sections."
      });
    }
  }

  if (sameOutletLinks.length >= 4) {
    return coverageFromCandidates({
      candidates: sameOutletLinks.map((link) => ({ ...link, publishedAt: "" })),
      outletHost,
      topicTerms,
      topicLabel,
      method: "same-outlet links found on the analyzed page",
      status: "limited",
      note: "Limited sample from links visible on the article page, not a full past-week outlet count."
    });
  }

  return {
    status: "unavailable",
    outletHost,
    topicLabel,
    topicTerms,
    windowDays: WINDOW_DAYS,
    relatedCount: 0,
    sampledArticleCount: 0,
    percentage: null,
    method: "no usable outlet feed or same-outlet link sample",
    sampledUrls: [],
    generatedAt: new Date().toISOString(),
    note: "Ellipsis could not estimate recent outlet coverage from accessible local sources."
  };
}

function coverageFromCandidates(input: {
  candidates: CoverageCandidate[];
  outletHost: string;
  topicTerms: string[];
  topicLabel: string;
  method: string;
  status: OutletCoverageEstimate["status"];
  note: string;
}): OutletCoverageEstimate {
  const scored = input.candidates.map((candidate) => ({ candidate, score: topicScore(`${candidate.title} ${candidate.url}`, input.topicTerms) }));
  const related = scored.filter((item) => item.score >= Math.min(2, Math.max(1, input.topicTerms.length - 1)));
  const sampledArticleCount = input.candidates.length;
  return {
    status: input.status,
    outletHost: input.outletHost,
    topicLabel: input.topicLabel,
    topicTerms: input.topicTerms,
    windowDays: WINDOW_DAYS,
    relatedCount: related.length,
    sampledArticleCount,
    percentage: sampledArticleCount ? Math.round((related.length / sampledArticleCount) * 100) : null,
    method: input.method,
    sampledUrls: related.map((item) => item.candidate.url).slice(0, 5),
    generatedAt: new Date().toISOString(),
    note: input.note
  };
}

function topicTermsFor(analysis: Analysis) {
  const text = `${analysis.pageTitle} ${analysis.mainIssue.text} ${analysis.summary}`.toLowerCase();
  const counts = new Map<string, number>();
  for (const raw of text.match(/\b[a-z][a-z-]{3,}\b/g) || []) {
    const term = raw.replace(/'s$/, "");
    if (STOP_WORDS.has(term) || /^\d+$/.test(term)) continue;
    counts.set(term, (counts.get(term) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 6)
    .map(([term]) => term);
}

function topicScore(value: string, terms: string[]) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return terms.reduce((score, term) => score + (new RegExp(`\\b${escapeRegExp(term)}s?\\b`, "i").test(normalized) ? 1 : 0), 0);
}

function sameOutletArticleLinks(page: ExtractedPage, outletHost: string) {
  const seen = new Set<string>();
  return page.links
    .map((link) => ({ title: link.text, url: normalizeUrl(link.href, page.url) }))
    .filter((link): link is { title: string; url: string } => Boolean(link.url && link.title))
    .filter((link) => {
      if (seen.has(link.url)) return false;
      seen.add(link.url);
      return hostFor(link.url) === outletHost && looksArticleLike(link.url, link.title) && link.url !== page.url;
    })
    .slice(0, 60);
}

function feedUrlsFor(page: ExtractedPage, outletHost: string) {
  const origin = originFor(page.url);
  if (!origin) return [];
  const explicit = page.links
    .filter((link) => /\b(rss|feed|atom)\b/i.test(`${link.text} ${link.href}`))
    .map((link) => normalizeUrl(link.href, page.url))
    .filter((url): url is string => Boolean(url && hostFor(url) === outletHost));
  return Array.from(new Set([
    ...explicit,
    `${origin}/feed`,
    `${origin}/rss`,
    `${origin}/rss.xml`,
    `${origin}/atom.xml`
  ])).slice(0, 5);
}

function sitemapUrlsFor(page: ExtractedPage, outletHost: string) {
  const origin = originFor(page.url);
  if (!origin) return [];
  const explicit = page.links
    .filter((link) => /\bsitemap\b/i.test(`${link.text} ${link.href}`))
    .map((link) => normalizeUrl(link.href, page.url))
    .filter((url): url is string => Boolean(url && hostFor(url) === outletHost));
  return Array.from(new Set([
    ...explicit,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/news-sitemap.xml`,
    `${origin}/sitemap-news.xml`
  ])).slice(0, 7);
}

async function fetchSitemapCandidates(sitemapUrls: string[], outletHost: string) {
  const firstPass = await Promise.all(sitemapUrls.map((url) => fetchSitemap(url)));
  const directItems = firstPass.flatMap((result) => result.items);
  const childUrls = Array.from(new Set(firstPass.flatMap((result) => result.childUrls)))
    .filter((url) => hostFor(url) === outletHost)
    .filter((url) => /news|article|post|story|sitemap/i.test(url))
    .slice(0, MAX_INDEX_URLS);
  const childItems = (await Promise.all(childUrls.map((url) => fetchSitemap(url)))).flatMap((result) => result.items);
  return dedupeCandidates([...directItems, ...childItems]).slice(0, 500);
}

async function fetchSitemap(sitemapUrl: string): Promise<{ items: CoverageCandidate[]; childUrls: string[] }> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(sitemapUrl, {
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/xml,text/xml;q=0.8" },
      signal: controller.signal
    });
    if (!response.ok) return { items: [], childUrls: [] };
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/xml|text/i.test(contentType)) return { items: [], childUrls: [] };
    return parseSitemap((await response.text()).slice(0, MAX_FEED_BYTES), sitemapUrl);
  } catch {
    return { items: [], childUrls: [] };
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseSitemap(xml: string, sitemapUrl: string) {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) return { items: [], childUrls: [] };
  const childUrls = Array.from(document.querySelectorAll("sitemap loc"))
    .map((node) => normalizeUrl(node.textContent?.trim() || "", sitemapUrl))
    .filter(Boolean);
  const items = Array.from(document.querySelectorAll("url")).map((node) => {
    const url = normalizeUrl(textFrom(node, "loc"), sitemapUrl);
    const title = textFrom(node, "news\\:title") || titleFromUrl(url);
    const publishedAt = textFrom(node, "news\\:publication_date") || textFrom(node, "lastmod");
    return { title, url, publishedAt };
  }).filter((item) => item.url && item.title && item.publishedAt);
  return { items, childUrls };
}

async function fetchFeedItems(feedUrl: string): Promise<CoverageCandidate[]> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const response = await fetch(feedUrl, {
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { Accept: "application/rss+xml,application/atom+xml,application/xml,text/xml;q=0.8" },
      signal: controller.signal
    });
    if (!response.ok) return [];
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/xml|rss|atom|text/i.test(contentType)) return [];
    const xml = (await response.text()).slice(0, MAX_FEED_BYTES);
    return parseFeed(xml, feedUrl);
  } catch {
    return [];
  } finally {
    window.clearTimeout(timeout);
  }
}

function parseFeed(xml: string, feedUrl: string): CoverageCandidate[] {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) return [];
  const nodes = Array.from(document.querySelectorAll("item, entry"));
  return nodes.map((node) => {
    const title = textFrom(node, "title");
    const link = linkFrom(node, feedUrl);
    const publishedAt = textFrom(node, "pubDate") || textFrom(node, "published") || textFrom(node, "updated") || textFrom(node, "dc\\:date");
    return { title, url: link, publishedAt };
  }).filter((item) => item.title && item.url).slice(0, 150);
}

function dedupeCandidates(items: CoverageCandidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function titleFromUrl(url: string) {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "";
    return slug.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").trim();
  } catch {
    return "";
  }
}

function textFrom(node: Element, selector: string) {
  return node.querySelector(selector)?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function linkFrom(node: Element, baseUrl: string) {
  const href = node.querySelector("link[href]")?.getAttribute("href") || textFrom(node, "link");
  return normalizeUrl(href, baseUrl) || "";
}

function isWithinWindow(value: string, days: number) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return false;
  const ageMs = Date.now() - date.valueOf();
  return ageMs >= 0 && ageMs <= days * 24 * 60 * 60 * 1000;
}

function looksArticleLike(url: string, title: string) {
  if (title.length < 12) return false;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (/\/(tag|category|author|about|contact|privacy|subscribe|newsletter|video|podcast)s?(?:\/|$)/.test(path)) return false;
    return path.split("/").filter(Boolean).length >= 2 || /\d{4}/.test(path);
  } catch {
    return false;
  }
}

function originFor(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function hostFor(value: string) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
