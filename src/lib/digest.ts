import type { BiasProfile } from "../types";
import type { InterestArea } from "./topics";

const AGGREGATE_KEY = "ellipsis.weeklyAggregate";
const CONNECT_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export type BiasLevel = BiasProfile["level"];

export interface WeeklyAggregate {
  weekOf: string; // ISO date (Monday) of the week currently being accumulated
  articlesAnalyzed: number;
  biasLevelCounts: Record<BiasLevel, number>;
  topicCounts: Partial<Record<InterestArea, number>>;
  sourceDomains: string[]; // local dedup only — never synced beyond .length
  lastSyncedWeekOf: string | null;
  lastSyncedAt: string | null;
  lastConnectPromptShownAt: string | null;
}

export interface PendingDigest {
  weekOf: string;
  articlesAnalyzed: number;
  biasLevelCounts: Record<BiasLevel, number>;
  topicCounts: Partial<Record<InterestArea, number>>;
  sourceCount: number;
}

function emptyAggregate(weekOf: string): WeeklyAggregate {
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

/** ISO date (YYYY-MM-DD) of the Monday starting the given date's week, local time. */
export function currentWeekOf(date = new Date()): string {
  const day = date.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + diffToMonday);
  const y = monday.getFullYear();
  const m = String(monday.getMonth() + 1).padStart(2, "0");
  const d = String(monday.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function hasChromeStorage() {
  return typeof chrome !== "undefined" && Boolean(chrome.storage?.local);
}

async function readAggregate(): Promise<WeeklyAggregate> {
  if (hasChromeStorage()) {
    const result = await chrome.storage.local.get(AGGREGATE_KEY);
    return (result[AGGREGATE_KEY] as WeeklyAggregate | undefined) ?? emptyAggregate(currentWeekOf());
  }
  const raw = window.localStorage.getItem(AGGREGATE_KEY);
  return raw ? (JSON.parse(raw) as WeeklyAggregate) : emptyAggregate(currentWeekOf());
}

async function writeAggregate(aggregate: WeeklyAggregate): Promise<void> {
  if (hasChromeStorage()) {
    await chrome.storage.local.set({ [AGGREGATE_KEY]: aggregate });
    return;
  }
  window.localStorage.setItem(AGGREGATE_KEY, JSON.stringify(aggregate));
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/**
 * Rolls the aggregate onto the current week if the stored week has passed.
 * An unsynced previous week is dropped rather than merged — mixing two
 * different weeks' stats into one bucket would be misleading, and a missed
 * sync window is an acceptable trade-off for this weekly-best-effort feature.
 */
function rollIfNeeded(aggregate: WeeklyAggregate): WeeklyAggregate {
  const week = currentWeekOf();
  if (aggregate.weekOf === week) return aggregate;
  return { ...emptyAggregate(week), lastSyncedWeekOf: aggregate.lastSyncedWeekOf, lastSyncedAt: aggregate.lastSyncedAt, lastConnectPromptShownAt: aggregate.lastConnectPromptShownAt };
}

/** Records one analyzed article into the local weekly aggregate. Never stores the URL or content — only the bias level, matched topics, and source hostname (for a unique-domain count). */
export async function recordArticleAnalysis(params: {
  biasLevel: BiasLevel;
  topics: InterestArea[];
  sourceUrl: string;
}): Promise<void> {
  const aggregate = rollIfNeeded(await readAggregate());
  const hostname = hostnameOf(params.sourceUrl);

  aggregate.articlesAnalyzed += 1;
  aggregate.biasLevelCounts[params.biasLevel] += 1;
  for (const topic of params.topics) {
    aggregate.topicCounts[topic] = (aggregate.topicCounts[topic] ?? 0) + 1;
  }
  if (hostname && !aggregate.sourceDomains.includes(hostname)) {
    aggregate.sourceDomains.push(hostname);
  }

  await writeAggregate(aggregate);
}

/** Returns the current week's aggregate if it hasn't been synced yet, or null if there's nothing pending. */
export async function getPendingDigest(): Promise<PendingDigest | null> {
  const aggregate = rollIfNeeded(await readAggregate());
  if (aggregate.articlesAnalyzed === 0 || aggregate.weekOf === aggregate.lastSyncedWeekOf) return null;
  return {
    weekOf: aggregate.weekOf,
    articlesAnalyzed: aggregate.articlesAnalyzed,
    biasLevelCounts: aggregate.biasLevelCounts,
    topicCounts: aggregate.topicCounts,
    sourceCount: aggregate.sourceDomains.length
  };
}

/** Marks a week as synced and resets counters for the next week. */
export async function confirmSync(weekOf: string): Promise<void> {
  const aggregate = rollIfNeeded(await readAggregate());
  const next = emptyAggregate(currentWeekOf());
  next.lastSyncedWeekOf = weekOf;
  next.lastSyncedAt = new Date().toISOString();
  next.lastConnectPromptShownAt = aggregate.lastConnectPromptShownAt;
  await writeAggregate(next);
}

export async function getSyncStatusLabel(): Promise<string> {
  const aggregate = await readAggregate();
  if (!aggregate.lastSyncedAt) return "Not connected to dashboard";
  const days = Math.floor((Date.now() - new Date(aggregate.lastSyncedAt).getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Reading digest synced today";
  if (days === 1) return "Reading digest synced 1 day ago";
  return `Reading digest synced ${days} days ago`;
}

/** Whether to show the once-a-week "Connect to Dashboard" prompt to a not-yet-connected user. */
export async function shouldShowConnectPrompt(): Promise<boolean> {
  const aggregate = await readAggregate();
  if (aggregate.lastSyncedAt) return false;
  if (!aggregate.lastConnectPromptShownAt) return true;
  return Date.now() - new Date(aggregate.lastConnectPromptShownAt).getTime() > CONNECT_PROMPT_INTERVAL_MS;
}

export async function markConnectPromptShown(): Promise<void> {
  const aggregate = rollIfNeeded(await readAggregate());
  aggregate.lastConnectPromptShownAt = new Date().toISOString();
  await writeAggregate(aggregate);
}
