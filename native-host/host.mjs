import { pathToFileURL } from "node:url";
import { CodexAppServer } from "./app-server.mjs";
import { analyzeWithCodex } from "./analysis.mjs";
import { ensurePythonBackend, pythonBackendStatus } from "./backend-helper.mjs";
import { ClaudeCodeRuntime } from "./claude.mjs";
import { createNativeMessageDecoder, encodeNativeMessage } from "./native-protocol.mjs";

const IDLE_EXIT_MS = 5 * 60_000;
const appServer = new CodexAppServer();
const claudeRuntime = new ClaudeCodeRuntime();
let idleTimer = null;

export function providerFromPayload(payload = {}) {
  return payload?.provider === "claude" ? "claude" : "codex";
}

function closeRuntimes() {
  appServer.close();
  claudeRuntime.close();
}

function resetIdleTimer() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    closeRuntimes();
    process.exit(0);
  }, IDLE_EXIT_MS);
  idleTimer.unref?.();
}

export async function handleNativeAction(action, payload = {}, onProgress) {
  resetIdleTimer();
  const provider = providerFromPayload(payload);
  if (action === "backend_status") return pythonBackendStatus();
  if (action === "ensure_backend") return ensurePythonBackend(onProgress);
  if (action === "status") return provider === "claude" ? claudeRuntime.status() : appServer.status();
  if (action === "login") return provider === "claude" ? claudeRuntime.beginLogin() : appServer.beginLogin();
  if (action === "analyze") {
    clearTimeout(idleTimer);
    idleTimer = null;
    try {
      if (provider === "claude") {
        const status = await claudeRuntime.status();
        if (status.providerStatus !== "ready") throw new Error("Connect Claude Code before using AI deep analysis.");
        return claudeRuntime.analyze(payload, onProgress);
      }
      const status = await appServer.status();
      if (status.providerStatus !== "ready") throw new Error("Connect Codex before using AI deep analysis.");
      return analyzeWithCodex(payload, onProgress);
    } finally {
      resetIdleTimer();
    }
  }
  if (action === "shutdown") {
    closeRuntimes();
    return { disconnected: true };
  }
  throw new Error("Unsupported Ellipsis native action.");
}

export function runNativeMessagingHost(input = process.stdin, output = process.stdout) {
  const send = (value) => output.write(encodeNativeMessage(value));
  const decode = createNativeMessageDecoder(async (message) => {
    const id = typeof message?.id === "string" ? message.id : "unknown";
    try {
      const result = await handleNativeAction(message?.action, message?.payload, (event) => send({ id, type: "progress", event }));
      send({ id, ok: true, result });
      if (message?.action === "shutdown") setTimeout(() => process.exit(0), 20);
    } catch (error) {
      send({
        id,
        ok: false,
        error: {
          code: "native_request_failed",
          message: error instanceof Error ? error.message : "Ellipsis AI Connector failed."
        }
      });
    }
  });
  input.on("data", (chunk) => {
    try {
      decode(chunk);
    } catch (error) {
      send({ id: "unknown", ok: false, error: { code: "invalid_message", message: error instanceof Error ? error.message : "Invalid native message." } });
    }
  });
  input.on("end", () => {
    closeRuntimes();
    process.exit(0);
  });
  resetIdleTimer();
}

async function main() {
  const requestIndex = process.argv.indexOf("--request");
  if (requestIndex >= 0) {
    const action = process.argv[requestIndex + 1] || "status";
    const providerIndex = process.argv.indexOf("--provider");
    const provider = providerIndex >= 0 ? process.argv[providerIndex + 1] : undefined;
    const result = await handleNativeAction(action, provider ? { provider } : {});
    process.stdout.write(`${JSON.stringify(result)}\n`);
    closeRuntimes();
    return;
  }
  runNativeMessagingHost();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Ellipsis AI Connector failed."}\n`);
    process.exitCode = 1;
  });
}
