const MIN_ARTICLE_WORDS = 90;
const MIN_ARTICLE_SENTENCES = 2;
const HIGHLIGHT_CLASS = "ellipsis-source-highlight";
const HIGHLIGHT_STYLE_ID = "ellipsis-source-highlight-style";
const ARTICLE_BODY_SELECTORS = [
  "[itemprop='articleBody']",
  "[data-testid='article-body']",
  "[data-testid='story-body']",
  ".article-body",
  ".story-body",
  ".entry-content",
  ".post-content"
];
const ARTICLE_CONTAINER_SELECTORS = ["article", "[role='article']"];
const NON_ARTICLE_SELECTOR = [
  "script", "style", "nav", "footer", "header", "aside", "form", "button", "iframe", "noscript",
  "svg", "canvas", "picture", "video", "figcaption", "[hidden]", "[aria-hidden='true']", "[role='navigation']",
  "[role='complementary']", "[aria-modal='true']", "[aria-label*='cookie' i]", "[aria-label*='consent' i]",
  "[aria-label*='related' i]", "[aria-label*='recommended' i]", "[aria-label*='advertisement' i]",
  "[data-testid*='advertisement' i]", "[data-testid*='related' i]", "[id*='cookie' i]", "[id*='consent' i]",
  "[id*='related' i]", "[id*='recommend' i]", "[id*='recircul' i]", "[id*='most-read' i]",
  "[class*='cookie' i]", "[class*='consent' i]", "[class*='related' i]", "[class*='recommend' i]",
  "[class*='recircul' i]", "[class*='most-read' i]", "[class*='newsletter' i]", "[class*='comments' i]",
  "[class*='promo' i]"
].join(", ");

function cleanInline(value) {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForSearch(value) {
  return normalizedIndexMap(String(value || "")).normalized;
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
  return /^(advertisement|subscribe|log in|sign up|create account|listen to this article|share full article|skip to content|live updates?|link copied|read full bio|add .+ on google)$/i.test(text) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+is\s+(?:an?|the)\s+.{0,120}\b(?:editor|journalist|reporter|correspondent)\b/i.test(text) ||
    /^(?:[A-Z][\w.'’–-]+(?:\s+[A-Z][\w.'’–-]+){0,4})\s+has\s+(?:worked|covered|reported)\b/i.test(text);
}

function isArticleBoundaryHeading(text) {
  return /^(?:related(?: stories| articles| coverage)?|recommended(?: for you)?|more (?:from|on|stories)|read (?:more|next)|also read|most (?:read|popular)|latest (?:news|stories)|you may also like|what to read next)$/i.test(cleanInline(text));
}

function articleHeadline() {
  return cleanInline(
    metaContent('meta[property="og:title"], meta[name="twitter:title"]') ||
      document.querySelector('[itemprop="headline"], article h1, main h1, h1')?.textContent ||
      document.title
  ) || "Untitled page";
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

function collectReadableBlocks(root, options = {}) {
  const cloned = root.cloneNode(true);
  cloned.querySelectorAll(NON_ARTICLE_SELECTOR).forEach((node) => node.remove());

  const blocks = [];
  const seen = new Set();
  const blockNodes = cloned.querySelectorAll("h2, h3, p, li, blockquote, [data-testid*='paragraph'], [class*='paragraph']");

  for (const node of blockNodes) {
    const text = cleanReadableBlock(node.innerText || node.textContent || "");
    if (/^H[23]$/.test(node.tagName) && isArticleBoundaryHeading(text)) break;
    const key = text.toLowerCase();
    if (!isUsefulBlock(text) || seen.has(key)) continue;
    if (node.querySelectorAll?.("a").length && linkDensity(node, text) > 0.65) continue;
    seen.add(key);
    blocks.push(text);
  }

  if (blocks.length >= 2) return blocks.join("\n\n");
  return options.allowRawFallback ? cleanReadableText(cloned.innerText || cloned.textContent || "") : blocks.join("\n\n");
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
  const semanticBonus = element.matches("article, [role='article'], [itemprop='articleBody'], [data-testid='article-body'], [data-testid='story-body']") ? 500 : 0;
  const broadContainerPenalty = element === document.body ? words * 0.45 : element.tagName === "MAIN" ? words * 0.12 : 0;
  return words + sentences * 35 + paragraphs * 18 + semanticBonus - densityPenalty - broadContainerPenalty;
}

function uniqueVisibleCandidates(selectors) {
  return selectors
    .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
    .filter((candidate, index, all) => isVisible(candidate) && all.indexOf(candidate) === index);
}

function firstVisibleCandidateGroup(selectors) {
  for (const selector of selectors) {
    const candidates = uniqueVisibleCandidates([selector]);
    if (candidates.length) return candidates;
  }
  return [];
}

function bestCandidateText(candidates, options = {}) {
  let best = { text: "", score: Number.NEGATIVE_INFINITY };
  for (const candidate of candidates) {
    const text = collectReadableBlocks(candidate, options);
    const score = scoreCandidate(candidate, text);
    if (score > best.score) best = { text, score };
  }
  return best.text;
}

function extractReadableText(headline = articleHeadline()) {
  if (isLikelyIndexPage(location.href)) return "";

  if (isCongressBillUrl(location.href)) return bestCandidateText([document.querySelector("main"), document.body].filter(Boolean), { allowRawFallback: true });

  // Prefer a publisher's explicit story-body boundary. Broader article/main containers
  // often include cookie notices and recirculated headlines after the story.
  const bodyCandidates = firstVisibleCandidateGroup(ARTICLE_BODY_SELECTORS);
  const articleCandidates = uniqueVisibleCandidates(ARTICLE_CONTAINER_SELECTORS);
  const mainCandidates = hasArticleMetadata() ? uniqueVisibleCandidates(["main"]) : [];
  const body = bestCandidateText(bodyCandidates.length ? bodyCandidates : articleCandidates.length ? articleCandidates : mainCandidates);
  const normalizedHeadline = normalizeForSearch(headline);
  const bodyWithoutDuplicateHeadline = body
    .split(/\n{2,}/)
    .filter((block) => normalizeForSearch(block) !== normalizedHeadline)
    .join("\n\n");
  const text = [headline, bodyWithoutDuplicateHeadline].filter(Boolean).join("\n\n");

  const words = countWords(text);
  const sentences = countSentences(bodyWithoutDuplicateHeadline);
  if (!isCongressBillUrl(location.href) && (words < MIN_ARTICLE_WORDS || sentences < MIN_ARTICLE_SENTENCES)) {
    return "";
  }

  return text;
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
    const rawChar = text[index];
    const char = canonicalSearchCharacter(rawChar);
    if (!char) continue;
    if (/\s/.test(char)) {
      if (!inWhitespace && normalized.length > 0) {
        normalized += " ";
        map.push(index);
      }
      inWhitespace = true;
    } else {
      const lowered = char.toLowerCase();
      normalized += lowered;
      for (let mappedIndex = 0; mappedIndex < lowered.length; mappedIndex += 1) map.push(index);
      inWhitespace = false;
    }
  }
  return { normalized: normalized.trim(), map };
}

function canonicalSearchCharacter(char) {
  if (/[\u200B-\u200D\uFEFF]/.test(char)) return "";
  if (/[\u2018\u2019\u201A\u201B\u2032\u00B4`]/.test(char)) return "'";
  if (/[\u201C\u201D\u201E\u201F\u2033]/.test(char)) return '"';
  if (/[\u2010-\u2015\u2212]/.test(char)) return "-";
  if (char === "\u2026") return "...";
  return char;
}

function wordSearchText(value) {
  return normalizeForSearch(value)
    .replace(/[^\p{L}\p{N}']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function candidateMatchScore(candidateText, excerpt) {
  const candidate = normalizeForSearch(candidateText);
  const target = normalizeForSearch(excerpt);
  if (!candidate || !target) return 0;
  if (candidate.includes(target)) return 1000 + Math.min(target.length, 500);

  const candidateWords = wordSearchText(candidateText);
  const targetWords = wordSearchText(excerpt).split(" ").filter(Boolean);
  if (targetWords.length < 4) return 0;
  const largestWindow = Math.min(10, targetWords.length);
  for (let size = largestWindow; size >= 4; size -= 1) {
    for (let start = 0; start <= targetWords.length - size; start += 1) {
      if (candidateWords.includes(targetWords.slice(start, start + size).join(" "))) return 100 + size;
    }
  }
  return 0;
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

function searchablePassageElements() {
  const selector = [
    "article p", "article li", "article blockquote",
    "main p", "main li", "main blockquote",
    "[itemprop='articleBody'] p", "[itemprop='articleBody'] blockquote",
    "[data-testid*='paragraph' i]", "[data-testid*='story-text' i]",
    "[data-component*='text-block' i]", "[class*='paragraph' i]",
    "p", "li", "blockquote"
  ].join(", ");
  return Array.from(document.querySelectorAll(selector))
    .filter((element) => isVisible(element) && cleanInline(element.textContent || "").length >= 12);
}

function rankedPassageCandidates(elements, excerpt) {
  return elements
    .map((element) => ({ element, score: candidateMatchScore(element.textContent || "", excerpt) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || (left.element.textContent || "").length - (right.element.textContent || "").length);
}

function highlightSourceText(excerpt) {
  ensureHighlightStyle();
  clearSourceHighlights();

  const target = normalizeForSearch(excerpt);
  if (!target) return false;
  const relevantSentences = excerptSentences(excerpt, 3);
  const fullPassage = relevantSentences.join(" ");
  const elements = searchablePassageElements();

  for (const { element } of rankedPassageCandidates(elements, fullPassage)) {
    const mark = highlightWithinElement(element, fullPassage, false);
    if (!mark) continue;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(removeTemporaryHighlights, 7000);
    return true;
  }

  const passageMarks = [];
  const highlightedElements = new Set();
  for (const sentence of relevantSentences) {
    const ranked = rankedPassageCandidates(elements, sentence);
    let matched = false;
    for (const { element } of ranked) {
      const mark = highlightWithinElement(element, sentence, false);
      if (!mark) continue;
      passageMarks.push(mark);
      highlightedElements.add(element);
      matched = true;
      break;
    }
    if (matched) continue;
    const fallbackElement = ranked[0]?.element;
    if (fallbackElement && !highlightedElements.has(fallbackElement)) {
      passageMarks.push(highlightWholeElement(fallbackElement));
      highlightedElements.add(fallbackElement);
    }
  }
  if (passageMarks.length) {
    passageMarks[0].scrollIntoView({ behavior: "smooth", block: "center" });
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

// The outlet profile marks this outlet on its chart with the site's own icon.
// Reference outlets ship a packaged icon; the page being read is arbitrary, so
// read whatever it declares and fall back to the conventional path.
function siteIconUrl() {
  const links = Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]'));
  const scored = links
    .map((link) => ({
      href: link.href,
      // Prefer something near 64px: large enough to stay sharp, not a 512px asset.
      distance: Math.abs((Number.parseInt(link.getAttribute("sizes") || "", 10) || 32) - 64)
    }))
    .filter((candidate) => /^https?:/.test(candidate.href))
    .sort((a, b) => a.distance - b.distance);
  return scored[0]?.href || `${location.origin}/favicon.ico`;
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
    const title = articleHeadline();
    const text = extractReadableText(title);
    const payload = {
      title,
      url: canonicalUrl(),
      sourceName: sourceNameFromLocation(),
      iconUrl: siteIconUrl(),
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
