import { classifyPastedText } from "./analysis";
import type { ExtractedPage } from "../types";

const MAX_RESPONSE_BYTES = 2_000_000;
const FETCH_TIMEOUT_MS = 12_000;

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
  const title = cleanInline(meta(document, 'meta[property="og:title"]') || document.title) || "Untitled page";
  const root = document.querySelector("article, [role='article'], [itemprop='articleBody'], main") || document.body;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, nav, footer, header, aside, form, button, iframe, noscript, svg, canvas, video, [hidden], [aria-hidden='true'], [role='navigation']")
    .forEach((node) => node.remove());

  const blocks: string[] = [];
  const seen = new Set<string>();
  clone.querySelectorAll("h1, h2, p, li, blockquote").forEach((node) => {
    const text = cleanReadableBlock(node.textContent || "");
    const key = text.toLowerCase();
    if (text.length < 35 || countWords(text) < 7 || seen.has(key) || isNoise(text)) return;
    seen.add(key);
    blocks.push(text);
  });

  const text = blocks.length >= 2 ? blocks.join("\n\n") : cleanReadableText(clone.textContent || "");
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

function cleanInline(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanReadableBlock(value: string) {
  const text = cleanInline(value);
  const machineMarker = text.search(/(?:\bArray\s*\(\s*(?:\[[^\]]+\]\s*=>)?|\[(?:actionDate|displayText|externalActionCode|description|chamberOfAction|type|text)\]\s*=>|\b(?:Introduced|Passed(?:\/agreed to)?|Became Law|Committee)Array\s*\()/i);
  const readable = machineMarker >= 0 ? text.slice(0, machineMarker) : text;
  return readable.replace(/\s*\|?\s*Get alerts\s*$/i, "").trim();
}

function cleanReadableText(value: string) {
  return value
    .split(/\r?\n+/)
    .map(cleanReadableBlock)
    .filter(Boolean)
    .join("\n\n");
}

function countWords(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function isNoise(value: string) {
  return /^(advertisement|subscribe|log in|sign up|create account|listen to this article|share|skip to content|live updates?|link copied|read full bio|add .+ on google)$/i.test(value) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+is\s+(?:an?|the)\s+.{0,120}\b(?:editor|journalist|reporter|correspondent)\b/i.test(value) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+has\s+(?:worked|covered|reported)\b/i.test(value);
}
