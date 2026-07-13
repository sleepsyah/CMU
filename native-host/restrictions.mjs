import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const RESTRICTED_FEATURES = {
  apps: false,
  browser_use: false,
  browser_use_external: false,
  browser_use_full_cdp_access: false,
  code_mode: { enabled: false },
  computer_use: false,
  goals: false,
  image_generation: false,
  in_app_browser: false,
  memories: false,
  multi_agent: false,
  plugins: false,
  plugin_sharing: false,
  remote_plugin: false,
  shell_tool: false,
  skill_mcp_dependency_install: false,
  unified_exec: false
};

export function resolveCodexCliScript() {
  const sdkEntry = import.meta.resolve("@openai/codex-sdk");
  return createRequire(sdkEntry).resolve("@openai/codex/bin/codex.js");
}

export async function configuredMcpServerNames(codexScript = resolveCodexCliScript()) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [codexScript, "mcp", "list", "--json"], {
      timeout: 5_000,
      maxBuffer: 512_000,
      env: process.env
    });
    const servers = JSON.parse(stdout);
    if (!Array.isArray(servers)) throw new Error("Unexpected Codex MCP configuration response.");
    return servers
      .map((server) => typeof server?.name === "string" ? server.name.trim() : "")
      .filter(Boolean);
  } catch (error) {
    throw new Error("Ellipsis could not verify the restricted Codex tool configuration.", { cause: error });
  }
}

export async function restrictedCodexConfig({ webSearch = "disabled" } = {}) {
  await configuredMcpServerNames();
  return {
    apps: { _default: { enabled: false } },
    features: RESTRICTED_FEATURES,
    hide_agent_reasoning: false,
    history: { persistence: "none" },
    mcp_servers: {},
    model_reasoning_summary: "detailed",
    show_raw_agent_reasoning: false,
    web_search: webSearch
  };
}

function configPath(parts) {
  return parts.map((part) => /^[A-Za-z0-9_-]+$/.test(part) ? part : JSON.stringify(part)).join(".");
}

function flattenConfig(value, parts = [], result = []) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const entries = Object.entries(value);
    if (!entries.length && parts.length) result.push(`${configPath(parts)}={}`);
    for (const [key, child] of entries) flattenConfig(child, [...parts, key], result);
    return result;
  }
  result.push(`${configPath(parts)}=${typeof value === "string" ? JSON.stringify(value) : String(value)}`);
  return result;
}

export async function restrictedAppServerArgs() {
  const config = await restrictedCodexConfig({ webSearch: "disabled" });
  return flattenConfig(config).flatMap((entry) => ["-c", entry]);
}
