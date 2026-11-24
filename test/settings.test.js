import assert from "node:assert/strict";
import test from "node:test";
import { getAppConnection, hasAppMessaging } from "../extension/settings.js";

test("without native messaging there is no app connection", async () => {
  assert.equal(await getAppConnection({}), null);
});

test("TypeWhisper's reply provides the port and token", async () => {
  const requests = [];
  const runtime = {
    sendNativeMessage: async (application, message) => {
      requests.push({ application, message });
      return { port: 8978, token: "secret" };
    },
  };
  assert.deepEqual(await getAppConnection(runtime), { port: 8978, token: "secret" });
  assert.deepEqual(requests, [{ application: "com.typewhisper.mac", message: { type: "connection" } }]);
});

test("a failed or incomplete reply falls back to the stored settings", async () => {
  const replying = (reply) => ({ sendNativeMessage: async () => reply });
  assert.equal(await getAppConnection({ sendNativeMessage: async () => { throw new Error("no handler"); } }), null);
  assert.equal(await getAppConnection(replying(null)), null);
  assert.equal(await getAppConnection(replying({ error: "api-server-off" })), null);
  assert.equal(await getAppConnection(replying({ port: "8978", token: "secret" })), null);
  assert.equal(await getAppConnection(replying({ port: 0, token: "secret" })), null);
  assert.equal(await getAppConnection(replying({ port: 8978 })), null);
});

test("the Safari package is recognized while TypeWhisper is not running", async () => {
  const runtime = { sendNativeMessage: async () => ({}) };
  assert.equal(hasAppMessaging(runtime), true);
  assert.equal(await getAppConnection(runtime), null);
  assert.equal(hasAppMessaging({}), false);
});
