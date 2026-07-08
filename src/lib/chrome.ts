import type { ExtractedPage } from "../types";

function fallbackPage(): ExtractedPage {
  return {
    title: "Manual analysis",
    url: "manual://paste",
    sourceName: "Manual paste",
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

  const response = await chrome.tabs.sendMessage(tab.id, { type: "UNFRAMED_EXTRACT_PAGE" });
  if (!response?.ok) {
    throw new Error(response?.error || "Unable to extract this page. Try the manual paste fallback.");
  }

  return response.payload as ExtractedPage;
}

export function createManualPage(text: string, contentType: ExtractedPage["contentType"]): ExtractedPage {
  return {
    ...fallbackPage(),
    text,
    contentType
  };
}
