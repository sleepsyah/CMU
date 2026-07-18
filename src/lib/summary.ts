const SENTENCE_END = /[.!?]["'”’)]*(?=\s+[A-Z0-9“"]|$)/g;
const TERMINAL_UNEXPECTED_SCRIPT = /\s+(?:[A-Za-z0-9]{1,2}\s*)?[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Devanagari}][^\s]*$/u;

function normalizedText(value: unknown) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFD]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function removeTerminalGenerationNoise(value: string) {
  let text = value.replace(TERMINAL_UNEXPECTED_SCRIPT, "").trim();
  // Structured generation can occasionally append one orphan token after an
  // otherwise complete response (for example, "... limited force. 3").
  text = text.replace(/([.!?]["'”’)]*)\s+[A-Za-z0-9]$/, "$1");
  return text;
}

function completeSentencePrefix(value: unknown, maxLength: number) {
  const text = removeTerminalGenerationNoise(normalizedText(value));
  if (!text) return "";
  if (text.length <= maxLength && /[.!?]["'”’)]*$/.test(text)) return text;

  const prefix = text.slice(0, maxLength);
  const endings = Array.from(prefix.matchAll(SENTENCE_END));
  const ending = endings.at(-1);
  if (!ending || ending.index === undefined || ending.index < 39) return "";
  return prefix.slice(0, ending.index + ending[0].length).trim();
}

/** Never display a generated overall-bias explanation as a partial sentence. */
export function cleanOverallBiasSummary(value: unknown, fallback: unknown = "", maxLength = 480) {
  return completeSentencePrefix(value, maxLength) || completeSentencePrefix(fallback, maxLength);
}
