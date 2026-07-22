import type { SavedAnalysis, SavedArticlePayload } from "../types";
import { getArticleSyncSettings } from "./storage";
import { postSavedArticle } from "./unframedApi";

/** Only article analyses carry the bias/perspective/framing shape the dashboard displays — bill saves are out of scope for this sync. */
export function buildSavedArticlePayload(saved: SavedAnalysis): SavedArticlePayload | null {
  const analysis = saved.analysis;
  if (analysis.contentType !== "article" || !analysis.backendBias) return null;
  return {
    articleUrl: analysis.url,
    articleTitle: analysis.pageTitle,
    savedAt: saved.createdAt,
    biasScores: analysis.backendBias.scores,
    perspectives: analysis.sourcesAndVoices,
    framingNotes: analysis.framingNotes,
    summary: analysis.summary
  };
}

/** Pushes a saved article analysis to the connected Unframed account, if the user has opted in and the analysis is syncable. Silent no-op otherwise — sync is best-effort and never blocks the save flow. */
export async function syncSavedArticleIfEnabled(saved: SavedAnalysis): Promise<boolean> {
  const settings = await getArticleSyncSettings();
  if (!settings.enabled) return false;

  const payload = buildSavedArticlePayload(saved);
  if (!payload) return false;

  const result = await postSavedArticle(payload);
  return result.ok;
}
