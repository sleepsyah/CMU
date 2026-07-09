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
    response = await chrome.tabs.sendMessage(tab.id, { type: "UNFRAMED_EXTRACT_PAGE" });
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content-script.js"] });
      response = await chrome.tabs.sendMessage(tab.id, { type: "UNFRAMED_EXTRACT_PAGE" });
    } catch {
      throw new Error("unframed cannot read this page. If you navigated after opening the panel, click the extension icon again, or use Manual Paste.");
    }
  }
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to extract this page. Try the manual paste fallback.");
  }

  return response.payload as ExtractedPage;
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
