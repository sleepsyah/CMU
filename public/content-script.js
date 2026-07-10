const MIN_ARTICLE_WORDS = 90;
const MIN_ARTICLE_SENTENCES = 2;

function cleanInline(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countWords(text) {
  return cleanInline(text).split(/\s+/).filter(Boolean).length;
}

function countSentences(text) {
  return (cleanInline(text).match(/[.!?](?:\s|$)/g) || []).length;
}

function isVisible(element) {
  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isCongressBillUrl(url) {
  return /^https?:\/\/(?:www\.)?congress\.gov\/bill\/\d+/i.test(url);
}

function metaContent(selector) {
  return document.querySelector(selector)?.getAttribute("content") || "";
}

function hasArticleMetadata() {
  const type = metaContent('meta[property="og:type"], meta[name="og:type"]').toLowerCase();
  return (
    type.includes("article") ||
    Boolean(document.querySelector('meta[property="article:published_time"], meta[name="article:published_time"]')) ||
    Boolean(document.querySelector("[itemtype*='NewsArticle'], [itemtype*='Article']"))
  );
}

function isLikelyIndexPage(url) {
  try {
    const parsed = new URL(url);
    const pathParts = parsed.pathname.split("/").filter(Boolean);
    return pathParts.length <= 1 && !hasArticleMetadata() && !isCongressBillUrl(url);
  } catch {
    return false;
  }
}

function isNoisyBlock(text) {
  return /^(advertisement|subscribe|log in|sign up|create account|listen to this article|share full article|skip to content|live updates?)$/i.test(text);
}

function cleanReadableBlock(text) {
  const value = cleanInline(text);
  const machineMarker = value.search(/(?:\bArray\s*\(\s*(?:\[[^\]]+\]\s*=>)?|\[(?:actionDate|displayText|externalActionCode|description|chamberOfAction|type|text)\]\s*=>|\b(?:Introduced|Passed(?:\/agreed to)?|Became Law|Committee)Array\s*\()/i);
  const readable = machineMarker >= 0 ? value.slice(0, machineMarker) : value;
  return readable.replace(/\s*\|?\s*Get alerts\s*$/i, "").trim();
}

function cleanReadableText(text) {
  return String(text || "")
    .split(/\r?\n+/)
    .map(cleanReadableBlock)
    .filter(Boolean)
    .join("\n\n");
}

function isUsefulBlock(text) {
  const value = cleanInline(text);
  const words = countWords(value);
  if (value.length < 35 || words < 7 || isNoisyBlock(value)) return false;
  if (!/[.!?]/.test(value) && words < 14) return false;
  return true;
}

function collectReadableBlocks(root) {
  const cloned = root.cloneNode(true);
  cloned
    .querySelectorAll(
      "script, style, nav, footer, header, aside, form, button, iframe, noscript, svg, canvas, picture, video, [hidden], [aria-hidden='true'], [role='navigation']"
    )
    .forEach((node) => node.remove());

  const blocks = [];
  const seen = new Set();
  const blockNodes = cloned.querySelectorAll("h1, h2, p, li, blockquote, [data-testid*='paragraph'], [class*='paragraph']");

  for (const node of blockNodes) {
    const text = cleanReadableBlock(node.innerText || node.textContent || "");
    const key = text.toLowerCase();
    if (!isUsefulBlock(text) || seen.has(key)) continue;
    seen.add(key);
    blocks.push(text);
  }

  if (blocks.length >= 2) return blocks.join("\n\n");
  return cleanReadableText(cloned.innerText || cloned.textContent || "");
}

function linkDensity(element, text) {
  const linkText = Array.from(element.querySelectorAll("a"))
    .map((anchor) => cleanInline(anchor.textContent || ""))
    .join(" ");
  return text.length ? linkText.length / text.length : 1;
}

function scoreCandidate(element, text) {
  const words = countWords(text);
  const sentences = countSentences(text);
  const paragraphs = text.split(/\n{2,}/).filter(Boolean).length;
  const densityPenalty = linkDensity(element, text) * 180;
  return words + sentences * 35 + paragraphs * 18 - densityPenalty;
}

function extractReadableText() {
  if (isLikelyIndexPage(location.href)) return "";

  const selectors = [
    "article",
    "main article",
    "[role='article']",
    "[itemprop='articleBody']",
    "[data-testid='article-body']",
    "[data-testid='story-body']",
    "[data-testid*='article']",
    ".article-body",
    ".story-body",
    ".entry-content",
    ".post-content",
    "main"
  ];

  const candidates = [
    ...selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector))),
    ...(isCongressBillUrl(location.href) || hasArticleMetadata() ? [document.body] : [])
  ].filter(Boolean);

  let best = { text: "", score: Number.NEGATIVE_INFINITY };
  for (const candidate of candidates) {
    if (!isVisible(candidate)) continue;
    const text = collectReadableBlocks(candidate);
    const score = scoreCandidate(candidate, text);
    if (score > best.score) best = { text, score };
  }

  const words = countWords(best.text);
  const sentences = countSentences(best.text);
  if (!isCongressBillUrl(location.href) && (words < MIN_ARTICLE_WORDS || sentences < MIN_ARTICLE_SENTENCES)) {
    return "";
  }

  return best.text.slice(0, 30000);
}

function sourceNameFromLocation() {
  const siteName = cleanInline(metaContent('meta[property="og:site_name"], meta[name="application-name"]'));
  if (siteName) return siteName;
  const host = location.hostname.replace(/^www\./, "");
  const parts = host.split(".");
  if (parts.length <= 2) return parts[0] || host;
  const countryCodeSuffix = parts.at(-1)?.length === 2 && ["co", "com", "org", "net", "gov", "ac"].includes(parts.at(-2));
  return (countryCodeSuffix ? parts.at(-3) : parts.at(-2)) || parts[0] || host;
}

function canonicalUrl() {
  const value = document.querySelector('link[rel="canonical"]')?.href;
  return /^https?:/.test(value || "") ? value : location.href;
}

function authorName() {
  const value = cleanInline(
    metaContent('meta[name="author"], meta[property="article:author"], meta[name="byl"]') ||
      document.querySelector('[rel="author"], [itemprop="author"]')?.textContent
  );
  return /^https?:/i.test(value) ? "" : value.replace(/^by\s+/i, "");
}

function publishedAt() {
  return cleanInline(
    metaContent('meta[property="article:published_time"], meta[name="article:published_time"], meta[name="date"], meta[itemprop="datePublished"]') ||
      document.querySelector('time[datetime]')?.getAttribute("datetime")
  );
}

function collectLinks() {
  return Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => ({
      text: cleanInline(anchor.textContent || ""),
      href: anchor.href
    }))
    .filter((link) => link.text && /^https?:/.test(link.href))
    .slice(0, 30);
}

function hasStrongBillLanguage(text) {
  return (
    /\bA bill to\b/i.test(text) ||
    /\bBe it enacted by the Senate and House\b/i.test(text) ||
    (/\bSECTION\s+1\b/i.test(text) && /\b(amend|authorize|require|prohibit|appropriate|establish)\b/i.test(text))
  );
}

function classify(url, text) {
  if (isCongressBillUrl(url)) return "bill";
  if (isLikelyIndexPage(url) || !text.trim()) return "unsupported";

  const hasBillIdentifier = /\b(H\.R\.|S\.|H\.Res\.|S\.Res\.)\s?\d+\b/i.test(text);
  if (hasBillIdentifier && hasStrongBillLanguage(text)) return "bill";

  if (countWords(text) < MIN_ARTICLE_WORDS || countSentences(text) < MIN_ARTICLE_SENTENCES) return "unknown";
  if (/\b(said|according to|reported|article|published|spokesperson)\b/i.test(text)) return "article";
  return "article";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "ELLIPSIS_EXTRACT_PAGE") return false;

  try {
    const text = extractReadableText();
    const payload = {
      title: cleanInline(document.title) || "Untitled page",
      url: canonicalUrl(),
      sourceName: sourceNameFromLocation(),
      author: authorName(),
      publishedAt: publishedAt(),
      text,
      contentType: classify(location.href, text),
      links: collectLinks()
    };
    sendResponse({ ok: true, payload });
  } catch (error) {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : "Unable to extract page text."
    });
  }

  return true;
});
