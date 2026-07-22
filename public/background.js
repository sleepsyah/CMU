chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

const AI_HOST = "com.ellipsis.codex";
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
  const port = chrome.runtime.connectNative(AI_HOST);
  nativePort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "progress" && message.event) {
      chrome.runtime.sendMessage({ type: "ellipsis.ai.progress", event: message.event }).catch(() => {});
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
      ? "Ellipsis AI Connector is not registered for this extension. Open the connector app once, reload Ellipsis, then reconnect your AI provider."
      : lowerMessage.includes("native host has exited")
        ? "Ellipsis AI Connector started but exited before the AI provider responded. Reopen the connector app once to repair its registration, then try again."
        : message);
  });
  return port;
}

function requestNative(action, payload) {
  const port = connectNativeHost();
  const id = crypto.randomUUID();
  const timeoutMs = action === "analyze" || action === "ensure_backend" ? null : 20_000;
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
  if (message?.type === "ellipsis.ai.request" || message?.type === "ellipsis.codex.request") {
    requestNative(message.action, message.payload)
      .then((result) => sendResponse({ ok: true, result }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : "Ellipsis AI Connector failed." }));
    return true;
  }
  return false;
});

// Mirrors src/lib/digest.ts's weekly-aggregate logic. Duplicated in plain JS
// because this file is a static service worker (public/, not built by astro)
// and can't import the TS module tree.
const DIGEST_AGGREGATE_KEY = "ellipsis.weeklyAggregate";

function emptyDigestAggregate(weekOf) {
  return {
    weekOf,
    articlesAnalyzed: 0,
    biasLevelCounts: { minimal: 0, low: 0, moderate: 0, high: 0 },
    topicCounts: {},
    sourceDomains: [],
    lastSyncedWeekOf: null,
    lastSyncedAt: null,
    lastConnectPromptShownAt: null
  };
}

function currentWeekOf(date = new Date()) {
  const day = date.getDay();
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

async function readDigestAggregate() {
  const result = await chrome.storage.local.get(DIGEST_AGGREGATE_KEY);
  return result[DIGEST_AGGREGATE_KEY] || emptyDigestAggregate(currentWeekOf());
}

async function writeDigestAggregate(aggregate) {
  await chrome.storage.local.set({ [DIGEST_AGGREGATE_KEY]: aggregate });
}

function rollDigestIfNeeded(aggregate) {
  const week = currentWeekOf();
  if (aggregate.weekOf === week) return aggregate;
  return {
    ...emptyDigestAggregate(week),
    lastSyncedWeekOf: aggregate.lastSyncedWeekOf,
    lastSyncedAt: aggregate.lastSyncedAt,
    lastConnectPromptShownAt: aggregate.lastConnectPromptShownAt
  };
}

async function getPendingDigestForRelay() {
  const aggregate = rollDigestIfNeeded(await readDigestAggregate());
  if (aggregate.articlesAnalyzed === 0 || aggregate.weekOf === aggregate.lastSyncedWeekOf) return null;
  return {
    weekOf: aggregate.weekOf,
    articlesAnalyzed: aggregate.articlesAnalyzed,
    biasLevelCounts: aggregate.biasLevelCounts,
    topicCounts: aggregate.topicCounts,
    sourceCount: aggregate.sourceDomains.length
  };
}

async function confirmDigestSyncForRelay(weekOf) {
  const aggregate = rollDigestIfNeeded(await readDigestAggregate());
  const next = emptyDigestAggregate(currentWeekOf());
  next.lastSyncedWeekOf = weekOf;
  next.lastSyncedAt = new Date().toISOString();
  next.lastConnectPromptShownAt = aggregate.lastConnectPromptShownAt;
  await writeDigestAggregate(next);
}

// unframed.co's dashboard page messages the extension directly (see
// externally_connectable in manifest.json) to pull any pending weekly
// digest and confirm once it has synced with its own session.
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === "ellipsis.requestDigest") {
    getPendingDigestForRelay()
      .then((pendingDigest) => sendResponse({ connected: true, pendingDigest }))
      .catch(() => sendResponse({ connected: true, pendingDigest: null }));
    return true;
  }
  if (message?.type === "ellipsis.confirmSync") {
    confirmDigestSyncForRelay(message.weekOf)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
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
