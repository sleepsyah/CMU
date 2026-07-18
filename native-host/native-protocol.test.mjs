import { describe, expect, it } from "vitest";
import { createNativeMessageDecoder, encodeNativeMessage } from "./native-protocol.mjs";
import { EXTENSION_ID, hostManifest, sourceLauncherContents } from "./install.mjs";
import { configuredMcpServerNames, RESTRICTED_FEATURES, restrictedCodexConfig } from "./restrictions.mjs";
import { buildAnalysisPrompt, codexItemIsAllowed, codexTraceItemId, compactReasoningSummary, OUTPUT_SCHEMA } from "./analysis.mjs";
import { buildClaudeAnalysisArgs, claudeToolIsAllowed, consumeClaudeMessage, createClaudeTraceState, parseClaudeAuthStatus, structuredClaudeOutput } from "./claude.mjs";
import { providerFromPayload } from "./host.mjs";

describe("Chrome Native Messaging protocol", () => {
  it("decodes complete and fragmented messages", () => {
    const messages = [];
    const decode = createNativeMessageDecoder((message) => messages.push(message));
    const encoded = Buffer.concat([encodeNativeMessage({ id: "1", action: "status" }), encodeNativeMessage({ id: "2", action: "analyze" })]);
    decode(encoded.subarray(0, 7));
    decode(encoded.subarray(7));
    expect(messages).toEqual([{ id: "1", action: "status" }, { id: "2", action: "analyze" }]);
  });

  it("restricts the host to the stable Ellipsis extension id", () => {
    expect(EXTENSION_ID).toHaveLength(32);
    expect(hostManifest("/tmp/ellipsis-host").allowed_origins).toEqual([`chrome-extension://${EXTENSION_ID}/`]);
  });

  it("pins the runtime path instead of depending on Chrome's PATH", () => {
    const launcher = sourceLauncherContents("/opt/node/bin/node", "/repo/native-host/host.mjs");
    expect(launcher).toContain("exec '/opt/node/bin/node' '/repo/native-host/host.mjs'");
    expect(launcher).not.toContain("command -v node");
  });

  it("disables Computer Use and plugin-backed tools while retaining built-in web search", async () => {
    expect(RESTRICTED_FEATURES).toMatchObject({
      apps: false,
      browser_use: false,
      computer_use: false,
      plugins: false,
      shell_tool: false,
      unified_exec: false
    });
    const config = await restrictedCodexConfig({ webSearch: "live" });
    expect(config.web_search).toBe("live");
    expect(config.model_reasoning_summary).toBe("detailed");
    expect(config.mcp_servers).toEqual({});
  });

  it("refuses to start when tool restrictions cannot be verified", async () => {
    await expect(configuredMcpServerNames("/missing/codex.js")).rejects.toThrow(/could not verify/i);
  });

  it("keeps recoverable stream notices alive while blocking tool-capable items", () => {
    expect(codexItemIsAllowed("error")).toBe(true);
    expect(codexItemIsAllowed("reasoning")).toBe(true);
    expect(codexItemIsAllowed("web_search")).toBe(true);
    expect(codexItemIsAllowed("command_execution")).toBe(false);
    expect(codexItemIsAllowed("mcp_tool_call")).toBe(false);
  });

  it("deduplicates repeated structured responses and retry notices", () => {
    expect(codexTraceItemId({ type: "agent_message", id: "one" })).toBe("agent-output");
    expect(codexTraceItemId({ type: "agent_message", id: "two" })).toBe("agent-output");
    expect(codexTraceItemId({ type: "error", id: "three" })).toBe("codex-retry");
  });

  it("compacts reasoning activity to one short sentence", () => {
    const result = compactReasoningSummary("I need to search for the official record and compare it with a second source before deciding how the claim affects the analysis. Then I should format the JSON output and verify every field.");
    expect(result.length).toBeLessThanOrEqual(150);
    expect(result.split(/[.!?]/).filter(Boolean)).toHaveLength(1);
  });

  it("leaves Sources and Voices to the explicit local attribution pipeline", () => {
    expect(OUTPUT_SCHEMA.properties.source_participation).toBeUndefined();
    const { prompt } = buildAnalysisPrompt({ raw_text: "A sufficiently long article passage says that Jane Smith of the City Council supports the proposal because it would reduce costs for local residents and small businesses." });
    expect(prompt).toMatch(/Sources and Voices are extracted locally from explicit attribution patterns/i);
    expect(prompt).toMatch(/Do not infer ideological positions, missing perspectives, fairness, balance/i);
  });

  it("allows enough room for a complete overall-bias explanation", () => {
    expect(OUTPUT_SCHEMA.properties.overall_bias.properties.summary.maxLength).toBe(480);
    const { prompt } = buildAnalysisPrompt({ raw_text: "A sufficiently long article passage describes a policy dispute with attributed comments, procedural history, and several contrasting descriptions from named participants." });
    expect(prompt).toMatch(/two polished English sentences/i);
    expect(prompt).toMatch(/end both with sentence punctuation/i);
  });

  it("does not silently truncate source text at the former 30,000-character limit", () => {
    const rawText = "A complete live-blog update with attributed source evidence. ".repeat(700);
    expect(rawText.length).toBeGreaterThan(30_000);
    const built = buildAnalysisPrompt({ raw_text: rawText });
    expect(built.rawText).toHaveLength(rawText.trim().length);
    expect(built.source.raw_text).toHaveLength(rawText.trim().length);
    expect(() => buildAnalysisPrompt({ raw_text: "Long source evidence. ".repeat(7_000) })).toThrow(/instead of silently truncating/i);
  });

  it("dispatches provider-aware native requests", () => {
    expect(providerFromPayload({ provider: "claude" })).toBe("claude");
    expect(providerFromPayload({ provider: "codex" })).toBe("codex");
    expect(providerFromPayload({ provider: "unknown" })).toBe("codex");
  });

  it("keeps Claude Code in a web-only one-shot runtime", () => {
    const args = buildClaudeAnalysisArgs();
    expect(args).toContain("--safe-mode");
    expect(args).toContain("--no-chrome");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--tools") + 1]).toBe("WebSearch,WebFetch");
    expect(args[args.indexOf("--disallowedTools") + 1]).toContain("ComputerUse");
    expect(claudeToolIsAllowed("WebSearch")).toBe(true);
    expect(claudeToolIsAllowed("WebFetch")).toBe(true);
    expect(claudeToolIsAllowed("Read")).toBe(false);
    expect(claudeToolIsAllowed("Bash")).toBe(false);
  });

  it("parses Claude authentication and structured stream output", () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"claude.ai"}').loggedIn).toBe(true);
    expect(parseClaudeAuthStatus('{"loggedIn":false,"authMethod":"none"}').loggedIn).toBe(false);
    const state = createClaudeTraceState();
    consumeClaudeMessage(state, {
      type: "result",
      subtype: "success",
      structured_output: { summary: "Structured analysis" }
    });
    expect(structuredClaudeOutput(state.result)).toEqual({ summary: "Structured analysis" });
  });

  it("blocks non-web Claude tool calls in the stream", () => {
    const state = createClaudeTraceState();
    expect(() => consumeClaudeMessage(state, {
      type: "stream_event",
      event: { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "tool-1", name: "Read", input: {} } }
    })).toThrow(/blocked Read tool/i);
  });
});
