# Claude Code integration

## Current implementation

Ellipsis supports `Codex` and `Claude Code` as optional AI providers. Both use the existing Chrome Native Messaging connector. There is no hosted proxy, extension API key, local HTTP server, or user-run server command.

The Claude Code path is implemented in `native-host/claude.mjs`:

1. The AI settings dialog stores `claude` as the selected provider.
2. The extension sends provider-aware `status`, `login`, and `analyze` messages to `com.ellipsis.codex`, the existing Ellipsis connector host name.
3. The connector locates the installed `claude` executable from explicit environment overrides, `PATH`, common macOS install locations, Volta, NVM, or FNM.
4. Status runs `claude --version` and `claude auth status --json` without making an analysis request.
5. Connect launches `claude auth login` as a detached local process. The settings dialog polls status and enables AI after authentication succeeds.
6. Analysis runs one headless Claude Code process in a new empty directory under the system temporary folder. The article or bill text is passed through standard input and the process is removed after completion.
7. Claude returns the same validated structured analysis shape used by Codex. The existing evidence matcher rejects AI passages that do not occur in the supplied source text.
8. Streamed reasoning is reduced to one-sentence summaries. `WebSearch` and `WebFetch` calls are shown as compact activity rows, followed by the structured agent output.
9. If Claude is missing, signed out, ineligible, out of usage, or returns invalid structured output, Ellipsis keeps the complete local analysis and reports the provider failure.

The provider process is deliberately restricted with:

- `--safe-mode`
- `--no-chrome`
- `--no-session-persistence`
- `--disable-slash-commands`
- an empty strict MCP configuration
- `--tools WebSearch,WebFetch`
- explicit denial of shell, file, agent, skill, and computer-use tools
- an empty temporary working directory

This prevents Claude Code from reading this repository or another project during article analysis. The installed Claude Code authentication state is the only local account state it uses.

## t3code reference

The provider split and local-runtime approach were checked against [pingdotgg/t3code](https://github.com/pingdotgg/t3code), particularly its [Claude adapter](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeAdapter.ts), [Claude provider health checks](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Layers/ClaudeProvider.ts), and [Claude provider guide](https://github.com/pingdotgg/t3code/blob/main/docs/providers/claude.md).

t3code uses `@anthropic-ai/claude-agent-sdk` for long-lived coding sessions, permission callbacks, resuming, and multiple Claude homes. Ellipsis does not need those coding-session features. It adapts the same provider-aware process and account checks to a single restricted structured-analysis run through the user's installed Claude Code CLI.

## Current test limitation

The local machine has Claude Code `2.1.206` installed, and executable discovery plus unauthenticated status detection were verified. `claude auth status --json` currently reports `loggedIn: false` because no eligible Claude subscription is available.

Therefore, the following are covered by automated tests but have not been verified against a paid live Claude response on this machine:

- browser-based sign-in completion;
- live Sonnet 4.6 analysis;
- live `WebSearch` and `WebFetch` event shapes;
- live JSON Schema retry behavior;
- account usage-limit and subscription-specific error wording.

The connector packages the Claude integration code but not the Claude Code executable. Claude Code must already be installed locally. CLI flags and streamed event shapes can change between Claude Code releases, so version compatibility remains the main maintenance risk.

## Debugging checklist

These commands are for development only. Product users should connect with the Ellipsis button.

```sh
claude --version
claude auth status --json
node native-host/host.mjs --request status --provider claude
npm test
npm run typecheck
npm run build
```

If Chrome cannot connect:

1. Run `npm run native:install` after moving the repository, changing Node, or changing native-host files.
2. Reload Ellipsis from `chrome://extensions`.
3. Run the native status command above. `needs_auth` means executable discovery works; `unavailable` means the binary path or install is the first issue to inspect.
4. Set `ELLIPSIS_CLAUDE_BINARY` to an absolute executable path when Claude is installed somewhere not covered by `native-host/claude.mjs`.
5. Inspect the extension service worker console for Native Messaging disconnects. Run the host status command directly to expose native-host errors that Chrome otherwise compresses into a disconnect message.

For a first live-account validation, use a short public article with one checkable claim. Confirm that the activity list shows only reasoning summaries, web search or fetch calls, and agent output. Then confirm that every displayed quote exists verbatim in the pasted source.

## Instructions for future agents

- Preserve the provider field in storage. Never migrate a saved Claude selection back to Codex.
- Keep connection, login, and analysis behind the existing Chrome Native Messaging host. Do not add an API proxy or require users to start a server.
- Do not enable Chrome integration, Computer Use, shell, file tools, plugins, skills, hooks, project instructions, or user MCP servers for source analysis.
- Keep Claude in a system temporary directory. Do not set its working directory to this repository, Documents, or another project.
- Treat t3code as an architecture and compatibility reference, not as code to execute from another repository.
- Update `buildClaudeAnalysisArgs()` and its tests together when Claude Code renames a flag or tool.
- Test signed-out, executable-missing, malformed-stream, blocked-tool, invalid-schema, and local-fallback paths before changing the provider state machine.
- Do not claim full Claude compatibility until status, login, analysis, web research, structured output, cancellation, and usage-limit behavior have been exercised with an authenticated eligible account.
