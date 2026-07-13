# Ellipsis AI Connector

Ellipsis uses Chrome Native Messaging to launch this connector only when AI deep analysis is requested. The connector starts the local Codex app-server over stdio, supports browser-based ChatGPT authentication, and runs structured analysis through the official Codex SDK.

Product users do not start a server or configure a port. Move the packaged macOS app to Applications and open it once to register the connector with Chrome. After that, the **Connect Codex** button launches it automatically.

The connector starts Codex with a fail-closed tool policy. Built-in web search is allowed for focused context checks. Computer Use, browser control, plugins, MCP servers, shell commands, and file access are disabled before app-server or an analysis thread starts. If the connector cannot verify those restrictions, it refuses to connect.

Development commands:

```sh
npm run native:install
npm run native:status
npm run native:package:mac
```

`native:install` registers a generated source-tree launcher for the stable unpacked extension id. The launcher pins the absolute Node runtime path because Chrome native hosts do not inherit the user's interactive shell setup. Run it again after moving the repository or replacing Node. `native:package:mac` builds a self-contained app and distributable zip in `artifacts/` with its own Node and Codex runtime. Set `ELLIPSIS_CODESIGN_IDENTITY` to sign the app with a Developer ID Application certificate during packaging.
