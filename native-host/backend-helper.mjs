import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_URL = "http://127.0.0.1:8000";
const HEALTH_TIMEOUT_MS = 1_000;
const START_TIMEOUT_MS = 240_000;

let startPromise = null;

function appRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function backendStateDirectory() {
  if (process.env.ELLIPSIS_BACKEND_STATE_DIR) return process.env.ELLIPSIS_BACKEND_STATE_DIR;
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/Ellipsis/Backend");
  if (process.platform === "win32") return join(process.env.LOCALAPPDATA || homedir(), "Ellipsis", "Backend");
  return join(homedir(), ".local/share/Ellipsis/Backend");
}

async function requestJson(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? HEALTH_TIMEOUT_MS);
  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: path === "/warmup" ? "POST" : "GET",
      signal: controller.signal
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function pythonBackendStatus() {
  const health = await requestJson("/health");
  const ready = Boolean(health?.status === "ok" && health?.ready === true);
  return {
    backendUrl: BACKEND_URL,
    ready,
    status: ready ? "ready" : health?.status === "ok" ? "warming" : "offline",
    models: health?.models || {},
    requiredModels: health?.required_models || []
  };
}

function pythonCandidates() {
  return [process.env.ELLIPSIS_PYTHON, "python3", "python"].filter(Boolean);
}

async function existingPython(command) {
  await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, ["--version"], { stdio: "ignore" });
    child.once("error", rejectPromise);
    child.once("exit", (code) => code === 0 ? resolvePromise() : rejectPromise(new Error(`${command} exited with ${code}`)));
  });
  return command;
}

async function resolvePython() {
  for (const candidate of pythonCandidates()) {
    try {
      return await existingPython(candidate);
    } catch {
      // Try the next candidate.
    }
  }
  throw new Error("Python 3 is required to start the Ellipsis model backend.");
}

async function startBackendProcess() {
  const root = appRoot();
  const script = join(root, "scripts/start_backend.py");
  await access(script);
  const python = await resolvePython();
  const child = spawn(python, [script], {
    cwd: root,
    env: { ...process.env, ELLIPSIS_BACKEND_STATE_DIR: backendStateDirectory() },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  const append = (chunk) => {
    output = `${output}${chunk.toString("utf8")}`.slice(-4000);
  };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      rejectPromise(new Error("Ellipsis model backend did not finish warming in time."));
    }, START_TIMEOUT_MS);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else rejectPromise(new Error(output.trim() || `Backend starter exited with code ${code ?? 1}.`));
    });
  });
}

export async function ensurePythonBackend(onProgress) {
  const current = await pythonBackendStatus();
  if (current.ready) return current;
  if (!startPromise) {
    onProgress?.({
      id: "python-backend",
      kind: "local",
      status: "running",
      title: "Python model backend",
      detail: "Starting and warming local transformer models",
      at: new Date().toISOString()
    });
    startPromise = startBackendProcess().finally(() => {
      startPromise = null;
    });
  }
  await startPromise;
  const ready = await pythonBackendStatus();
  if (!ready.ready) throw new Error("Ellipsis model backend started but did not report all required models ready.");
  onProgress?.({
    id: "python-backend",
    kind: "local",
    status: "completed",
    title: "Python model backend",
    detail: "Local transformer models are ready",
    at: new Date().toISOString()
  });
  return ready;
}
