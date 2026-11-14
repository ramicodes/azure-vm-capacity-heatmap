import test from "node:test";
import assert from "node:assert/strict";
import { armEnvironment, armCacheKey, authFailureMessage, ARM_ORIGIN, ARM_SCOPE } from "../src/lib/arm-config.ts";
import { armEndpoint, armPageUrl, armListPage, managedArmItems, fetchArmList, ArmReadError } from "../src/lib/arm-http.ts";
import { getRouterBasename } from "../src/lib/router-basename.ts";

const CLIENT = "00000000-1111-2222-3333-444444444444";
const TENANT = "11111111-2222-3333-4444-555555555555";
const env = { VITE_ARM_MODE: "standalone", VITE_AZURE_CLIENT_ID: CLIENT, VITE_AZURE_TENANT_ID: TENANT };
const local = "http://127.0.0.1:5173";
const response = (data) => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
const token = async () => "fixture-token";
const request = { kind: "subscriptions" };
const pageUrl = (page) => `${ARM_ORIGIN}/subscriptions?api-version=2022-12-01&page=${page}`;

test("standalone and CLI direct routes use the origin root without a matching build mount", () => {
  for (const mode of ["standalone", "cli", "hosted"]) {
    for (const base of ["./", "/", ""]) {
      for (const route of ["/", "/charts", "/missing"]) {
        assert.equal(getRouterBasename(base, route, mode), "/");
      }
    }
  }
});

test("matching preview mounts retain their exact basename in every mode", () => {
  for (const mode of ["managed", "standalone", "cli", "hosted"]) {
    for (const route of ["/v1/dev/session", "/v1/dev/session/", "/v1/dev/session/charts"]) {
      assert.equal(getRouterBasename("/v1/dev/session/", route, mode), "/v1/dev/session");
    }
  }
  assert.equal(getRouterBasename("/v1/dev/session/", "/v1/dev/session-other/charts", "managed"), "/v1/");
});

test("managed deployed apps retain first-segment fallback without a matching build mount", () => {
  for (const base of ["./", "/", "", "/other/"]) {
    assert.equal(getRouterBasename(base, "/published/charts", "managed"), "/published/");
    assert.equal(getRouterBasename(base, "/", "managed"), "/");
  }
});

test("localhost defaults to standalone and missing config fails closed", () => {
  for (const origin of [local, "http://localhost:5173", "http://[::1]:5173"]) {
    const config = armEnvironment({}, origin);
    assert.equal(config.mode, "standalone");
    assert.equal(config.config, null);
    assert.equal(config.problems.length, 2);
  }
  assert.equal(armEnvironment({}, "https://apps.example").mode, "managed");
  assert.equal(armEnvironment({ VITE_ARM_MODE: "managed" }, local).mode, "managed");
  assert.equal(armEnvironment({ VITE_ARM_MODE: "typo" }, local).config, null);
});

test("public GUID config, fixed Microsoft authority and exact root redirect validate", () => {
  const result = armEnvironment(env, local);
  assert.deepEqual(result.problems, []);
  assert.equal(result.config.authority, `https://login.microsoftonline.com/${TENANT}`);
  assert.equal(result.config.redirectUri, `${local}/`);
  assert.equal(armEnvironment({ ...env, VITE_AZURE_CLIENT_ID: `api://${CLIENT}` }, local).config, null);
  for (const tenant of ["", "common", "consumers", "https://evil.invalid"]) {
    assert.equal(armEnvironment({ ...env, VITE_AZURE_TENANT_ID: tenant }, local).config, null);
  }
  assert.equal(armEnvironment({ ...env, VITE_AZURE_TENANT_ID: "organizations" }, local).config.tenant, "organizations");
  assert.equal(ARM_SCOPE, "https://management.azure.com/user_impersonation");
});

test("redirects reject cross-origin, credentials, query, hash, non-root and non-loopback HTTP", () => {
  for (const redirect of [
    "https://evil.invalid/", "http://localhost:5173/", `${local}/charts`, `${local}/?code=secret`,
    `${local}/#token`, "http://user:password@127.0.0.1:5173/", "javascript:alert(1)", "not a URL",
  ]) {
    assert.equal(armEnvironment({ ...env, VITE_AZURE_REDIRECT_URI: redirect }, local).config, null);
  }
  assert.equal(armEnvironment(env, "http://example.invalid").config, null);
  assert.equal(armEnvironment(env, "https://example.invalid").config.redirectUri, "https://example.invalid/");
});

test("ARM cache identity separates mode, account, tenant and client", () => {
  const config = armEnvironment(env, local);
  const a = armCacheKey(config, "account-a");
  assert.notEqual(a, armCacheKey(config, "account-b"));
  assert.notEqual(a, armCacheKey(config, null));
  assert.notEqual(a, armCacheKey(config, "account-a", 1));
  assert.notEqual(a, armCacheKey(armEnvironment({ ...env, VITE_AZURE_TENANT_ID: CLIENT }, local), "account-a"));
  assert.notEqual(a, armCacheKey(armEnvironment({ ...env, VITE_AZURE_CLIENT_ID: TENANT }, local), "account-a"));
  assert.equal(armCacheKey(armEnvironment({}, "https://apps.example"), "account-a"), "managed");
});

test("sign-in errors use fixed safe copy, never raw provider messages", () => {
  for (const errorCode of ["user_cancelled", "popup_window_error", "consent_required", "unknown", "secret"]) {
    const message = authFailureMessage({ errorCode, message: "private-token-and-tenant-details" });
    assert.ok(message);
    assert.ok(!message.includes("private-token"));
    assert.ok(!message.includes("secret"));
  }
  assert.match(authFailureMessage({ errorCode: "user_cancelled" }), /cancelled/);
});

test("only fixed read endpoints and documented API versions are constructed", () => {
  assert.deepEqual(armEndpoint({ kind: "subscriptions" }), { path: "/subscriptions", version: "2022-12-01" });
  assert.equal(armEndpoint({ kind: "regions", subscriptionId: CLIENT }).path, `/subscriptions/${CLIENT}/locations`);
  assert.equal(armEndpoint({ kind: "skus", subscriptionId: CLIENT }).version, "2021-07-01");
  const quota = armEndpoint({ kind: "quota", subscriptionId: CLIENT, region: "eastus/../../x?token=bad" });
  assert.equal(quota.version, "2025-04-01");
  assert.match(quota.path, /eastus%2F/);
  assert.ok(!quota.path.includes("?"));
});

test("all direct pages merge using GET, bearer auth, omitted cookies and rejected redirects", async () => {
  const calls = [];
  const items = await fetchArmList(request, token, undefined, async (url, init) => {
    calls.push({ url, init });
    return response(calls.length === 1 ? { value: [{ id: 1 }], nextLink: pageUrl(2) } : { value: [{ id: 2 }] });
  });
  assert.deepEqual(items, [{ id: 1 }, { id: 2 }]);
  assert.equal(calls.length, 2);
  for (const { url, init } of calls) {
    assert.equal(new URL(url).origin, ARM_ORIGIN);
    assert.equal(init.method, "GET");
    assert.equal(init.headers.Authorization, "Bearer fixture-token");
    assert.equal(init.credentials, "omit");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(!url.includes("fixture-token"));
  }
});

test("pagination is validated before requesting a token for the next destination", async () => {
  for (const nextLink of [
    "https://evil.invalid/subscriptions?api-version=2022-12-01",
    "http://management.azure.com/subscriptions?api-version=2022-12-01",
    "https://user:pass@management.azure.com/subscriptions?api-version=2022-12-01",
    `${ARM_ORIGIN}/other?api-version=2022-12-01`, `${ARM_ORIGIN}/subscriptions?api-version=bad`,
    `${ARM_ORIGIN}/subscriptions?api-version=2022-12-01#secret`,
    `${ARM_ORIGIN}/subscriptions?api-version=2022-12-01&api-version=other`,
  ]) {
    let tokens = 0, requests = 0;
    await assert.rejects(fetchArmList(request, async () => { tokens++; return "fixture-token"; }, undefined,
      async () => { requests++; return response({ value: [1], nextLink }); }), /pagination/i);
    assert.equal(tokens, 1);
    assert.equal(requests, 1);
  }
  assert.equal(armPageUrl("/subscriptions?api-version=2022-12-01&page=2", "/subscriptions", "2022-12-01").origin, ARM_ORIGIN);
});

test("cyclic pagination and more than 100 pages fail without returning partial results", async () => {
  let requests = 0;
  await assert.rejects(fetchArmList(request, token, undefined, async () => {
    requests++;
    return response({ value: [1], nextLink: `${ARM_ORIGIN}/subscriptions?api-version=2022-12-01` });
  }), /repeated/);
  assert.equal(requests, 1);
  requests = 0;
  await assert.rejects(fetchArmList(request, token, undefined, async () => {
    requests++;
    return response({ value: [requests], nextLink: pageUrl(requests + 1) });
  }), /100-page/);
  assert.equal(requests, 100);
});

test("list shape, oversized results and managed pagination reject incomplete data", async () => {
  assert.throws(() => armListPage({ value: [], nextLink: 123 }), /pagination/);
  assert.throws(() => armListPage({ items: [] }), /unexpected/);
  assert.deepEqual(managedArmItems({ value: [1] }), [1]);
  assert.deepEqual(managedArmItems([1]), [1]);
  assert.throws(() => managedArmItems({ value: [1], nextLink: pageUrl(2) }), /managed connector/);
  await assert.rejects(fetchArmList(request, token, undefined,
    async () => response({ value: Array(100001).fill(null) })), /100,000-item/);
});

test("HTTP, network and JSON errors are explicit and do not echo raw service data", async () => {
  for (const status of [401, 403, 429, 500]) {
    await assert.rejects(fetchArmList(request, token, undefined, async () => new Response("private-service-details", { status })),
      (error) => error instanceof ArmReadError && error.code === `http-${status}` && !error.message.includes("private-service-details"));
  }
  await assert.rejects(fetchArmList(request, token, undefined, async () => { throw new Error("private-network-details"); }),
    (error) => error.code === "network" && !error.message.includes("private-network-details"));
  await assert.rejects(fetchArmList(request, token, undefined, async () => new Response("{invalid")),
    (error) => error.code === "shape");
});

test("failure on a later page never publishes the earlier page as a successful result", async () => {
  let requests = 0;
  await assert.rejects(fetchArmList(request, token, undefined, async () => {
    requests++;
    return requests === 1 ? response({ value: [{ id: "partial" }], nextLink: pageUrl(2) })
      : new Response("private-details", { status: 403 });
  }), (error) => error.code === "http-403");
  assert.equal(requests, 2);
});

test("aborted requests stop before token use, network dispatch or result publication", async () => {
  const before = new AbortController();
  before.abort();
  await assert.rejects(fetchArmList(request, () => { throw new Error("must not acquire token"); }, before.signal),
    (error) => error.name === "AbortError");
  const duringToken = new AbortController();
  await assert.rejects(fetchArmList(request, async () => { duringToken.abort(); return "fixture-token"; }, duringToken.signal,
    async () => { throw new Error("must not fetch"); }), (error) => error.name === "AbortError");
  const afterFetch = new AbortController();
  await assert.rejects(fetchArmList(request, token, afterFetch.signal, async () => {
    afterFetch.abort(); return response({ value: [1] });
  }), (error) => error.name === "AbortError");
});

test("cancellation during response parsing cannot publish a successful result", async () => {
  const controller = new AbortController();
  await assert.rejects(fetchArmList(request, token, controller.signal, async () => ({
    ok: true, json: async () => { controller.abort(); return { value: [1] }; },
  })), (error) => error.name === "AbortError");
});
