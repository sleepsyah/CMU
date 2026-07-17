import { classifyPastedText } from "./analysis";
import type { ExtractedPage } from "../types";

const MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;
const ARTICLE_BODY_SELECTOR = "[itemprop='articleBody'], [data-testid='article-body'], [data-testid='story-body'], .article-body, .story-body, .entry-content, .post-content";
const ARTICLE_CONTAINER_SELECTOR = "article, [role='article']";
const NON_ARTICLE_SELECTOR = [
  "script", "style", "nav", "footer", "header", "aside", "form", "button", "iframe", "noscript", "svg", "canvas", "video",
  "[hidden]", "[aria-hidden='true']", "[role='navigation']", "[role='complementary']", "[aria-modal='true']",
  "[aria-label*='cookie' i]", "[aria-label*='consent' i]", "[aria-label*='related' i]", "[aria-label*='recommended' i]",
  "[id*='cookie' i]", "[id*='consent' i]", "[id*='related' i]", "[id*='recommend' i]", "[id*='recircul' i]", "[id*='most-read' i]",
  "[class*='cookie' i]", "[class*='consent' i]", "[class*='related' i]", "[class*='recommend' i]", "[class*='recircul' i]",
  "[class*='most-read' i]", "[class*='newsletter' i]", "[class*='comments' i]"
].join(", ");

export async function fetchPageFromUrl(value: string): Promise<ExtractedPage> {
  const url = normalizeWebUrl(value);
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      credentials: "omit",
      redirect: "follow",
      referrerPolicy: "no-referrer",
      headers: { Accept: "text/html,application/xhtml+xml,text/plain;q=0.8" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`The page returned ${response.status}. Open it in a tab or paste the text instead.`);

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (contentLength > MAX_RESPONSE_BYTES) throw new Error("The page is too large to analyze from a link. Open it in a tab or paste the relevant text.");
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !/html|xhtml|text\/plain/i.test(contentType)) {
      throw new Error("This link is not a readable HTML or text page.");
    }

    const html = await response.text();
    if (html.length > MAX_RESPONSE_BYTES) throw new Error("The page is too large to analyze from a link. Open it in a tab instead.");
    return extractPageFromHtml(html, response.url || url);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The page took too long to respond. Open it in a tab or paste the text instead.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function normalizeWebUrl(value: string) {
  const candidate = value.trim();
  if (!candidate) throw new Error("Enter an article or Congress.gov bill link.");
  if (/^[a-z][a-z\d+.-]*:/i.test(candidate) && !/^https?:\/\//i.test(candidate)) {
    throw new Error("Only http:// and https:// links are supported.");
  }
  let parsed: URL;
  try {
    parsed = new URL(/^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`);
  } catch {
    throw new Error("Enter a valid http:// or https:// link.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Only http:// and https:// links are supported.");
  return parsed.toString();
}

export function extractPageFromHtml(html: string, url: string): ExtractedPage {
  const document = new DOMParser().parseFromString(html, "text/html");
  const title = cleanInline(
    meta(document, 'meta[property="og:title"], meta[name="twitter:title"]') ||
    document.querySelector('[itemprop="headline"], article h1, main h1, h1')?.textContent ||
    document.title
  ) || "Untitled page";
  const root = firstMatchingRoot(document, ARTICLE_BODY_SELECTOR.split(", ")) || document.querySelector(ARTICLE_CONTAINER_SELECTOR) || document.querySelector("main");
  if (!root) throw new Error("The link did not expose a distinct article body. Open the page in a tab or paste the article text instead.");
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(NON_ARTICLE_SELECTOR).forEach((node) => node.remove());

  const blocks: string[] = [];
  const seen = new Set<string>();
  const blockNodes = Array.from(clone.querySelectorAll("h2, h3, p, li, blockquote"));
  for (const node of blockNodes) {
    const text = cleanReadableBlock(node.textContent || "");
    if (/^H[23]$/.test(node.tagName) && isArticleBoundaryHeading(text)) break;
    const key = text.toLowerCase();
    if (text.length < 35 || countWords(text) < 7 || seen.has(key) || isNoise(text)) continue;
    if (node.querySelectorAll("a").length && linkedTextRatio(node, text) > 0.65) continue;
    seen.add(key);
    blocks.push(text);
  }

  const body = blocks.join("\n\n");
  const text = [title, ...body.split(/\n{2,}/).filter((block) => cleanInline(block).toLowerCase() !== title.toLowerCase())].filter(Boolean).join("\n\n");
  if (text.length < 120) throw new Error("The link did not expose enough readable text. Open the page in a tab or paste the text instead.");

  const parsedUrl = new URL(url);
  const sourceName = cleanInline(meta(document, 'meta[property="og:site_name"]') || parsedUrl.hostname.replace(/^www\./, ""));
  const author = cleanInline(meta(document, 'meta[name="author"], meta[property="article:author"]')).replace(/^by\s+/i, "");
  const publishedAt = cleanInline(
    meta(document, 'meta[property="article:published_time"], meta[name="article:published_time"], meta[name="date"]') ||
    document.querySelector("time[datetime]")?.getAttribute("datetime") || ""
  );
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href;
  const finalUrl = canonical && /^https?:\/\//i.test(canonical) ? canonical : url;

  return {
    title,
    url: finalUrl,
    sourceName,
    author,
    publishedAt,
    text,
    contentType: classifyPastedText(text, finalUrl),
    links: Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((anchor) => ({ text: cleanInline(anchor.textContent || ""), href: anchor.href }))
      .filter((link) => link.text && /^https?:\/\//i.test(link.href))
      .slice(0, 30)
  };
}

function meta(document: Document, selector: string) {
  return document.querySelector(selector)?.getAttribute("content") || "";
}

function firstMatchingRoot(document: Document, selectors: string[]) {
  for (const selector of selectors) {
    const root = document.querySelector(selector);
    if (root) return root;
  }
  return null;
}

function cleanInline(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanReadableBlock(value: string) {
  const text = cleanInline(value);
  const machineMarker = text.search(/(?:\bArray\s*\(\s*(?:\[[^\]]+\]\s*=>)?|\[(?:actionDate|displayText|externalActionCode|description|chamberOfAction|type|text)\]\s*=>|\b(?:Introduced|Passed(?:\/agreed to)?|Became Law|Committee)Array\s*\()/i);
  const readable = machineMarker >= 0 ? text.slice(0, machineMarker) : text;
  return readable.replace(/\s*\|?\s*Get alerts\s*$/i, "").trim();
}

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function linkedTextRatio(node: Element, text: string) {
  const linkedText = Array.from(node.querySelectorAll("a")).map((anchor) => cleanInline(anchor.textContent || "")).join(" ");
  return text.length ? linkedText.length / text.length : 1;
}

function isArticleBoundaryHeading(value: string) {
  return /^(?:related(?: stories| articles| coverage)?|recommended(?: for you)?|more (?:from|on|stories)|read (?:more|next)|also read|most (?:read|popular)|latest (?:news|stories)|you may also like|what to read next)$/i.test(cleanInline(value));
}

function isNoise(value: string) {
  return /^(advertisement|subscribe|log in|sign up|create account|listen to this article|share|skip to content|live updates?|link copied|read full bio|add .+ on google)$/i.test(value) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+is\s+(?:an?|the)\s+.{0,120}\b(?:editor|journalist|reporter|correspondent)\b/i.test(value) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+has\s+(?:worked|covered|reported)\b/i.test(value);
}
