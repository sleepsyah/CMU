# Ellipsis AI Connector

Ellipsis uses Chrome Native Messaging to launch this connector only when AI deep analysis is requested. It supports Codex through local app-server and the official Codex SDK, plus Claude Code through the locally installed Claude Code CLI.

Product users do not start a server or configure a port. Move the packaged macOS app to Applications and open it once to register the connector with Chrome. After that, Ellipsis checks or starts the selected provider automatically. Claude Code must already be installed locally; the connector does not bundle it.

The connector starts both providers with a fail-closed tool policy. Focused web research is allowed. Computer Use, Chrome control, plugins, MCP servers, shell commands, and file access are disabled. Claude Code also runs with safe mode, no session persistence, and no project instruction discovery.

Development commands:

```sh
npm run native:install
npm run native:status
node native-host/host.mjs --request status --provider claude
npm run native:package:mac
```

`native:install` registers a generated source-tree launcher for the stable unpacked extension id. The launcher pins the absolute Node runtime path because Chrome native hosts do not inherit the user's interactive shell setup. Run it again after moving the repository or replacing Node. `native:package:mac` builds a self-contained app and distributable zip in `artifacts/` with its own Node and Codex runtime; Claude Code remains an external local dependency. Set `ELLIPSIS_CODESIGN_IDENTITY` to sign the app with a Developer ID Application certificate during packaging.

See `CLAUDE_CODE_IMPLEMENTATION.md` for implementation details, current testing limits, debugging steps, and future-agent guidance.
