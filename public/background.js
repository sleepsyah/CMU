chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const CODEX_HOST = "com.ellipsis.codex";
const pendingNativeRequests = new Map();
let nativePort = null;

function rejectPendingNativeRequests(message) {
  for (const pending of pendingNativeRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  pendingNativeRequests.clear();
}

function connectNativeHost() {
  if (nativePort) return nativePort;
  const port = chrome.runtime.connectNative(CODEX_HOST);
  nativePort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "progress" && message.event) {
      chrome.runtime.sendMessage({ type: "ellipsis.codex.progress", event: message.event }).catch(() => {});
      return;
    }
    const pending = pendingNativeRequests.get(message?.id);
    if (!pending) return;
    pendingNativeRequests.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message?.error?.message || "Ellipsis AI Connector failed."));
  });
  port.onDisconnect.addListener(() => {
    const message = chrome.runtime.lastError?.message || "Ellipsis AI Connector disconnected.";
    nativePort = null;
    const lowerMessage = message.toLowerCase();
    rejectPendingNativeRequests(lowerMessage.includes("host not found")
      ? "Ellipsis AI Connector is not registered for this extension. Open the connector app once, reload Ellipsis, then press Connect Codex."
      : lowerMessage.includes("native host has exited")
        ? "Ellipsis AI Connector started but exited before Codex responded. Reopen the connector app once to repair its registration, then try again."
        : message);
  });
  return port;
}

function requestNative(action, payload) {
  const port = connectNativeHost();
  const id = crypto.randomUUID();
  const timeoutMs = action === "analyze" ? null : 20_000;
  return new Promise((resolve, reject) => {
    const timeout = timeoutMs === null ? undefined : setTimeout(() => {
      pendingNativeRequests.delete(id);
      if (nativePort === port) {
        try { port.disconnect(); } catch {}
        nativePort = null;
      }
      reject(new Error(`Ellipsis AI Connector timed out during ${action}.`));
    }, timeoutMs);
    pendingNativeRequests.set(id, { resolve, reject, timeout });
    try {
      port.postMessage({ id, action, payload });
    } catch (error) {
      clearTimeout(timeout);
      pendingNativeRequests.delete(id);
      reject(error);
    }
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ellipsis.codex.request") {
    requestNative(message.action, message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Ellipsis AI Connector failed." }));
    return true;
  }
  return false;
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: "sidepanel/index.html",
    enabled: true
  });
  await chrome.sidePanel.open({ tabId: tab.id });
});
