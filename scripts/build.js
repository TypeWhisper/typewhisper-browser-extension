// Builds the Chrome, Firefox and Safari packages from extension/ into dist/.
// `node scripts/build.js` writes dist/chrome, dist/firefox and a store ZIP for each, and
// dist/safari, which TypeWhisper for Mac embeds as its Safari web extension.

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

/**
 * Safari runs the background as a classic service worker, without module support, and
 * ships inside TypeWhisper for Mac, which hands over the API port and token through
 * native messaging.
 */
export function safariManifest(manifest) {
  const { minimum_chrome_version: _chromeOnly, background, permissions, ...rest } = manifest;
  return {
    ...rest,
    permissions: [...permissions, "nativeMessaging"],
    background: { service_worker: background.service_worker },
  };
}

/**
 * Joins an ES module and the modules it imports from relative paths into one classic
 * script, dependencies first. It handles the import and export forms this extension uses:
 * named imports and exported declarations.
 */
export function bundleModules(entry) {
  const ordered = [];
  const visited = new Set();
  const visit = (file) => {
    if (visited.has(file)) return;
    visited.add(file);
    const code = readFileSync(file, "utf8");
    for (const match of code.matchAll(/^import\s+\{[^}]*\}\s+from\s+"(\.[^"]+)";/gm)) {
      visit(path.resolve(path.dirname(file), match[1]));
    }
    ordered.push({ file, code });
  };
  visit(entry);
  return ordered
    .map(({ file, code }) => {
      const body = code
        .replace(/^import\s+\{[^}]*\}\s+from\s+"[^"]+";\n/gm, "")
        .replace(/^export\s+(?=(async\s+)?(function|const|let|class)\b)/gm, "");
      if (/^\s*(import|export)\b/m.test(body)) {
        throw new Error(`${path.relative(source, file)} uses an import or export the bundler does not handle`);
      }
      return `// ${path.relative(source, file)}\n${body}`;
    })
    .join("\n");
}

function writeDirectory(target, manifest) {
  const directory = path.join(dist, target);
  cpSync(source, directory, { recursive: true });
  writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return directory;
}

function writePackage(target, manifest) {
  const directory = writeDirectory(target, manifest);
  const archive = path.join(dist, `typewhisper-${target}-${manifest.version}.zip`);
  execFileSync("zip", ["-q", "-r", "-X", archive, "."], { cwd: directory });
  return archive;
}

function writeSafari(manifest) {
  const safari = safariManifest(manifest);
  const directory = writeDirectory("safari", safari);
  const background = path.join(source, manifest.background.service_worker);
  writeFileSync(path.join(directory, safari.background.service_worker), bundleModules(background));
  return directory;
}

export function build() {
  const manifest = JSON.parse(readFileSync(path.join(source, "manifest.json"), "utf8"));
  rmSync(dist, { recursive: true, force: true });
  mkdirSync(dist);
  return {
    chrome: writePackage("chrome", manifest),
    firefox: writePackage("firefox", firefoxManifest(manifest)),
    safari: writeSafari(manifest),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [target, archive] of Object.entries(build())) {
    console.log(`${target}: ${path.relative(root, archive)}`);
  }
}
