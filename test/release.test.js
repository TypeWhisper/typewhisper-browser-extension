import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CHROME_EXTENSION_ID, TOKEN_URL, accessToken, publish } from "../scripts/publish-chrome.js";
import { amoMetadata, currentVersion, releaseNotes } from "../scripts/release-notes.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

const CHANGELOG = `# Changelog

## 0.2.0 (2026-11-02)

- Second change.
- Third change.

## 0.1.10 (2026-11-01)

## 0.1.1 (2026-10-20)

- First change.
`;

test("package.json, package-lock.json and the manifest carry the same version", () => {
  const version = currentVersion();
  const lock = JSON.parse(read("package-lock.json"));
  assert.equal(JSON.parse(read("package.json")).version, version);
  assert.equal(lock.version, version);
  assert.equal(lock.packages[""].version, version);
});

test("CHANGELOG.md lists the changes in this version", () => {
  assert.ok(releaseNotes(read("CHANGELOG.md"), currentVersion()));
});

test("release notes are the section of the requested version", () => {
  assert.equal(releaseNotes(CHANGELOG, "0.2.0"), "- Second change.\n- Third change.");
  assert.equal(releaseNotes(CHANGELOG, "0.1.1"), "- First change.");
});

test("a version without notes has no release notes", () => {
  assert.throws(() => releaseNotes(CHANGELOG, "0.1.10"), /no notes for 0\.1\.10/);
  assert.throws(() => releaseNotes(CHANGELOG, "0.1"), /no notes for 0\.1\./);
});

test("Firefox Add-ons gets the notes as the version's English release notes", () => {
  assert.deepEqual(amoMetadata("- First change."), { version: { release_notes: { "en-US": "- First change." } } });
});

test("the Chrome sign-in sends a JWT signed with the service account's key", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const key = { client_email: "release@example.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) };
  let request;
  const fetch = async (url, init) => {
    request = { url, body: init.body };
    return Response.json({ access_token: "token-1" });
  };

  assert.equal(await accessToken(key, { fetch, now: 1_000_000 }), "token-1");
  assert.equal(request.url, TOKEN_URL);
  assert.equal(request.body.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [header, claims, signature] = request.body.get("assertion").split(".");
  const decode = (part) => JSON.parse(Buffer.from(part, "base64url"));
  assert.deepEqual(decode(header), { alg: "RS256", typ: "JWT" });
  assert.deepEqual(decode(claims), {
    iss: key.client_email,
    scope: "https://www.googleapis.com/auth/chromewebstore",
    aud: TOKEN_URL,
    iat: 1000,
    exp: 4600,
  });
  assert.ok(createVerify("RSA-SHA256").update(`${header}.${claims}`).verify(publicKey, signature, "base64url"));
});

function chromeStore(responses) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, method: init.method ?? "GET", auth: init.headers?.Authorization, size: init.body?.length });
    const [status, body] = responses.shift();
    return Response.json(body, { status });
  };
  return { requests, fetch };
}

const ITEM = `https://chromewebstore.googleapis.com/v2/publishers/pub-1/items/${CHROME_EXTENSION_ID}`;
const archive = new URL("../extension/icons/icon-16.png", import.meta.url);

test("Chrome publishing uploads the package, waits for processing, then submits it", async () => {
  const store = chromeStore([
    [200, { uploadState: "IN_PROGRESS" }],
    [200, { lastAsyncUploadState: "IN_PROGRESS" }],
    [200, { lastAsyncUploadState: "SUCCEEDED" }],
    [200, { state: "PENDING_REVIEW" }],
  ]);
  let waits = 0;
  const result = await publish({ archive, publisherId: "pub-1", token: "token-1", fetch: store.fetch, wait: async () => waits++ });

  assert.equal(result.state, "PENDING_REVIEW");
  assert.equal(waits, 2);
  assert.deepEqual(
    store.requests.map(({ url, method }) => `${method} ${url}`),
    [
      `POST ${ITEM.replace("/v2/", "/upload/v2/")}:upload`,
      `GET ${ITEM}:fetchStatus`,
      `GET ${ITEM}:fetchStatus`,
      `POST ${ITEM}:publish`,
    ],
  );
  assert.ok(store.requests.every(({ auth }) => auth === "Bearer token-1"));
  assert.equal(store.requests[0].size, readFileSync(archive).length);
});

test("Chrome publishing stops when the upload fails", async () => {
  const store = chromeStore([[200, { uploadState: "FAILED" }]]);
  await assert.rejects(publish({ archive, publisherId: "pub-1", token: "t", fetch: store.fetch }), /Upload ended as FAILED/);
  assert.equal(store.requests.length, 1);
});

test("Chrome publishing reports the store's error message", async () => {
  const store = chromeStore([[400, { error: { message: "The version must be higher." } }]]);
  await assert.rejects(
    publish({ archive, publisherId: "pub-1", token: "t", fetch: store.fetch }),
    /Upload failed with HTTP 400: The version must be higher\./,
  );
});
