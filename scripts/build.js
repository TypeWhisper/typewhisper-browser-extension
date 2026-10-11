// Builds the Chrome and Firefox packages from extension/ into dist/.
// `node scripts/build.js` writes dist/chrome, dist/firefox and a store ZIP for each.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "extension");
const dist = path.join(root, "dist");

export const FIREFOX_ID = "browser-extension@typewhisper.com";

/**
 * Firefox runs the background as an event page instead of a service worker,
 * needs a fixed add-on id for signing, and asks new add-ons to declare what
 * they transmit: the extension sends the active tab's address to TypeWhisper.
 */
export function firefoxManifest(manifest) {
  const { minimum_chrome_version: _chromeOnly, background, ...rest } = manifest;
  return {
    ...rest,
    background: { scripts: [background.service_worker], type: background.type },
    browser_specific_settings: {
      gecko: {
        id: FIREFOX_ID,
        // The first version that shows the data collection consent at install.
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["browsingActivity"] },
      },
      // The extension needs TypeWhisper on the same computer, so it targets desktop
      // Firefox; this only states the first Android version that knows the key above.
      gecko_android: { strict_min_version: "142.0" },
    },
  };
}

function writePackage(target, manifest) {
  const directory = path.join(dist, target);
  cpSync(source, directory, { recursive: true });
  writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const archive = path.join(dist, `typewhisper-${target}-${manifest.version}.zip`);
  execFileSync("zip", ["-q", "-r", "-X", archive, "."], { cwd: directory });
  return archive;
}

export function build() {
  const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist);
  return {
    chrome: writePackage("chrome", manifest),
    firefox: writePackage("firefox", firefoxManifest(manifest)),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [target, archive] of Object.entries(build())) {
    console.log(`${target}: ${path.relative(root, archive)}`);
  }
}
