// Prints the CHANGELOG.md section for the version in extension/manifest.json.
// `--amo` prints it as the metadata web-ext sends to Firefox Add-ons instead.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);

export function currentVersion() {
  return JSON.parse(readFileSync(new URL("extension/manifest.json", root), "utf8")).version;
}

export function releaseNotes(changelog, version) {
  const section = changelog.split(/^## /m).slice(1).find((text) => text.split(/\s/, 1)[0] === version);
  const notes = section?.split("\n").slice(1).join("\n").trim();
  if (!notes) throw new Error(`CHANGELOG.md has no notes for ${version}.`);
  return notes;
}

export function amoMetadata(notes) {
  return { version: { release_notes: { "en-US": notes } } };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const notes = releaseNotes(readFileSync(new URL("CHANGELOG.md", root), "utf8"), currentVersion());
  console.log(process.argv.includes("--amo") ? JSON.stringify(amoMetadata(notes), null, 2) : notes);
}
