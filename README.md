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

Ellipsis works without AI. When AI mode is enabled, GPT-5.5 produces the complete summary, framing, bias, source-participation, confidence, and researched claim analysis. Local heuristics are used only if AI is off or fails:

1. Move the packaged **Ellipsis AI Connector** to Applications, then open it once to register it with Chrome.
2. In Ellipsis, turn on **AI deep analysis** and select **Connect Codex**.
3. Complete ChatGPT sign-in in the tab Ellipsis opens, if requested.

Chrome starts the native connector automatically when Ellipsis needs it. There is no background server command, port, API key, or hosted proxy to configure. The connector uses Codex app-server for status and browser-based authentication, then runs GPT-5.5 with low reasoning through the official Codex SDK in a read-only empty workspace. Built-in web search is the only available tool; Computer Use, browser control, plugins, MCP servers, shell commands, and file access are disabled. AI mode researches material claims, streams one-sentence reasoning summaries and searches, and returns cited claim checks alongside the agent output. Direct bias findings are displayed only when their quoted evidence matches the supplied source text. If the connector is unavailable, Ellipsis completes the local heuristic analysis normally.

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

When AI deep analysis is enabled, extracted source text is sent over Chrome Native Messaging to the local connector and processed through the user's authenticated Codex session. Codex usually runs one to three focused web searches to check material claims, and cited research remains separate from source-text evidence. The extension has no remote AI endpoint and does not expose a localhost listener.

## If a page cannot be analyzed

Ellipsis cannot read some paywalled pages, PDFs, browser settings pages, login-only pages, or sites that hide their article text from extensions. Try one of these options:

- reload the page and analyze it again;
- paste the public link into Ellipsis;
- use **Paste text instead**.

After updating the extension, run `npm run build` again and select **Reload** for Ellipsis on `chrome://extensions`.

For technical details, see the [methodology and validation plan](docs/methodology.md).
