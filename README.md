# Ellipsis

Ellipsis is a Chrome extension that helps you inspect how a news article or Congress.gov bill is written.

It shows:

- a short summary;
- possible political, gender, and ethnicity framing signals;
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

## Understanding the results

- **Low, moderate, or high** describes the strength of wording cues Ellipsis detected.
- **Not assessed** means there was not enough direct evidence for that category.
- A low score does not prove neutrality.
- A high score does not prove that the source is false.

Always read the cited passage in context before drawing a conclusion.

## Privacy

Ellipsis does not require an account. Analysis happens locally by default, and full article text is not added to saved history. Saved results contain only short excerpts needed to explain the analysis.

## If a page cannot be analyzed

Ellipsis cannot read some paywalled pages, PDFs, browser settings pages, login-only pages, or sites that hide their article text from extensions. Try one of these options:

- reload the page and analyze it again;
- paste the public link into Ellipsis;
- use **Paste text instead**.

After updating the extension, run `npm run build` again and select **Reload** for Ellipsis on `chrome://extensions`.

For technical details, see the [methodology and validation plan](docs/methodology.md).
