import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/retail-prices/index.cjs";
import { buildRetailPriceUrl } from "../src/lib/azure-pricing.ts";

const request = () => ({
  method: "GET",
  url: buildRetailPriceUrl("Standard_D2s_v5", "eastus")
    .replace("https://prices.azure.com/api/retail/prices", "https://planner.example/api/retail-prices"),
});
const context = () => ({ warn() {}, error() {} });

test("proxies exact public prices without forwarding credentials and caches only success", async (t) => {
  const body = { Items: [{ retailPrice: 0.1 }], NextPageLink: null };
  const fetcher = t.mock.method(globalThis, "fetch", async (url, init) => {
    assert.equal(url.origin, "https://prices.azure.com");
    assert.equal(url.pathname, "/api/retail/prices");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.deepEqual(init.headers, { Accept: "application/json" });
    return Response.json(body);
  });
  const ctx = context();
  await handler(ctx, { ...request(), headers: { authorization: "must-not-forward" } });
  assert.equal(fetcher.mock.calls.length, 1);
  assert.equal(ctx.res.status, 200);
  assert.deepEqual(JSON.parse(ctx.res.body), body);
  assert.match(ctx.res.headers["Cache-Control"], /^public/);
});

test("rejects broad filters, extra or duplicate parameters and unbounded pagination before fetching", async (t) => {
  const fetcher = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const invalid = [
    ["$filter", "serviceName eq 'Virtual Machines'"],
    ["url", "https://example.com"],
    ["$skip", "5000"],
    ["$top", "10000"],
    ["api-version", "unsupported"],
  ];
  for (const [key, value] of invalid) {
    const req = request();
    const url = new URL(req.url);
    url.searchParams.set(key, value);
    const ctx = context();
    await handler(ctx, { ...req, url: url.toString() });
    assert.equal(ctx.res.status, 400);
  }
  const ctx = context();
  await handler(ctx, { ...request(), url: `${request().url}&api-version=2023-01-01-preview` });
  assert.equal(ctx.res.status, 400);
  assert.equal(fetcher.mock.calls.length, 0);
});

test("reports upstream failures and invalid or oversized responses without caching them", async (t) => {
  const responses = [
    new Response("busy", { status: 429 }),
    new Response("failed", { status: 500 }),
    new Response("not JSON"),
    Response.json({ Items: "invalid" }),
    new Response("x".repeat(4 * 1024 * 1024 + 1)),
  ];
  t.mock.method(globalThis, "fetch", async () => responses.shift());
  for (const expected of [429, 502, 502, 502, 502]) {
    const ctx = context();
    await handler(ctx, request());
    assert.equal(ctx.res.status, expected);
    assert.equal(ctx.res.headers["Cache-Control"], "no-store");
    assert.ok(JSON.parse(ctx.res.body).error);
  }
});

test("rejects writes without calling the price service", async (t) => {
  const fetcher = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const ctx = context();
  await handler(ctx, { ...request(), method: "POST" });
  assert.equal(ctx.res.status, 405);
  assert.equal(fetcher.mock.calls.length, 0);
});
