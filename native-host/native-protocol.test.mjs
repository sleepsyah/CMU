import { describe, expect, it } from "vitest";
import { createNativeMessageDecoder, encodeNativeMessage } from "./native-protocol.mjs";
import { EXTENSION_ID, hostManifest, sourceLauncherContents } from "./install.mjs";
import { configuredMcpServerNames, RESTRICTED_FEATURES, restrictedCodexConfig } from "./restrictions.mjs";
import { codexItemIsAllowed, codexTraceItemId, compactReasoningSummary } from "./analysis.mjs";

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
});
