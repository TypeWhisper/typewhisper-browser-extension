// Loads the extension into Chrome for Testing and drives it against a mock of
// the TypeWhisper API. Run with `npm run e2e`; set HEADFUL=1 to watch.

import assert from "node:assert/strict";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionPath = path.join(root, "extension");
const TOKEN = "e2e-token";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

async function startMockAPI() {
  const requests = [];
  let recording = false;
  const server = http.createServer(async (request, response) => {
    let text = "";
    for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : null;
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    const send = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(JSON.stringify(payload));
    };

    if (request.method === "GET" && request.url === "/v1/status") {
      return send(200, { status: "ready", model: "parakeet", supports_browser_context: true });
    }
    if (request.headers.authorization !== `Bearer ${TOKEN}`) {
      return send(401, { error: { code: "unauthorized", message: "Missing or invalid API token" } });
    }
    switch (`${request.method} ${request.url}`) {
      case "PUT /v1/browser/context":
        return send(200, { status: body.focused ? "active" : "cleared", app_bundle_id: "com.google.chrome.for.testing", url: body.url ?? null });
      case "GET /v1/dictation/status":
        return send(200, { state: recording ? "recording" : "idle", is_recording: recording });
      case "POST /v1/dictation/start":
        recording = true;
        return send(200, { id: "6E0C3D5A-0000-4000-8000-000000000001", status: "recording" });
      case "POST /v1/dictation/stop":
        recording = false;
        return send(200, { id: "6E0C3D5A-0000-4000-8000-000000000001", status: "stopped" });
      default:
        return send(404, { error: { code: "not_found", message: `Not found: ${request.method} ${request.url}` } });
    }
  });
  const port = await listen(server);
  return { server, port, requests, isRecording: () => recording };
}

async function startPageServer() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>E2E Docs</title>
      <textarea id="field" style="width:420px;height:120px;margin:40px"></textarea>
      <input id="secret" type="password" style="width:300px">`);
  });
  const port = await listen(server);
  return { server, url: `http://127.0.0.1:${port}/editor` };
}

async function waitFor(check, description, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

const results = [];
async function step(name, run) {
  await run();
  results.push(name);
  console.log(`✔ ${name}`);
}

const api = await startMockAPI();
const page = await startPageServer();
const browser = await puppeteer.launch({
  headless: process.env.HEADFUL ? false : true,
  pipe: true,
  enableExtensions: [extensionPath],
  // GitHub's Ubuntu runners do not allow Chrome's user-namespace sandbox.
  args: process.env.CI ? ["--no-sandbox"] : [],
});

try {
  const workerTarget = await browser.waitForTarget(
    (target) => target.type() === "service_worker" && target.url().endsWith("/background.js"),
  );
  const worker = await workerTarget.worker();
  await worker.evaluate(
    (port, token) => chrome.storage.local.set({ port, token }),
    api.port,
    TOKEN,
  );

  const tab = await browser.newPage();
  await tab.goto(page.url);
  await tab.bringToFront();

  const contextReports = () => api.requests.filter((r) => r.method === "PUT" && r.url === "/v1/browser/context");

  await step("reports the active tab with token and extension origin", async () => {
    await worker.evaluate(() => globalThis.typewhisper.queueContextReport());
    const report = await waitFor(
      () => contextReports().find((r) => r.body.focused && r.body.url === page.url),
      "a focused context report",
    );
    assert.equal(report.body.title, "E2E Docs");
    assert.match(report.body.client_id, /^[0-9a-f-]{36}$/);
    assert.equal(report.headers.authorization, `Bearer ${TOKEN}`);
    assert.match(report.headers.origin ?? "", /^chrome-extension:\/\//);
  });

  await step("does not repeat an unchanged report right away", async () => {
    const before = contextReports().length;
    await worker.evaluate(() => globalThis.typewhisper.queueContextReport());
    assert.equal(contextReports().length, before);
  });

  await step("reports navigation to another page", async () => {
    await tab.goto(`${page.url}?second`);
    await waitFor(() => contextReports().find((r) => r.body.url === `${page.url}?second`), "the second page");
  });

  await step("starts and stops a dictation and shows the badge", async () => {
    const started = await worker.evaluate(() => globalThis.typewhisper.toggleDictation());
    assert.deepEqual(started, { ok: true, recording: true });
    assert.equal(api.isRecording(), true);
    assert.equal(await worker.evaluate(() => chrome.action.getBadgeText({})), "REC");

    const stopped = await worker.evaluate(() => globalThis.typewhisper.toggleDictation());
    assert.deepEqual(stopped, { ok: true, recording: false });
    assert.equal(api.isRecording(), false);
    await waitFor(async () => (await worker.evaluate(() => chrome.action.getBadgeText({}))) === "", "the badge to clear");
  });

  await step("clears the badge when TypeWhisper stops the dictation itself", async () => {
    await worker.evaluate(() => globalThis.typewhisper.toggleDictation());
    // Simulates TypeWhisper's own hotkey ending the dictation.
    await fetch(`http://127.0.0.1:${api.port}/v1/dictation/stop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    await waitFor(async () => (await worker.evaluate(() => chrome.action.getBadgeText({}))) === "", "the badge to clear");
  });

  await step("shows the microphone button in text fields and keeps the caret there", async () => {
    await worker.evaluate(async (url) => {
      const [target] = await chrome.tabs.query({ url: `${url}*` });
      await chrome.scripting.executeScript({ target: { tabId: target.id }, files: ["content/mic-button.js"] });
    }, page.url);

    await tab.focus("#field");
    const position = await waitFor(
      () =>
        tab.evaluate(() => {
          const host = document.querySelector("typewhisper-mic");
          if (!host || host.style.display !== "block") return null;
          const field = document.getElementById("field").getBoundingClientRect();
          const button = host.getBoundingClientRect();
          return { field: { right: field.right, top: field.top }, x: button.left, y: button.top };
        }),
      "the microphone button",
    );
    assert.ok(position.x < position.field.right && position.x > position.field.right - 40, "button sits at the right edge");
    assert.ok(Math.abs(position.y - position.field.top) < 12, "button sits at the top");

    const startsBefore = api.requests.filter((r) => r.url === "/v1/dictation/start").length;
    await tab.mouse.click(position.x + 12, position.y + 12);
    await waitFor(() => api.isRecording(), "the dictation to start");
    assert.equal(api.requests.filter((r) => r.url === "/v1/dictation/start").length, startsBefore + 1);
    assert.equal(await tab.evaluate(() => document.activeElement?.id), "field");

    await tab.mouse.click(position.x + 12, position.y + 12);
    await waitFor(() => !api.isRecording(), "the dictation to stop");
  });

  await step("hides the microphone button in password fields", async () => {
    await tab.focus("#secret");
    await waitFor(
      () => tab.evaluate(() => document.querySelector("typewhisper-mic")?.style.display === "none"),
      "the button to hide",
    );
  });

  await step("reports a rejected token", async () => {
    await worker.evaluate(() => chrome.storage.local.set({ token: "wrong" }));
    const result = await worker.evaluate(() => globalThis.typewhisper.toggleDictation());
    assert.equal(result.ok, false);
    assert.match(result.error, /token/i);
    const { connectionStatus } = await worker.evaluate(() => chrome.storage.session.get("connectionStatus"));
    assert.equal(connectionStatus.state, "unauthorized");
    await worker.evaluate((token) => chrome.storage.local.set({ token }), TOKEN);
  });

  await step("withdraws the website when sharing is turned off", async () => {
    await worker.evaluate(() => chrome.storage.local.set({ reportContext: false }));
    await waitFor(() => contextReports().at(-1)?.body.focused === false, "a cleared report");
  });

  console.log(`\n${results.length} end-to-end checks passed`);
} finally {
  await browser.close();
  api.server.close();
  page.server.close();
}
