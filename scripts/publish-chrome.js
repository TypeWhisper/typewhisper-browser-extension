// Uploads a Chrome package to the Chrome Web Store and submits it for review.
// `node scripts/publish-chrome.js dist/typewhisper-chrome-<version>.zip`
// CHROME_PUBLISHER_ID is the publisher's ID from the developer dashboard.
// CHROME_SERVICE_ACCOUNT_KEY is the JSON key of the service account that the
// dashboard lists under Account.

import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const CHROME_EXTENSION_ID = "gamnkdngnfamiajnbeglodoaoaifbheh";
export const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const API = "https://chromewebstore.googleapis.com";
const STATUS_INTERVAL = 10_000;
const STATUS_ATTEMPTS = 30;

async function readJSON(response, action) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${action} failed with HTTP ${response.status}: ${data.error?.message ?? JSON.stringify(data)}`);
  }
  return data;
}

/** Exchanges a JWT signed with the service account's key for an access token. */
export async function accessToken(key, { fetch = globalThis.fetch, now = Date.now() } = {}) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
  const claims = { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: issuedAt, exp: issuedAt + 3600 };
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key, "base64url");
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  return (await readJSON(response, "Sign-in")).access_token;
}

/** Uploads the package, waits until the store has processed it, and submits it for review. */
export async function publish({ archive, publisherId, itemId = CHROME_EXTENSION_ID, token, fetch = globalThis.fetch, wait = sleep }) {
  const item = `publishers/${publisherId}/items/${itemId}`;
  const headers = { Authorization: `Bearer ${token}` };

  const upload = await readJSON(
    await fetch(`${API}/upload/v2/${item}:upload`, { method: "POST", headers, body: readFileSync(archive) }),
    "Upload",
  );
  let state = upload.uploadState;
  for (let attempt = 0; state === "IN_PROGRESS" || state === "UPLOAD_IN_PROGRESS"; attempt++) {
    if (attempt === STATUS_ATTEMPTS) throw new Error("The Chrome Web Store is still processing the upload.");
    await wait(STATUS_INTERVAL);
    state = (await readJSON(await fetch(`${API}/v2/${item}:fetchStatus`, { headers }), "Status check")).lastAsyncUploadState;
  }
  if (state !== "SUCCEEDED") throw new Error(`Upload ended as ${state}: ${JSON.stringify(upload)}`);

  return readJSON(await fetch(`${API}/v2/${item}:publish`, { method: "POST", headers }), "Submission");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archive = process.argv[2];
  const { CHROME_PUBLISHER_ID: publisherId, CHROME_SERVICE_ACCOUNT_KEY: key } = process.env;
  if (!archive || !publisherId || !key) {
    console.error("Usage: CHROME_PUBLISHER_ID=… CHROME_SERVICE_ACCOUNT_KEY=… node scripts/publish-chrome.js <zip>");
    process.exit(1);
  }
  const token = await accessToken(JSON.parse(key));
  const result = await publish({ archive, publisherId, token });
  console.log(`Submitted ${archive} to the Chrome Web Store: ${result.state}`);
}
