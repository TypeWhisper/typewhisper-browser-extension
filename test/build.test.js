import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { bundleModules, FIREFOX_ID, firefoxManifest, safariManifest } from "../scripts/build.js";

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

test("Safari runs a classic service worker and may ask TypeWhisper for the connection", () => {
  const manifest = safariManifest(chromeManifest);
  assert.deepEqual(manifest.background, { service_worker: "background.js" });
  assert.equal(manifest.minimum_chrome_version, undefined);
  assert.deepEqual(manifest.permissions, [...chromeManifest.permissions, "nativeMessaging"]);
  for (const key of ["version", "host_permissions", "optional_host_permissions", "commands", "action"]) {
    assert.deepEqual(manifest[key], chromeManifest[key], key);
  }
});

test("the Safari background bundle is one classic script with every module", () => {
  const bundle = bundleModules(fileURLToPath(new URL("../extension/background.js", import.meta.url)));
  assert.doesNotMatch(bundle, /^\s*(import|export)\b/m);
  // Parses as a classic script; a module syntax or a duplicate declaration would throw.
  new vm.Script(bundle);
  for (const module of ["api.js", "context.js", "mic-setting.js", "settings.js", "background.js"]) {
    assert.match(bundle, new RegExp(`^// ${module.replace(".", "\\.")}$`, "m"), module);
  }
  assert.ok(bundle.indexOf("// api.js") < bundle.indexOf("// settings.js"), "dependencies come first");
  assert.ok(bundle.indexOf("// settings.js") < bundle.indexOf("// background.js"), "the entry comes last");
});
