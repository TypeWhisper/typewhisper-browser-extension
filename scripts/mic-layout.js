// Checks where the microphone button sits in different text fields, in Chrome
// and Firefox, and saves a screenshot of every field to test-results/.
// Run with `npm run e2e:layout`; BROWSERS=firefox limits it to one browser, and
// FIREFOX_PATH points it at an installed Firefox.
//
// The content script runs unchanged; only the extension APIs it calls are
// replaced, so the check does not depend on how each browser loads extensions.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "test-results", "mic-button");
const contentScript = readFileSync(path.join(root, "extension", "content", "mic-button.js"), "utf8");
const browsers = (process.env.BROWSERS ?? "chrome,firefox").split(",").map((name) => name.trim());

const BUTTON_SIZE = 24;
const EDGE_INSET = 6;
const TOLERANCE = 1;

const SEARCH_ICON = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`;

// `box` names the element whose middle the button should line up with, when
// that is not the field itself. `align` is "center" or "top".
const CASES = [
  {
    id: "search-box",
    label: "Search box: short input inside a framed box",
    align: "center",
    box: ".search-box",
    html: `<div class="search-box">${SEARCH_ICON}<input class="field" type="search" placeholder="Suchen"></div>`,
  },
  { id: "input", label: "Text input, 34 px", align: "center", html: `<input class="field" style="height:34px" placeholder="Name">` },
  { id: "input-tall", label: "Text input, 56 px", align: "center", html: `<input class="field" style="height:56px" placeholder="Search the docs">` },
  { id: "input-short", label: "Text input shorter than the button, 20 px", align: "center", html: `<input class="field" style="height:20px" placeholder="Filter">` },
  { id: "textarea-one-row", label: "One-row textarea, 44 px", align: "center", html: `<textarea class="field" rows="1" style="height:44px" placeholder="Ask anything"></textarea>` },
  { id: "contenteditable-line", label: "Single-line contenteditable, 40 px", align: "center", html: `<div class="field" contenteditable="true" style="height:40px">Message</div>` },
  { id: "textarea", label: "Multi-line textarea, 120 px", align: "top", html: `<textarea class="field" style="height:120px" placeholder="Write a comment"></textarea>` },
];

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Microphone button layout</title>
<style>
  :root { color-scheme: dark; font: 14px/1.4 system-ui, sans-serif; background: #111; color: #e8eaed; }
  body { margin: 0; padding: 24px; }
  section { padding: 16px; margin-bottom: 8px; width: 380px; }
  h2 { font-size: 12px; font-weight: 500; color: #9aa0a6; margin: 0 0 8px; }
  .field { box-sizing: border-box; width: 300px; font: inherit; color: inherit; background: #202124; border: 1px solid #3c4043; border-radius: 8px; padding: 0 10px; display: block; }
  textarea.field { padding: 10px; resize: none; }
  div.field { display: flex; align-items: center; }
  .search-box { box-sizing: border-box; width: 300px; height: 34px; display: flex; align-items: center; gap: 10px; padding: 0 10px; background: #202124; border: 1px solid #3c4043; border-radius: 8px; color: #9aa0a6; }
  .search-box .field { flex: 1; height: 20px; padding: 0; border: 0; border-radius: 0; background: transparent; outline: none; }
</style></head>
<body>${CASES.map((c) => `<section data-case="${c.id}"><h2>${c.label}</h2>${c.html}</section>`).join("\n")}</body></html>`;

// Stands in for the extension APIs the content script uses.
const STUB = `window.__micButtonAPI = {
  i18n: { getMessage: (key) => ({ buttonStartDictation: "Start dictation", buttonStopDictation: "Stop dictation" })[key] ?? key },
  storage: { local: { get: async () => ({ recording: false }) }, onChanged: { addListener() {} } },
  runtime: { sendMessage: async () => ({ ok: true, recording: true }) },
};`;

function launch(name) {
  if (name === "chrome") {
    // GitHub's Ubuntu runners do not allow Chrome's user-namespace sandbox.
    return puppeteer.launch({ browser: "chrome", headless: true, args: process.env.CI ? ["--no-sandbox"] : [] });
  }
  if (name === "firefox") {
    return puppeteer.launch({
      browser: "firefox",
      headless: true,
      // Without it, Puppeteer uses its own download (`npx puppeteer browsers install firefox`).
      executablePath: process.env.FIREFOX_PATH || undefined,
      // 0 = dark. Matches the dark color scheme Chrome gets through emulation.
      extraPrefsFirefox: { "layout.css.prefers-color-scheme.content-override": 0 },
    });
  }
  throw new Error(`Unknown browser: ${name}`);
}

const px = (value) => `${value.toFixed(1)} px`;

function check(testCase, m) {
  const problems = [];
  const expectedRight = m.field.right - EDGE_INSET;
  if (Math.abs(m.button.right - expectedRight) > TOLERANCE) {
    problems.push(`right edge at ${px(m.button.right)}, expected ${px(expectedRight)}`);
  }
  if (Math.abs(m.button.height - BUTTON_SIZE) > TOLERANCE) {
    problems.push(`button is ${px(m.button.height)} tall, expected ${BUTTON_SIZE} px`);
  }
  if (testCase.align === "center") {
    const offset = m.button.centerY - m.box.centerY;
    if (Math.abs(offset) > TOLERANCE) problems.push(`${px(Math.abs(offset))} ${offset > 0 ? "below" : "above"} the middle`);
    // Only a field shorter than the button may let it stick out, and then evenly (see above).
    const outside = m.button.top < m.box.top - TOLERANCE || m.button.bottom > m.box.bottom + TOLERANCE;
    if (m.box.height >= BUTTON_SIZE && outside) problems.push("sticks out of the field");
  } else {
    const expectedTop = m.field.top + EDGE_INSET;
    if (Math.abs(m.button.top - expectedTop) > TOLERANCE) problems.push(`top edge at ${px(m.button.top)}, expected ${px(expectedTop)}`);
  }
  return problems;
}

async function measure(page, testCase) {
  return page.evaluate((id, boxSelector) => {
    const host = document.querySelector("typewhisper-mic");
    if (!host || host.style.display !== "block") return null;
    const section = document.querySelector(`[data-case="${id}"]`);
    const rect = (element) => {
      const r = element.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, right: r.right, height: r.height, centerY: r.top + r.height / 2 };
    };
    const field = rect(section.querySelector(".field"));
    return {
      field,
      // A copy: Firefox's WebDriver BiDi does not return the same object twice.
      box: boxSelector ? rect(section.querySelector(boxSelector)) : { ...field },
      button: rect(host),
      section: rect(section),
      left: section.getBoundingClientRect().left,
      width: section.getBoundingClientRect().width,
    };
  }, testCase.id, testCase.box ?? null);
}

async function waitForButton(page, testCase) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const m = await measure(page, testCase);
    if (m) return m;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`${testCase.id}: the microphone button did not appear`);
}

async function overview(browser, name, shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: 460, height: 400, deviceScaleFactor: 2 });
  const cells = shots
    .map((s) => `<figure><figcaption class="${s.problems.length ? "fail" : "pass"}">${s.problems.length ? `✗ ${s.problems.join("; ")}` : "✓ in place"}</figcaption><img src="data:image/png;base64,${s.png}"></figure>`)
    .join("");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 16px; background: #111; color: #e8eaed; font: 13px system-ui, sans-serif; }
    h1 { font-size: 15px; margin: 0 0 12px; }
    figure { margin: 0 0 12px; } figcaption { margin-bottom: 4px; } .pass { color: #81c995; } .fail { color: #f28b82; }
    img { width: 412px; display: block; border: 1px solid #3c4043; }
  </style><h1>${name}</h1>${cells}`);
  await page.evaluate(() => Promise.all(Array.from(document.images, (img) => img.decode())));
  const file = path.join(output, `overview-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await page.close();
  return file;
}

async function run(name) {
  const browser = await launch(name);
  const failures = [];
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 460, height: 1100, deviceScaleFactor: 2 });
    if (name === "chrome") await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
    await page.setContent(PAGE);
    await page.addScriptTag({ content: STUB });
    await page.addScriptTag({ content: `((chrome) => {\n${contentScript}\n})(window.__micButtonAPI);` });

    const directory = path.join(output, name);
    mkdirSync(directory, { recursive: true });
    const shots = [];
    for (const testCase of CASES) {
      await page.focus(`[data-case="${testCase.id}"] .field`);
      const m = await waitForButton(page, testCase);
      // Lets the button paint at its new position before the screenshot.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const png = await page.screenshot({
        clip: { x: m.left, y: m.section.top, width: m.width, height: m.section.height },
        encoding: "base64",
      });
      writeFileSync(path.join(directory, `${testCase.id}.png`), Buffer.from(png, "base64"));

      const problems = check(testCase, m);
      const offset = (testCase.align === "center" ? m.button.centerY - m.box.centerY : m.button.top - m.field.top - EDGE_INSET).toFixed(1);
      console.log(`${problems.length ? "✘" : "✔"} ${name} ${testCase.id} (${testCase.align}, offset ${offset} px)${problems.length ? `: ${problems.join("; ")}` : ""}`);
      for (const problem of problems) failures.push(`${name} ${testCase.id}: ${problem}`);
      shots.push({ problems, png });
    }
    const file = await overview(browser, name, shots);
    console.log(`  screenshots: ${path.relative(root, directory)}/, ${path.relative(root, file)}`);
  } finally {
    await browser.close();
  }
  return failures;
}

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const failures = [];
for (const name of browsers) failures.push(...(await run(name)));
if (failures.length) {
  console.error(`\n${failures.length} layout check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log(`\nMicrophone button layout passed in ${browsers.join(" and ")}`);
