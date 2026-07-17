import type { ExtractedPage } from "../types";

function fallbackPage(): ExtractedPage {
  return {
    title: "Manual analysis",
    url: "manual://paste",
    sourceName: "Manual paste",
    author: "",
    publishedAt: "",
    text: "",
    contentType: "unknown",
    links: []
  };
}

export async function extractActivePage(): Promise<ExtractedPage> {
  if (typeof chrome === "undefined" || !chrome.tabs?.query) {
    throw new Error("Chrome extension APIs are unavailable. Use manual paste while previewing in a browser.");
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab was found.");

  let response;
  try {
    response = await chrome.tabs.sendMessage(tab.id, { type: "ELLIPSIS_EXTRACT_PAGE" });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "ELLIPSIS_EXTRACT_PAGE" });
    } catch {
      if (!siteAccessPattern(tab.url || "")) {
        throw new Error("Ellipsis cannot read browser settings, extension pages, or other protected pages. Open a normal article or use Manual Paste.");
      }
      throw new Error("This site blocked article extraction. Reload the page once after updating Ellipsis, then try again or use Manual Paste.");
    }
  }
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to extract this page. Try the manual paste fallback.");
  }

  return response.payload as ExtractedPage;
}

export async function highlightActivePagePassage(text: string): Promise<boolean> {
  const excerpt = text.trim();
  if (!excerpt || typeof chrome === "undefined" || !chrome.tabs?.query) return false;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !siteAccessPattern(tab.url || "")) return false;

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: "ELLIPSIS_HIGHLIGHT_TEXT", text: excerpt });
    return Boolean(response?.ok);
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
      const response = await chrome.tabs.sendMessage(tab.id, { type: "ELLIPSIS_HIGHLIGHT_TEXT", text: excerpt });
      return Boolean(response?.ok);
    } catch {
      return false;
    }
  }
}

export function siteAccessPattern(url: string) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return `${parsed.protocol}//${parsed.host}/*`;
  } catch {
    return null;
  }
}

export function createManualPage(
  text: string,
  contentType: ExtractedPage["contentType"],
  metadata: { title?: string; url?: string; sourceName?: string } = {}
): ExtractedPage {
  return {
    ...fallbackPage(),
    title: metadata.title?.trim() || "Manual analysis",
    url: metadata.url?.trim() || "manual://paste",
    sourceName: metadata.sourceName?.trim() || "Manual paste",
    text,
    contentType
  };
}
