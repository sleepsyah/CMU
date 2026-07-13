import { spawn } from "node:child_process";
import readline from "node:readline";
import { resolveCodexCliScript, restrictedAppServerArgs } from "./restrictions.mjs";

const REQUEST_TIMEOUT_MS = 15_000;

export class CodexAppServer {
  #child = null;
  #nextId = 1;
  #pending = new Map();
  #starting = null;

  async start() {
    if (this.#child) return;
    if (this.#starting) return this.#starting;
    this.#starting = this.#startProcess();
    try {
      await this.#starting;
    } finally {
      this.#starting = null;
    }
  }

  async #startProcess() {
    const child = spawn(process.execPath, [resolveCodexCliScript(), ...(await restrictedAppServerArgs()), "app-server"], {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.#child = child;
    const stderr = [];
    child.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      if (stderr.length > 12) stderr.shift();
    });
    child.once("error", (error) => this.#handleExit(error));
    child.once("exit", (code, signal) => {
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      this.#handleExit(new Error(detail || `Codex app-server exited with ${signal || `code ${code ?? 1}`}.`));
    });

    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.#handleLine(line));

    await this.request("initialize", {
      clientInfo: { name: "ellipsis_extension", title: "Ellipsis", version: "0.2.0" },
      capabilities: { experimentalApi: true }
    });
    this.notify("initialized");
  }

  #handleLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.id === undefined) return;
    const pending = this.#pending.get(message.id);
    if (!pending) return;
    this.#pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.error) pending.reject(new Error(message.error.message || "Codex app-server request failed."));
    else pending.resolve(message.result);
  }

  #handleExit(error) {
    this.#child = null;
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!this.#child && method !== "initialize") await this.start();
    const child = this.#child;
    if (!child?.stdin.writable) throw new Error("Codex app-server is unavailable.");
    const id = this.#nextId++;
    const result = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Codex app-server timed out during ${method}.`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timeout });
    });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    return result;
  }

  notify(method, params) {
    if (!this.#child?.stdin.writable) return;
    this.#child.stdin.write(`${JSON.stringify(params === undefined ? { method } : { method, params })}\n`);
  }

  async status() {
    await this.start();
    const response = await this.request("account/read", { refreshToken: false });
    const ready = Boolean(response?.account) || response?.requiresOpenaiAuth === false;
    const email = typeof response?.account?.email === "string" ? response.account.email : "";
    return {
      providerStatus: ready ? "ready" : "needs_auth",
      providerMessage: ready
        ? email ? `Connected to Codex as ${email}.` : "Connected to the authenticated local Codex runtime."
        : "Codex is ready to connect. Sign in from Ellipsis to continue.",
      model: "gpt-5.5",
      reasoningEffort: "low",
      runtime: "Codex app-server",
      checkedAt: new Date().toISOString()
    };
  }

  async beginLogin() {
    const status = await this.status();
    if (status.providerStatus === "ready") return { status };
    let login;
    try {
      login = await this.request("account/login/start", {
        type: "chatgpt",
        useHostedLoginSuccessPage: true,
        appBrand: "codex"
      });
    } catch {
      login = await this.request("account/login/start", { type: "chatgpt" });
    }
    if (!login?.authUrl) throw new Error("Codex did not provide a sign-in URL.");
    return {
      status,
      authUrl: login.authUrl,
      loginId: login.loginId || null
    };
  }

  close() {
    const child = this.#child;
    this.#child = null;
    if (!child) return;
    child.removeAllListeners();
    try {
      child.kill("SIGTERM");
    } catch {
      // The process already exited.
    }
  }
}
