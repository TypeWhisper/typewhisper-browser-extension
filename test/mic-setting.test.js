import assert from "node:assert/strict";
import test from "node:test";
import { ALL_SITES, enableMicButton, reconcileMicButton } from "../extension/mic-setting.js";

function fakeChrome({ granted = false, answer } = {}) {
  const calls = [];
  const storage = {};
  return {
    calls,
    storage,
    api: {
      storage: {
        local: {
          set: async (values) => {
            calls.push(["set", values]);
            Object.assign(storage, values);
          },
          get: async (key) => ({ [key]: storage[key] }),
        },
      },
      permissions: {
        // `answer` undefined models a popup that closed before Chrome answered.
        request: (permissions) => {
          calls.push(["request", permissions]);
          return answer === undefined ? new Promise(() => {}) : Promise.resolve(answer);
        },
        contains: async () => granted,
      },
    },
  };
}

test("the wish is stored before Chrome asks for access", () => {
  const chrome = fakeChrome();
  void enableMicButton(chrome.api);

  assert.deepEqual(chrome.calls, [
    ["set", { showMicButton: true }],
    ["request", ALL_SITES],
  ]);
});

test("the wish survives a popup that closes during the request", async () => {
  const chrome = fakeChrome();
  void enableMicButton(chrome.api);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(chrome.storage.showMicButton, true);
});

test("granted access keeps the button on", async () => {
  const chrome = fakeChrome({ answer: true });
  assert.equal(await enableMicButton(chrome.api), true);
  assert.equal(chrome.storage.showMicButton, true);
});

test("declined access turns the button off again", async () => {
  const chrome = fakeChrome({ answer: false });
  assert.equal(await enableMicButton(chrome.api), false);
  assert.equal(chrome.storage.showMicButton, false);
});

test("the next popup turns off a wish that never got access", async () => {
  const chrome = fakeChrome({ granted: false });
  chrome.storage.showMicButton = true;

  assert.equal(await reconcileMicButton(chrome.api), false);
  assert.equal(chrome.storage.showMicButton, false);
});

test("the next popup shows a granted wish as on", async () => {
  const chrome = fakeChrome({ granted: true });
  chrome.storage.showMicButton = true;

  assert.equal(await reconcileMicButton(chrome.api), true);
  assert.equal(chrome.storage.showMicButton, true);
});

test("a button that is off stays off", async () => {
  const chrome = fakeChrome({ granted: true });
  assert.equal(await reconcileMicButton(chrome.api), false);
  assert.deepEqual(chrome.calls, []);
});
