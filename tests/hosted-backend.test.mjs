import assert from "node:assert/strict";
import { once } from "node:events";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { authorizedPrincipal, boundedArmFetch, createPlannerServer, hostedConfig, hostedRequest, managedIdentityToken } from "../server/app.mjs";
import { hostedSession, readHostedArm } from "../src/lib/hosted-session.ts";
import { armCacheKey, armEnvironment } from "../src/lib/arm-config.ts";

const subscription = "00000000-1111-2222-3333-444444444444";
const tenant = "11111111-2222-3333-4444-555555555555";
const user = "22222222-3333-4444-5555-666666666666";
const other = "33333333-4444-5555-6666-777777777777";
const config = { subscription, tenant, allowedUsers: [user] };
const principal = (claims = [{ typ: "tid", val: tenant }, { typ: "oid", val: user }], auth_typ = "aad") =>
  Buffer.from(JSON.stringify({ claims, auth_typ })).toString("base64");
const headers = { "x-ms-client-principal": principal() };
const response = (data) => new Response(JSON.stringify(data));

test("packaging rejects the repository and its descendants before building or copying", () => {
  const script = fileURLToPath(new URL("../scripts/package-app-service.mjs", import.meta.url));
  const root = fileURLToPath(new URL("../", import.meta.url));
  for (const target of [root, path.join(root, "dist", "invalid-release")]) {
    const result = spawnSync(process.execPath, [script, target], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /empty, explicit packaging directory outside the repository root/);
  }
});

async function fixture(t, options = {}) {
  const server = createPlannerServer({ config, getToken: async () => "server-only-fixture-token", log: { error() {}, warn() {} }, ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  return (url, options = {}) => fetch(`${base}${url}`, { headers, ...options });
}

test("hosted mode isolates cache scope and requires explicit production identity configuration", () => {
  const environment = armEnvironment({ VITE_ARM_MODE: "hosted" }, "https://planner.example");
  assert.equal(environment.mode, "hosted");
  assert.equal(environment.config, null);
  assert.notEqual(armCacheKey(environment, user, 0, subscription), armCacheKey(environment, other, 0, subscription));
  assert.notEqual(armCacheKey(environment, user, 0, subscription), armCacheKey(environment, user, 0, other));
  const env = { WEBSITE_SITE_NAME: "planner", PLANNER_SUBSCRIPTION_ID: subscription, PLANNER_TENANT_ID: tenant, PLANNER_ALLOWED_USER_IDS: user };
  assert.deepEqual(hostedConfig(env), config);
  for (const key of Object.keys(env)) assert.throws(() => hostedConfig({ ...env, [key]: "" }));
  assert.throws(() => hostedConfig({ ...env, PLANNER_ALLOWED_USER_IDS: `${user},` }));
});

test("the Easy Auth boundary rejects anonymous, malformed, wrong-provider and foreign identity claims", () => {
  assert.equal(authorizedPrincipal(headers, config), user);
  for (const value of ["!", "bnVsbA==", principal([], "aad"), principal(undefined, "github"),
    principal([{ typ: "tid", val: other }, { typ: "oid", val: user }]),
    principal([{ typ: "tid", val: tenant }, { typ: "oid", val: other }]),
    principal([{ typ: "tid", val: tenant }, { typ: "oid", val: user }, { typ: "oid", val: other }])]) {
    assert.throws(() => authorizedPrincipal({ "x-ms-client-principal": value }, config), (error) => [401, 403].includes(error.status));
  }
  assert.throws(() => authorizedPrincipal({}, config), (error) => error.status === 401);
});

test("only fixed reads of the configured subscription are admitted", () => {
  const request = (query) => hostedRequest(new URL(`https://planner.example/api/arm?${query}`), config);
  assert.deepEqual(request("kind=subscriptions"), { kind: "subscriptions" });
  assert.deepEqual(request(`kind=quota&subscriptionId=${subscription}&region=eastus2`), { kind: "quota", subscriptionId: subscription, region: "eastus2" });
  for (const query of ["kind=subscriptions&url=https://evil.invalid", "kind=subscriptions&kind=subscriptions",
    `kind=skus&subscriptionId=${other}`, `kind=quota&subscriptionId=${subscription}&region=../westus`,
    `kind=regions&subscriptionId=${subscription}&region=eastus`, `kind=write&subscriptionId=${subscription}`, "kind=subscriptions&refresh=0"]) {
    assert.throws(() => request(query), (error) => error.status === 400);
  }
});

test("anonymous users receive no static or subscription data, and session responses expose no tokens", async (t) => {
  let armCalls = 0;
  const request = await fixture(t, { fetcher: async () => { armCalls++; return response({}); } });
  for (const route of ["/", "/shortlist", "/api/session", "/api/arm?kind=subscriptions", "/api/retail-prices"]) {
    assert.equal((await request(route, { headers: {} })).status, 401);
  }
  assert.deepEqual(await (await request("/healthz", { headers: {} })).json(), { status: "ok" });
  const session = await request("/api/session");
  assert.equal(session.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(await session.json(), { identity: user, tenant, subscriptionId: subscription });
  assert.equal(armCalls, 0);
});

test("read-only methods, cross-origin requests and unknown files are rejected before Azure access", async (t) => {
  let calls = 0;
  const request = await fixture(t, { getToken: async () => { calls++; return "token"; } });
  assert.equal((await request("/api/arm?kind=subscriptions", { method: "POST", body: "{}" })).status, 405);
  assert.equal((await request("/api/arm?kind=subscriptions", { method: "HEAD" })).status, 405);
  assert.equal((await request("/api/session", { headers: { ...headers, Origin: "https://evil.invalid" } })).status, 403);
  for (const route of ["/api/unknown", "/server/app.mjs", "/..%2fserver/app.mjs"]) assert.equal((await request(route)).status, 404);
  assert.equal(calls, 0);
});

test("ARM tokens remain server-side, catalog projections are shared and cache expiry triggers a fresh read", async (t) => {
  let now = Date.parse("2026-01-01T00:00:00Z");
  let calls = 0;
  const request = await fixture(t, {
    now: () => now,
    fetcher: async (url, options) => {
      calls++;
      assert.equal(new URL(url).pathname, `/subscriptions/${subscription}/providers/Microsoft.Compute/skus`);
      assert.equal(options.headers.Authorization, "Bearer server-only-fixture-token");
      assert.equal(options.redirect, "error");
      return response({ value: [{ name: "Standard_D2", resourceType: "virtualMachines", secretMetadata: "must-not-leak", capabilities: [{ name: "vCPUs", value: "2" }, { name: "Unrelated", value: "remove" }] }] });
    },
  });
  const route = `/api/arm?kind=skus&subscriptionId=${subscription}`;
  const result = await (await request(route)).json();
  assert.equal(result.cached, false);
  assert.equal(result.items[0].secretMetadata, undefined);
  assert.deepEqual(result.items[0].capabilities, [{ name: "vCPUs", value: "2" }]);
  assert.equal(JSON.stringify(result).includes("server-only-fixture-token"), false);
  const cached = await (await request(route)).json();
  assert.equal(cached.cached, true);
  assert.equal(cached.fetchedAt, result.fetchedAt);
  assert.equal(calls, 1);
  assert.equal((await (await request(`${route}&refresh=1`)).json()).cached, false);
  assert.equal(calls, 2);
  now += 15 * 60000 + 1;
  assert.equal((await (await request(route)).json()).cached, false);
  assert.equal(calls, 3);
});

test("subscription discovery is pinned and foreign pagination never yields partial success or raw service output", async (t) => {
  let calls = 0;
  const request = await fixture(t, { fetcher: async (url) => {
    calls++;
    const path = new URL(url).pathname;
    if (path === `/subscriptions/${subscription}`) return response({ subscriptionId: subscription, displayName: "Configured subscription", state: "Enabled", private: "excluded" });
    return response({ value: [{ name: "fixture" }], nextLink: "https://evil.invalid/?credential=must-not-leak" });
  } });
  assert.deepEqual((await (await request("/api/arm?kind=subscriptions")).json()).items, [{ subscriptionId: subscription, displayName: "Configured subscription", state: "Enabled" }]);
  const bad = await request(`/api/arm?kind=regions&subscriptionId=${subscription}`);
  assert.equal(bad.status, 502);
  const body = await bad.text();
  assert.equal(/credential|must-not-leak|fixture/.test(body), false);
  assert.equal(calls, 2);
});

test("identical reads coalesce and excessive distinct ARM reads are rejected", async (t) => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const ready = [];
  const request = await fixture(t, { fetcher: async () => { calls++; for (const notify of ready.splice(0)) notify(); await gate; return response({ value: [] }); } });
  const started = (count) => calls >= count ? Promise.resolve() : new Promise((resolve) => {
    const check = () => calls >= count ? resolve() : ready.push(check);
    ready.push(check);
  });
  const first = request(`/api/arm?kind=quota&subscriptionId=${subscription}&region=eastus`);
  const duplicate = request(`/api/arm?kind=quota&subscriptionId=${subscription}&region=eastus`);
  const second = request(`/api/arm?kind=quota&subscriptionId=${subscription}&region=westus`);
  const third = request(`/api/arm?kind=quota&subscriptionId=${subscription}&region=centralus`);
  await started(3);
  try { assert.equal((await request(`/api/arm?kind=quota&subscriptionId=${subscription}&region=northeurope`)).status, 429); }
  finally { release(); }
  for (const result of await Promise.all([first, duplicate, second, third])) assert.equal(result.status, 200);
  assert.equal(calls, 3);
});

test("managed identity token refresh is single-flight, uses only ARM resource and never accepts invalid expiry", async () => {
  let now = Date.now();
  let calls = 0;
  const token = managedIdentityToken({ IDENTITY_ENDPOINT: "http://127.0.0.1/identity", IDENTITY_HEADER: "provider-only" }, async (url, options) => {
    calls++;
    assert.equal(url.searchParams.get("resource"), "https://management.azure.com/");
    assert.equal(url.searchParams.has("client_id"), false);
    assert.equal(options.headers["X-IDENTITY-HEADER"], "provider-only");
    return response({ access_token: "fixture-mi-token", expires_on: Math.floor((now + 10 * 60000) / 1000) });
  }, () => now);
  assert.deepEqual(await Promise.all([token(), token()]), ["fixture-mi-token", "fixture-mi-token"]);
  assert.equal(calls, 1);
  now += 9 * 60000;
  await token();
  assert.equal(calls, 2);
  await assert.rejects(managedIdentityToken({}, async () => response({}))(), (error) => error.code === "identity");
  await assert.rejects(managedIdentityToken({ IDENTITY_ENDPOINT: "http://127.0.0.1", IDENTITY_HEADER: "fixture" }, async () => response({ access_token: "token", expires_on: "invalid" }))());
});

test("ARM response byte limits apply cumulatively across pages", async () => {
  const fetcher = boundedArmFetch(async () => new Response("123456"), 10);
  await fetcher("https://management.azure.com", {});
  await assert.rejects(fetcher("https://management.azure.com", {}), (error) => error.code === "size");
});

test("hosted client validates session and provenance without accepting malformed data", async (t) => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  assert.deepEqual(hostedSession({ identity: user, tenant, subscriptionId: subscription }), { identity: user, tenant, subscriptionId: subscription });
  assert.throws(() => hostedSession({ identity: user, tenant, subscriptionId: "not-a-guid" }));
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url, "https://planner.example").pathname, "/api/arm");
    assert.equal(new URL(url, "https://planner.example").searchParams.has("refresh"), false);
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.redirect, "error");
    return response({ items: [], cached: true, fetchedAt: "2026-01-01T00:00:00Z" });
  };
  let metadata;
  assert.deepEqual(await readHostedArm({ kind: "subscriptions" }, undefined, (value) => { metadata = value; }), []);
  assert.equal(metadata.cached, true);
  globalThis.fetch = async (url) => {
    assert.equal(new URL(url, "https://planner.example").searchParams.get("refresh"), "1");
    return response({ items: [], cached: false, fetchedAt: "2026-01-01T00:01:00Z" });
  };
  await readHostedArm({ kind: "subscriptions" });
  globalThis.fetch = async () => response({ items: [], cached: true, fetchedAt: "invalid" });
  await assert.rejects(readHostedArm({ kind: "subscriptions" }), (error) => error.code === "hosted-shape");
  globalThis.fetch = async () => new Response("private raw error", { status: 401 });
  await assert.rejects(readHostedArm({ kind: "subscriptions" }), (error) => error.code === "hosted-401" && !error.message.includes("private"));
});
