import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FIREFOX_ID, firefoxManifest } from "../scripts/build.js";

const chromeManifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("Firefox runs the background as a module event page", () => {
  const manifest = firefoxManifest(chromeManifest);
  assert.deepEqual(manifest.background, { scripts: ["background.js"], type: "module" });
  assert.equal(manifest.minimum_chrome_version, undefined);
});

test("Firefox gets a fixed id and declares the browsing activity it sends", () => {
  const { gecko, gecko_android } = firefoxManifest(chromeManifest).browser_specific_settings;
  assert.equal(gecko.id, FIREFOX_ID);
  assert.equal(gecko.strict_min_version, "140.0");
  assert.deepEqual(gecko.data_collection_permissions, { required: ["browsingActivity"] });
  assert.equal(gecko_android.strict_min_version, "142.0");
});

test("everything else stays as in the Chrome manifest", () => {
  const manifest = firefoxManifest(chromeManifest);
  for (const key of ["version", "permissions", "host_permissions", "optional_host_permissions", "commands", "action"]) {
    assert.deepEqual(manifest[key], chromeManifest[key], key);
  }
});
