# Ellipsis

Ellipsis is a Chrome extension that helps you inspect how a news article or Congress.gov bill is written.

It shows:

- a short summary;
- possible political, gender, and ethnicity framing signals;
- a multi-label framing profile and source-participation snapshot;
- researched checks of material claims with cited sources when AI is enabled;
- the exact passages behind its findings;
- a few questions worth checking as you read.

Ellipsis is a reading aid. It does not decide whether a source is true, neutral, or trustworthy.

## Install

Ellipsis is not currently distributed through the Chrome Web Store. To install it from this repository:

1. Install [Node.js](https://nodejs.org/) 20.19 or newer.
2. Download this repository and open its folder in a terminal.
3. Run:

   ```sh
   npm install
   npm run build
   ```

4. Open `chrome://extensions` in Chrome.
5. Turn on **Developer mode**.
6. Select **Load unpacked** and choose the generated `dist` folder.
7. Pin Ellipsis from Chrome's Extensions menu if you want it in the toolbar.

## Use

1. Open a news article or Congress.gov bill.
2. Select the Ellipsis icon in Chrome.
3. Choose **Analyze page**.
4. Read the summary and bias signals.
5. Open **Details** to see the supporting passages and analysis notes.

You can also paste a public link or paste source text manually.

Saved analyses stay on your device. Ellipsis stores up to 50 saved items.

## Optional AI deep analysis

Ellipsis works without AI. When AI mode is enabled, Codex or Claude Code produces the complete summary, framing, bias, source-participation, confidence, and relevant researched claim analysis. Local heuristics remain available if AI is off or fails:

1. Move the packaged **Ellipsis AI Connector** to Applications, then open it once to register it with Chrome.
2. In Ellipsis, turn on **AI deep analysis** and choose Codex or Claude Code.
3. Press the provider connection button and complete sign-in if requested.

Chrome starts the native connector automatically when Ellipsis needs it. There is no extension API key or hosted proxy to configure. Codex uses app-server plus the official Codex SDK with GPT-5.5 low reasoning. Claude uses the locally installed Claude Code CLI with Sonnet 4.6 low effort. Both run in an empty temporary workspace with only focused web research available. Computer Use, Chrome control, plugins, MCP servers, shell commands, and file access are disabled. If the selected provider is unavailable, unauthenticated, out of usage, or unsupported by the account, Ellipsis completes the local analysis normally.

Developers can optionally run `npm run backend:start` to provide evidence-linked local transformer signals to the selected provider. The helper runs only on loopback, is consulted only while AI deep analysis is enabled, and never replaces source-text validation.

For source development, `npm run native:install` registers the source-tree connector for the stable unpacked extension id and records the absolute Node runtime path so Chrome does not depend on the user's shell environment. Run it again after moving the repository or replacing Node. `npm run native:package:mac` builds the self-contained macOS connector app. These are development and packaging commands, not end-user connection steps.

## Understanding the results

- **Low, moderate, or high** describes the strength of wording cues Ellipsis detected.
- **No direct evidence found** means the article did not contain a source-matched cue for that category; Ellipsis shows no bar or score.
- **Overall bias profile** summarizes the strongest detected article-level pattern with a cue-strength score and short narrative.
- A low score does not prove neutrality.
- A high score does not prove that the source is false.

Always read the cited passage in context before drawing a conclusion.

## Privacy

Ellipsis does not require an account. Analysis happens locally by default, and full article text is not added to saved history. Saved results contain only short excerpts needed to explain the analysis.

When AI deep analysis is enabled, extracted source text is sent over Chrome Native Messaging to the local connector and processed through the user's authenticated Codex or Claude Code session. The selected provider searches only when a material claim needs external verification, and cited research remains separate from source-text evidence. The extension has no remote AI endpoint. The optional Python model helper, when enabled by a developer, listens only on loopback.

## If a page cannot be analyzed

Ellipsis cannot read some paywalled pages, PDFs, browser settings pages, login-only pages, or sites that hide their article text from extensions. Try one of these options:

- reload the page and analyze it again;
- paste the public link into Ellipsis;
- use **Paste text instead**.

After updating the extension, run `npm run build` again and select **Reload** for Ellipsis on `chrome://extensions`.

For technical details, see the [methodology and validation plan](docs/methodology.md).
