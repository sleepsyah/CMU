import type { FeedbackLog, SavedAnalysis } from "../types";

const HISTORY_KEY = "unframed.savedAnalyses";
const FEEDBACK_KEY = "unframed.feedbackLogs";
const MAX_HISTORY = 50;

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readValue<T>(key: string, fallback: T): Promise<T> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T | undefined) ?? fallback;
  }
  const raw = window.localStorage.getItem(key);
  return raw ? (JSON.parse(raw) as T) : fallback;
}

async function writeValue<T>(key: string, value: T): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [key]: value });
    return;
  }
  window.localStorage.setItem(key, JSON.stringify(value));
}

export async function getSavedAnalyses() {
  return readValue<SavedAnalysis[]>(HISTORY_KEY, []);
}

export async function saveAnalysis(item: SavedAnalysis, confirmDelete: () => boolean) {
  const current = await getSavedAnalyses();
  const withoutDuplicate = current.filter((saved) => saved.id !== item.id);

  if (withoutDuplicate.length >= MAX_HISTORY && !confirmDelete()) {
    return { saved: false, count: withoutDuplicate.length };
  }

  const next = [item, ...withoutDuplicate].slice(0, MAX_HISTORY);
  await writeValue(HISTORY_KEY, next);
  return { saved: true, count: next.length };
}

export async function deleteSavedAnalysis(id: string) {
  const current = await getSavedAnalyses();
  const next = current.filter((item) => item.id !== id);
  await writeValue(HISTORY_KEY, next);
  return next;
}

export async function getFeedbackLogs() {
  return readValue<FeedbackLog[]>(FEEDBACK_KEY, []);
}

export async function logFeedback(feedback: FeedbackLog) {
  const current = await getFeedbackLogs();
  const next = [feedback, ...current].slice(0, 250);
  await writeValue(FEEDBACK_KEY, next);
  return next;
}
