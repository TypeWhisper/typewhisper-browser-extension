// Runs from `npm version <patch|minor|major>` after npm has bumped package.json:
// copies the new version into extension/manifest.json and adds a heading for it
// to CHANGELOG.md. The tests fail until that section lists the changes.

import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

const manifestFile = new URL("extension/manifest.json", root);
const manifest = readFileSync(manifestFile, "utf8");
// Replaces the value in place, so the rest of the file keeps its formatting.
writeFileSync(manifestFile, manifest.replace(/"version": "[^"]*"/, `"version": "${version}"`));

const changelogFile = new URL("CHANGELOG.md", root);
const changelog = readFileSync(changelogFile, "utf8");
if (!changelog.includes(`\n## ${version} `)) {
  const today = new Date().toLocaleDateString("sv");
  writeFileSync(changelogFile, changelog.replace("\n## ", `\n## ${version} (${today})\n\n## `));
}
