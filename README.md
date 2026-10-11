# TypeWhisper for Chrome

Dictate into any text field in Chrome with [TypeWhisper](https://typewhisper.com), and let website workflows match the page you are on. The extension talks only to TypeWhisper's local API on `127.0.0.1`.

## Features

| Feature | What it does |
| --- | --- |
| Website workflows | Tells TypeWhisper which page is open in the active tab, so workflows with a website trigger match. This also works in the Mac App Store edition, which cannot read browser addresses itself. |
| Shortcut | `⌥⇧D` (Alt+Shift+D) starts or stops a dictation. Change it at `chrome://extensions/shortcuts`. |
| Context menu | Right-click a text field and choose **Dictate with TypeWhisper**. |
| Microphone button | Optional. Shows a button in the focused text field to start and stop a dictation. |

TypeWhisper inserts the dictated text into the focused field, as it does with its own hotkey. While a dictation runs, the toolbar icon shows `REC`.

## Requirements

- TypeWhisper for Mac with the local API enabled. Windows support follows.
- Website workflows need a TypeWhisper version with browser context support. The popup tells you when yours is too old.
- Google Chrome 120 or later, or another Chromium browser that runs Manifest V3 extensions

## Install

1. Download or clone this repository.
2. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and select the `extension` folder.
3. In TypeWhisper, turn on the API server under **Settings › Advanced** and click **Copy API Token**.
4. Open the extension's popup, paste the token, check the port (default `8978`), and click **Save**. The popup shows **Connected to TypeWhisper** when the connection works.

## Privacy

- The address and title of the active tab go only to TypeWhisper on this computer, and only while **Share the active website with TypeWhisper** is on. Turning it off withdraws the last report.
- Private windows are reported as "no website".
- TypeWhisper keeps the report in memory and drops it after three minutes without a refresh.
- The microphone button needs access to all websites. Chrome asks for it only when you turn the button on.
- The API token is stored in the extension's local storage. The extension does not log tab addresses, page content, or dictated text.

## Development

```bash
npm ci
npm test
npx puppeteer browsers install chrome
npm run e2e
```

`npm test` runs the unit tests. `npm run e2e` loads the extension into Chrome for Testing and drives it against a mock of the TypeWhisper API. Set `HEADFUL=1` to watch the browser.

## License

[GPL-3.0-or-later](LICENSE)
