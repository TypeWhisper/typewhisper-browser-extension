import assert from "node:assert/strict";
import test from "node:test";
import { APIError, apiRequest, putBrowserContext } from "../extension/api.js";

function fakeFetch(status, body, calls = []) {
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body === undefined ? "" : JSON.stringify(body), { status });
  };
  return { fetchImpl, calls };
}

test("requests go to 127.0.0.1 with the bearer token and a JSON body", async () => {
  const { fetchImpl, calls } = fakeFetch(200, { status: "active" });
  const report = { client_id: "c", focused: true, url: "https://a.example/", title: "A" };

  const result = await putBrowserContext({ port: 9123, token: "secret" }, report, { fetchImpl });

  assert.deepEqual(result, { status: "active" });
  assert.equal(calls[0].url, "http://127.0.0.1:9123/v1/browser/context");
  assert.equal(calls[0].init.method, "PUT");
  assert.equal(calls[0].init.headers.Authorization, "Bearer secret");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), report);
});

test("requests without a token send no Authorization header", async () => {
  const { fetchImpl, calls } = fakeFetch(200, {});
  await apiRequest({ token: "" }, "GET", "/v1/status", { fetchImpl });
  assert.equal(calls[0].url, "http://127.0.0.1:8978/v1/status");
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test("API errors are classified", async () => {
  const cases = [
    [401, "unauthorized"],
    [404, "unsupported"],
    [409, "conflict"],
    [500, "http"],
  ];
  for (const [status, kind] of cases) {
    const { fetchImpl } = fakeFetch(status, { error: { code: "x", message: `failed ${status}` } });
    await assert.rejects(apiRequest({}, "GET", "/v1/status", { fetchImpl }), (error) => {
      assert.ok(error instanceof APIError);
      assert.equal(error.kind, kind);
      assert.equal(error.message, `failed ${status}`);
      return true;
    });
  }
});

test("an unreachable app is reported as offline", async () => {
  const fetchImpl = async () => {
    throw new TypeError("fetch failed");
  };
  await assert.rejects(apiRequest({}, "GET", "/v1/status", { fetchImpl }), { kind: "offline" });
});
