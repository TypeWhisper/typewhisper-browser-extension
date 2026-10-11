import assert from "node:assert/strict";
import test from "node:test";
import { REFRESH_INTERVAL_MS, buildReport, shouldSend } from "../extension/context.js";

test("a focused window reports its active tab", () => {
  const report = buildReport("client", { focused: true }, { url: "https://docs.github.com/", title: "Docs" });
  assert.deepEqual(report, { client_id: "client", focused: true, url: "https://docs.github.com/", title: "Docs" });
});

test("a browser in the background reports that it lost focus", () => {
  assert.deepEqual(buildReport("client", { focused: false }, null), { client_id: "client", focused: false });
  assert.deepEqual(buildReport("client", null, null), { client_id: "client", focused: false });
});

test("private windows report no website", () => {
  const report = buildReport("client", { focused: true }, { url: "https://bank.example/", title: "Bank", incognito: true });
  assert.deepEqual(report, { client_id: "client", focused: true, url: null, title: null });
});

test("unchanged reports are only repeated while the browser is in front", () => {
  const focused = { client_id: "c", focused: true, url: "https://a.example/", title: "A" };
  const blurred = { client_id: "c", focused: false };
  const sentAt = 1_000_000;

  assert.equal(shouldSend(null, focused, sentAt), true);
  assert.equal(shouldSend({ report: focused, sentAt }, { ...focused }, sentAt + 1000), false);
  assert.equal(shouldSend({ report: focused, sentAt }, focused, sentAt + REFRESH_INTERVAL_MS), true);
  assert.equal(shouldSend({ report: focused, sentAt }, { ...focused, title: "B" }, sentAt + 1000), true);
  assert.equal(shouldSend({ report: blurred, sentAt }, blurred, sentAt + REFRESH_INTERVAL_MS * 10), false);
  assert.equal(shouldSend({ report: blurred, sentAt }, focused, sentAt + 1000), true);
});
