const MIN_ARTICLE_WORDS = 90;
const MIN_ARTICLE_SENTENCES = 2;
const HIGHLIGHT_CLASS = "ellipsis-source-highlight";
const HIGHLIGHT_STYLE_ID = "ellipsis-source-highlight-style";

function cleanInline(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(value) {
  return cleanInline(value).toLowerCase();
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

function ensureHighlightStyle() {
  if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = HIGHLIGHT_STYLE_ID;
  style.textContent = `
    .${HIGHLIGHT_CLASS} {
      background: #fff3a3 !important;
      color: inherit !important;
      border-radius: 3px !important;
      box-shadow: 0 0 0 2px #fff3a3 !important;
      scroll-margin-top: 96px !important;
      transition: background-color 180ms ease !important;
    }
  `;
  document.documentElement.appendChild(style);
}

function clearSourceHighlights() {
  document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach((mark) => {
    if (mark.tagName !== "MARK") {
      mark.classList.remove(HIGHLIGHT_CLASS);
      return;
    }
    const parent = mark.parentNode;
    if (!parent) return;
    mark.replaceWith(document.createTextNode(mark.textContent || ""));
    parent.normalize();
  });
}

function textNodesIn(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!cleanInline(node.nodeValue || "")) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

function normalizedIndexMap(text) {
  let normalized = "";
  const map = [];
  let inWhitespace = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (/\s/.test(char)) {
      if (!inWhitespace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
      }
      inWhitespace = true;
    } else {
      normalized += char.toLowerCase();
      map.push(index);
      inWhitespace = false;
    }
  }
  return { normalized: normalized.trim(), map };
}

function rangeForRawOffsets(element, startOffset, endOffset) {
  const nodes = textNodesIn(element);
  let cursor = 0;
  const range = document.createRange();
  let started = false;

  for (const node of nodes) {
    const length = node.nodeValue?.length || 0;
    const nodeStart = cursor;
    const nodeEnd = cursor + length;

    if (!started && startOffset >= nodeStart && startOffset <= nodeEnd) {
      range.setStart(node, Math.max(0, startOffset - nodeStart));
      started = true;
    }
    if (started && endOffset >= nodeStart && endOffset <= nodeEnd) {
      range.setEnd(node, Math.max(0, endOffset - nodeStart));
      return range;
    }
    cursor = nodeEnd;
  }

  return null;
}

function excerptSentences(excerpt, limit = 3) {
  const parts = cleanInline(excerpt)
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return (parts.length ? parts : [cleanInline(excerpt)]).slice(0, limit);
}

function highlightWithinElement(element, excerpt, allowSentenceFallback = true) {
  const rawText = element.textContent || "";
  const source = normalizedIndexMap(rawText);
  const target = normalizeForSearch(excerpt);
  if (!source.normalized || !target) return null;

  let start = source.normalized.indexOf(target);
  let targetLength = target.length;
  if (start < 0 && allowSentenceFallback) {
    const firstSentence = target.split(/(?<=[.!?])\s+/)[0] || target;
    start = source.normalized.indexOf(firstSentence);
    targetLength = firstSentence.length;
  }
  if (start < 0) return null;

  const rawStart = source.map[start];
  const rawEnd = source.map[start + targetLength - 1] + 1;
  const range = rangeForRawOffsets(element, rawStart, rawEnd);
  if (!range || range.collapsed) return null;

  const mark = document.createElement("mark");
  mark.className = HIGHLIGHT_CLASS;
  try {
    range.surroundContents(mark);
  } catch {
    const contents = range.extractContents();
    mark.appendChild(contents);
    range.insertNode(mark);
  }
  return mark;
}

function highlightWholeElement(element) {
  element.classList.add(HIGHLIGHT_CLASS);
  return element;
}

function removeTemporaryHighlights() {
  clearSourceHighlights();
}

function highlightSourceText(excerpt) {
  ensureHighlightStyle();
  clearSourceHighlights();

  const target = normalizeForSearch(excerpt);
  if (!target) return false;
  const relevantSentences = excerptSentences(excerpt, 3);
  const fullPassage = relevantSentences.join(" ");
  const probes = [fullPassage, ...relevantSentences]
    .map((sentence) => normalizeForSearch(sentence).slice(0, Math.min(normalizeForSearch(sentence).length, 90)))
    .filter(Boolean);

  const candidates = Array.from(document.querySelectorAll("article p, article li, article blockquote, main p, main li, main blockquote, p, li, blockquote"))
    .filter((element) => {
      const text = normalizeForSearch(element.textContent || "");
      return isVisible(element) && probes.some((probe) => text.includes(probe));
    });

  for (const candidate of candidates) {
    const mark = highlightWithinElement(candidate, fullPassage, false);
    if (!mark) continue;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(removeTemporaryHighlights, 7000);
    return true;
  }

  const sentenceMarks = [];
  for (const sentence of relevantSentences) {
    for (const candidate of candidates) {
      const mark = highlightWithinElement(candidate, sentence, false);
      if (!mark) continue;
      sentenceMarks.push(mark);
      break;
    }
  }
  if (sentenceMarks.length) {
    sentenceMarks[0].scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(removeTemporaryHighlights, 7000);
    return true;
  }

  const fallbackElement = candidates[0];
  if (fallbackElement) {
    highlightWholeElement(fallbackElement);
    fallbackElement.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(removeTemporaryHighlights, 7000);
    return true;
  }

  return false;
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
  if (message?.type === "ELLIPSIS_HIGHLIGHT_TEXT") {
    try {
      sendResponse({ ok: highlightSourceText(message.text || "") });
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : "Unable to highlight source text." });
    }
    return true;
  }

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
