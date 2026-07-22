import type { SavedArticlePayload } from "../types";
import type { BiasLevel, PendingDigest } from "./digest";
import { getUnframedConnection } from "./storage";

const configuredApiUrl = import.meta.env.PUBLIC_UNFRAMED_API_URL?.trim() || "https://unframed.co";

export interface DigestSyncPayload {
  weekOf: string;
  articlesAnalyzed: number;
  biasDistribution: Record<BiasLevel, number>;
  topTopics: Record<string, number>;
  sourceCount: number;
}

export interface SyncResult {
  ok: boolean;
  status: number;
}

async function postWithToken(path: string, body: unknown): Promise<SyncResult> {
  const { token } = await getUnframedConnection();
  if (!token) return { ok: false, status: 401 };

  try {
    const response = await fetch(`${configuredApiUrl.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function digestPayloadFromPending(pending: PendingDigest): DigestSyncPayload {
  return {
    weekOf: pending.weekOf,
    articlesAnalyzed: pending.articlesAnalyzed,
    biasDistribution: pending.biasLevelCounts,
    topTopics: pending.topicCounts as Record<string, number>,
    sourceCount: pending.sourceCount
  };
}

export function postDigest(payload: DigestSyncPayload): Promise<SyncResult> {
  return postWithToken("/api/digest", payload);
}

export function postSavedArticle(payload: SavedArticlePayload): Promise<SyncResult> {
  return postWithToken("/api/saved-articles", payload);
}

export async function hasUnframedConnection(): Promise<boolean> {
  const { token } = await getUnframedConnection();
  return Boolean(token);
}
