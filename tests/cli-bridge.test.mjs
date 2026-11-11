import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { test } from "node:test";
import {
  checkBoundary, cliContext, cliFailure, cliReadRequest, createCliBridge, createCliRunner, dashboardItems, DASHBOARD_ORIGIN,
  CliBridgeError,
} from "../scripts/cli-arm-server.mjs";
import { armEnvironment, armCacheKey } from "../src/lib/arm-config.ts";
import { selectedSubscription, subscriptionScope } from "../src/lib/subscription-scope.ts";
import { fetchArmSubscription } from "../src/lib/arm-http.ts";
import { useAppStore } from "../src/lib/store.ts";

const subscription = "11111111-2222-3333-4444-555555555555";
const tenant = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const profile = { id: subscription, tenantId: tenant, environmentName: "AzureCloud", user: { type: "user", name: "fixture-user" } };
const cliToken = "fixture-secret-never-returned";
const baseHeaders = { Origin: DASHBOARD_ORIGIN, "X-Dashboard-Cli": "1" };

async function fixture(t, options = {}) {
  let active = structuredClone(profile);
  const calls = [];
  const fetchCalls = [];
  const runCli = async (args, signal) => {
    signal?.throwIfAborted();
    calls.push(args);
    if (args[1] === "show") return active;
    return { accessToken: cliToken, tenant, subscription };
  };
  const fetcher = async (url, init) => {
    fetchCalls.push({ url, init });
    return Response.json({ value: [{ subscriptionId: subscription, displayName: "Fixture", state: "Enabled", accessToken: cliToken }] });
  };
  const server = createCliBridge({ runCli, fetcher, host: "127.0.0.1:0", ...options });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Host is deliberately injected for a random test port; production uses the fixed port.
  const request = (route, init = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(origin + route, {
      ...init, headers: { Host: "127.0.0.1:0", ...baseHeaders, ...init.headers },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(new Response(res.statusCode === 204 ? null : Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
  const metadata = await (await request("/status")).json();
  const connect = async () => {
    const response = await request("/connect", { method: "POST", headers: { "X-Dashboard-Csrf": metadata.csrf } });
    return { response, data: await response.json() };
  };
  return { server, request, connect, calls, fetchCalls, metadata, setActive: (next) => { active = next; } };
}

test("a dashboard read and status burst queues without exceeding four active reads", async (t) => {
  const gate = Promise.withResolvers();
  const received = Promise.withResolvers();
  t.after(() => gate.resolve());
  let active = 0, maximum = 0, requests = 0;
  const f = await fixture(t, { fetcher: async () => {
    maximum = Math.max(maximum, ++active);
    await gate.promise;
    active--;
    return Response.json({ value: [] });
  } });
  const { data } = await f.connect();
  f.server.on("request", () => { if (++requests === 9) received.resolve(); });
  const headers = { "X-Dashboard-Session": data.session };
  const burst = [...Array.from({ length: 8 }, () => f.request("/read?kind=subscriptions", { headers })), f.request("/status", { headers })];
  await received.promise;
  gate.resolve();
  const responses = await Promise.all(burst);
  assert.ok(responses.every((response) => response.status === 200));
  assert.equal(maximum, 4);
  assert.equal((await f.request("/status", { headers })).status, 200);
});

test("the admission queue stays bounded and rejects excess load without exposing credentials", async (t) => {
  const gate = Promise.withResolvers();
  const received = Promise.withResolvers();
  t.after(() => gate.resolve());
  let requests = 0, dispatched = 0;
  const f = await fixture(t, { fetcher: async () => {
    dispatched++;
    await gate.promise;
    return Response.json({ value: [] });
  } });
  const { data } = await f.connect();
  f.server.on("request", () => { if (++requests === 13) received.resolve(); });
  const headers = { "X-Dashboard-Session": data.session };
  const burst = Array.from({ length: 13 }, () => f.request("/read?kind=subscriptions", { headers }));
  await received.promise;
  gate.resolve();
  const responses = await Promise.all(burst);
  assert.equal(responses.filter((response) => response.status === 200).length, 12);
  const rejected = responses.filter((response) => response.status === 429);
  assert.equal(rejected.length, 1);
  const body = await rejected[0].json();
  assert.equal(body.code, "busy");
  assert.ok(!JSON.stringify(body).includes(cliToken));
  assert.ok(!JSON.stringify(body).includes(data.session));
  assert.equal(dispatched, 12);
  assert.equal((await f.request("/status", { headers })).status, 200);
});

test("queued cancellation and deadline remove waiters without dispatching CLI or leaking slots", async (t) => {
  const gate = Promise.withResolvers();
  const active = Promise.withResolvers();
  const queued = Promise.withResolvers();
  const closed = Promise.withResolvers();
  t.after(() => gate.resolve());
  let reads = 0;
  const f = await fixture(t, { deadlineMs: 100, fetcher: async () => {
    if (++reads === 4) active.resolve();
    await gate.promise;
    return Response.json({ value: [] });
  } });
  const { data } = await f.connect();
  const headers = { "X-Dashboard-Session": data.session };
  const running = Array.from({ length: 4 }, () => f.request("/read?kind=subscriptions", { headers }));
  await active.promise;
  const cliCalls = f.calls.length;
  f.server.once("request", (_req, res) => {
    res.once("close", () => closed.resolve());
    queued.resolve();
  });
  const controller = new AbortController();
  const cancelled = assert.rejects(f.request("/status", { headers, signal: controller.signal }), { name: "AbortError" });
  await queued.promise;
  controller.abort();
  await Promise.all([cancelled, closed.promise]);
  const timedOut = await f.request("/status", { headers });
  assert.equal(timedOut.status, 504);
  assert.equal((await timedOut.json()).code, "read-timeout");
  assert.equal(f.calls.length, cliCalls);
  gate.resolve();
  assert.ok((await Promise.all(running)).every((response) => response.status === 504));
  assert.equal((await f.request("/status", { headers })).status, 200);
  assert.equal(reads, 4);
});

test("CLI mode fails closed outside the exact development origin and isolates session caches", () => {
  const env = { VITE_ARM_MODE: "cli" };
  assert.equal(armEnvironment(env, DASHBOARD_ORIGIN, true).mode, "cli");
  for (const [origin, dev] of [[DASHBOARD_ORIGIN, false], ["http://localhost:5173", true], ["https://example.test", true]]) {
    const result = armEnvironment(env, origin, dev);
    assert.equal(result.config, null);
    assert.ok(result.problems.length);
    assert.notEqual(result.mode, "cli");
  }
  assert.notEqual(armCacheKey(armEnvironment(env, DASHBOARD_ORIGIN, true), "first"), armCacheKey(armEnvironment(env, DASHBOARD_ORIGIN, true), "second"));
  const config = armEnvironment(env, DASHBOARD_ORIGIN, true);
  assert.notEqual(armCacheKey(config, "same", 1, subscription), armCacheKey(config, "same", 1, tenant));
  assert.notEqual(armCacheKey(config, "same", 1, subscription), armCacheKey(config, "same", 1));
});

test("endpoint descriptors reject arbitrary URLs, paths, API versions, duplicate parameters and writes", () => {
  const parse = (query) => cliReadRequest(new URL(`http://127.0.0.1/read?${query}`));
  assert.deepEqual(parse("kind=subscriptions"), { kind: "subscriptions" });
  assert.deepEqual(parse(`kind=quota&subscriptionId=${subscription}&region=eastus`), { kind: "quota", subscriptionId: subscription, region: "eastus" });
  for (const query of [
    "kind=write", "kind=subscriptions&url=https://evil.test", "kind=subscriptions&api-version=bad",
    "kind=subscriptions&kind=subscriptions", `kind=skus&subscriptionId=${subscription}&region=eastus`,
    `kind=quota&subscriptionId=${subscription}&region=..%2Fsecrets`, "kind=regions&subscriptionId=--help",
  ]) assert.throws(() => parse(query));
});

test("Host, Origin, remote address, custom header and request-body boundaries are strict", () => {
  const valid = { method: "GET", headers: { host: "127.0.0.1:5174", origin: DASHBOARD_ORIGIN, "x-dashboard-cli": "1" }, socket: { remoteAddress: "127.0.0.1" } };
  checkBoundary(valid);
  for (const headers of [{ host: "evil.test" }, { origin: "http://localhost:5173" }, { origin: "null" }, { origin: undefined }, { "x-dashboard-cli": undefined }, { "content-length": "2" }, { "transfer-encoding": "chunked" }]) {
    assert.throws(() => checkBoundary({ ...valid, headers: { ...valid.headers, ...headers } }));
  }
  assert.throws(() => checkBoundary({ ...valid, socket: { remoteAddress: "192.168.1.9" } }));
});

test("official CLI invocation uses separate argument arrays, shell false, timeout and bounded output", async () => {
  let captured;
  const run = createCliRunner({ file: "official-python.exe", prefix: ["-IBm", "azure.cli"] }, (file, args, options, done) => {
    captured = { file, args, options };
    done(null, '{"id":"fixture"}', "");
  });
  assert.deepEqual(await run(["account", "show"]), { id: "fixture" });
  assert.equal(captured.file, "official-python.exe");
  assert.deepEqual(captured.args, ["-IBm", "azure.cli", "account", "show", "--output", "json", "--only-show-errors"]);
  assert.equal(captured.options.shell, false);
  assert.equal(captured.options.timeout, 30000);
  assert.equal(captured.options.maxBuffer, 1024 * 1024);
});

test("CLI profile and failure classification never echo raw credential-bearing errors", () => {
  assert.deepEqual(cliContext(profile), { tenant, subscription, user: "fixture-user" });
  for (const value of [{ ...profile, environmentName: "AzureChinaCloud" }, { ...profile, user: { type: "servicePrincipal", name: "secret" } }, { ...profile, id: "not-guid" }]) assert.throws(() => cliContext(value));
  for (const input of [{ stderr: `Please run az login ${cliToken}` }, { stderr: `AADSTS consent ${cliToken}` }, { code: "ENOENT", stderr: cliToken }, { killed: true, stderr: cliToken }, { stderr: cliToken }]) {
    assert.ok(!JSON.stringify(cliFailure(input)).includes(cliToken));
  }
  assert.equal(cliFailure({ stderr: "Please run az login" }).code, "cli-login");
  assert.equal(cliFailure({ killed: true }).status, 504);
});

test("bridge protects stateful actions with CSRF and rejects write/arbitrary routes without CLI invocation", async (t) => {
  const f = await fixture(t);
  for (const value of [undefined, "invalid", "é".repeat(64)]) {
    const headers = value ? { "X-Dashboard-Csrf": value } : {};
    assert.equal((await f.request("/connect", { method: "POST", headers })).status, 403);
  }
  for (const route of ["/write", "/read?kind=write", "/read?kind=subscriptions&url=https://evil.test"]) {
    assert.ok((await f.request(route)).status >= 400);
  }
  assert.equal((await f.request("/read", { method: "PUT" })).status, 405);
  assert.equal((await f.request("/status", { headers: { Origin: "https://evil.test" } })).status, 403);
  assert.equal(f.calls.length, 0);
  const allowed = await f.request("/status", { method: "OPTIONS", headers: {
    "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-dashboard-cli,x-dashboard-session",
  } });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), DASHBOARD_ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-credentials"), null);
  assert.equal((await f.request("/status", { method: "OPTIONS", headers: { "Access-Control-Request-Method": "DELETE" } })).status, 403);
});

test("bridge sends only projected dashboard metadata and pins server-side ARM token/context", async (t) => {
  const f = await fixture(t);
  const { response, data } = await f.connect();
  assert.equal(response.status, 200);
  assert.match(data.session, /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(data).includes("fixture-user"));
  const read = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.deepEqual(body.value, [{ subscriptionId: subscription, displayName: "Fixture", state: "Enabled" }]);
  assert.ok(!JSON.stringify(body).includes(cliToken));
  assert.equal(f.fetchCalls[0].url, "https://management.azure.com/subscriptions?api-version=2022-12-01");
  assert.equal(f.fetchCalls[0].init.method, "GET");
  assert.equal(f.fetchCalls[0].init.headers.Authorization, `Bearer ${cliToken}`);
  assert.deepEqual(f.calls.find((args) => args[1] === "get-access-token"), ["account", "get-access-token", "--resource", "https://management.azure.com/", "--subscription", subscription]);
});

test("account, tenant and default subscription changes invalidate the old session before ARM", async (t) => {
  for (const change of [{ user: { type: "user", name: "different-user" } }, { tenantId: subscription }, { id: tenant }]) {
    const f = await fixture(t);
    const { data } = await f.connect();
    f.setActive({ ...profile, ...change });
    const response = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "context-changed");
    assert.equal(f.fetchCalls.length, 0);
    assert.equal((await f.request("/status", { headers: { "X-Dashboard-Session": data.session } })).status, 401);
  }
});

test("disconnect and expiration prevent cached session reuse", async (t) => {
  let time = 0;
  const f = await fixture(t, { now: () => time });
  const { data } = await f.connect();
  assert.equal((await f.request("/disconnect", { method: "POST", headers: { "X-Dashboard-Csrf": f.metadata.csrf, "X-Dashboard-Session": data.session } })).status, 200);
  assert.equal((await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } })).status, 401);
  const second = await f.connect();
  time += 30 * 60_000;
  assert.equal((await f.request("/status", { headers: { "X-Dashboard-Session": second.data.session } })).status, 401);
});

test("foreign/unknown pagination and raw ARM errors never return partial results or tokens", async (t) => {
  for (const nextLink of ["https://evil.test/subscriptions?api-version=2022-12-01", "/subscriptions?api-version=2022-12-01&url=evil"]) {
    const f = await fixture(t, { fetcher: async () => Response.json({ value: [{ subscriptionId: subscription }], nextLink }) });
    const { data } = await f.connect();
    const response = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(response.status, 502);
    const body = await response.text();
    assert.ok(!body.includes(cliToken));
    assert.ok(!body.includes(subscription));
  }
  const f = await fixture(t, { fetcher: async () => new Response(cliToken, { status: 403 }) });
  const { data } = await f.connect();
  const response = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
  assert.equal(response.status, 403);
  assert.ok(!(await response.text()).includes(cliToken));
});

test("projection preserves workload/quota inputs but removes unrelated nested properties", () => {
  const quota = { name: { value: "cores", localizedValue: "vCPUs", token: cliToken }, currentValue: 3, limit: 12, unit: "Count", user: cliToken };
  assert.deepEqual(dashboardItems("quota", [quota]), [{ name: { value: "cores", localizedValue: "vCPUs" }, unit: "Count", currentValue: 3, limit: 12 }]);
  const sku = { name: "Standard_D4", resourceType: "virtualMachines", capabilities: [{ name: "vCPUsAvailable", value: "2", token: cliToken }], restrictions: [{ type: "Zone", restrictionInfo: { locations: ["eastus"], zones: ["2"], token: cliToken } }] };
  assert.ok(!JSON.stringify(dashboardItems("skus", [sku])).includes(cliToken));
  assert.equal(dashboardItems("skus", [sku])[0].capabilities[0].value, "2");
});

test("cancelling an in-flight CLI context check does not revoke the session used by a replacement read", async (t) => {
  let count = 0;
  let start;
  let finish;
  const started = new Promise((resolve) => { start = resolve; });
  const finished = new Promise((resolve) => { finish = resolve; });
  const f = await fixture(t, { runCli: async (args, signal) => {
    count++;
    if (count === 2) {
      start();
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => {
          finish();
          reject(new CliBridgeError("cancelled", "Cancelled", 499));
        }, { once: true });
      });

    }
    return profile;
  } });
  const { data } = await f.connect();
  const controller = new AbortController();
  const pending = f.request("/read?kind=subscriptions", { signal: controller.signal, headers: { "X-Dashboard-Session": data.session } });
  await started;
  controller.abort();
  await assert.rejects(pending);
  await finished;
  const status = await f.request("/status", { headers: { "X-Dashboard-Session": data.session } });
  assert.equal(status.status, 200);
});

test("mismatched token metadata is rejected before ARM and revokes the local session", async (t) => {
  const f = await fixture(t, { runCli: async (args) => args[1] === "show" ? profile
    : { accessToken: cliToken, tenant: subscription, subscription } });
  const { data } = await f.connect();
  const headers = { "X-Dashboard-Session": data.session };
  const response = await f.request("/read?kind=subscriptions", { headers });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "cli-token");
  assert.equal(f.fetchCalls.length, 0);
  assert.equal((await f.request("/status", { headers })).status, 401);
});

test("account change between pages prevents publishing partial data and preserves the precise error", async (t) => {
  let accountChecks = 0;
  const f = await fixture(t, {
    runCli: async (args) => {
      if (args[1] === "show") {
        accountChecks++;
        return accountChecks >= 4 ? { ...profile, tenantId: subscription } : profile;
      }
      return { accessToken: cliToken, tenant, subscription };
    },
    fetcher: async () => Response.json({ value: [{ subscriptionId: subscription }], nextLink: "/subscriptions?api-version=2022-12-01&$skiptoken=next" }),
  });
  const { data } = await f.connect();
  const response = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "context-changed");
  assert.equal(body.value, undefined);
});

test("the complete read deadline produces an explicit timeout without raw subprocess output", async (t) => {
  const f = await fixture(t, {
    deadlineMs: 20,
    runCli: async (args, signal) => {
      await new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new CliBridgeError("cancelled", cliToken, 499)), { once: true });
      });
    },
  });
  const { response, data } = await f.connect();
  assert.equal(response.status, 504);
  assert.equal(data.code, "read-timeout");
  assert.ok(!JSON.stringify(data).includes(cliToken));
});

test("optional subscription scope validates exact GUIDs and malformed scope prevents startup", () => {
  for (const value of [undefined, null, ""]) assert.equal(subscriptionScope(value), null);
  assert.equal(subscriptionScope(` ${tenant.toUpperCase()} `), tenant);
  for (const value of ["my subscription", " ", `${subscription}/locations`, "--help", 123, false]) {
    assert.throws(() => subscriptionScope(value));
    assert.throws(() => createCliBridge({ subscriptionId: value }));
  }
});

test("configured listing reads only the exact ARM subscription with its real name and no global context change", async (t) => {
  const calls = [];
  const urls = [];
  const f = await fixture(t, {
    subscriptionId: tenant,
    runCli: async (args) => {
      calls.push(args);
      if (args[1] === "show") return args.includes("--subscription") ? { ...profile, id: tenant } : profile;
      return { accessToken: cliToken, tenant, subscription: tenant };
    },
    fetcher: async (url) => {
      urls.push(url);
      return Response.json({ subscriptionId: tenant, displayName: "Actual ARM subscription name", state: "Enabled", accessToken: cliToken });
    },
  });
  assert.equal(f.metadata.subscriptionScope, tenant);
  const { response, data } = await f.connect();
  assert.equal(response.status, 200);
  assert.equal(data.subscriptionScope, tenant);
  assert.equal(data.defaultSubscription, undefined);
  const read = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).value, [{ subscriptionId: tenant, displayName: "Actual ARM subscription name", state: "Enabled" }]);
  assert.deepEqual(urls, [`https://management.azure.com/subscriptions/${tenant}?api-version=2022-12-01`]);
  assert.ok(calls.some((args) => JSON.stringify(args) === JSON.stringify(["account", "show", "--subscription", tenant])));
  assert.ok(calls.every((args) => args[0] === "account" && ["show", "get-access-token"].includes(args[1])));
  assert.deepEqual(calls.find((args) => args[1] === "get-access-token"), ["account", "get-access-token", "--resource", "https://management.azure.com/", "--subscription", tenant]);
});

test("configured scope rejects every other subscription endpoint before CLI or ARM and permits the configured ID", async (t) => {
  const f = await fixture(t, { subscriptionId: subscription });
  const { data } = await f.connect();
  const before = f.calls.length;
  for (const kind of ["regions", "skus", "quota"]) {
    const response = await f.request(`/read?kind=${kind}&subscriptionId=${tenant}${kind === "quota" ? "&region=eastus" : ""}`,
      { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "subscription-scope");
  }
  assert.equal(f.calls.length, before);
  assert.equal(f.fetchCalls.length, 0);
  for (const kind of ["regions", "skus", "quota"]) {
    const response = await f.request(`/read?kind=${kind}&subscriptionId=${subscription}${kind === "quota" ? "&region=eastus" : ""}`,
      { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(response.status, 200);
  }
  assert.ok(f.fetchCalls.every(({ url }) => new URL(url).pathname.startsWith(`/subscriptions/${subscription}/`)));
});

test("unavailable CLI target and inaccessible ARM target fail without fallback or raw provider errors", async (t) => {
  const missing = await fixture(t, { subscriptionId: tenant, runCli: async (args) => {
    if (args.includes("--subscription")) throw new CliBridgeError("cli-failed", cliToken);
    return profile;
  } });
  const failed = await missing.connect();
  assert.equal(failed.response.status, 403);
  assert.equal(failed.data.code, "subscription-unavailable");
  assert.ok(!JSON.stringify(failed.data).includes(cliToken));
  assert.equal(missing.fetchCalls.length, 0);
  for (const status of [403, 404]) {
    let reads = 0;
    const f = await fixture(t, { subscriptionId: subscription, fetcher: async () => { reads++; return new Response(cliToken, { status }); } });
    const { data } = await f.connect();
    const read = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(read.status, 403);
    const result = await read.json();
    assert.equal(result.code, "subscription-unavailable");
    assert.ok(!JSON.stringify(result).includes(cliToken));
    assert.equal(result.value, undefined);
    assert.equal(reads, 1);
  }
});

test("scoped sessions detect changes to either target account or current default context", async (t) => {
  for (const changedTarget of [false, true]) {
    let changed = false;
    const f = await fixture(t, { subscriptionId: tenant, runCli: async (args) => {
      if (args[1] !== "show") return { accessToken: cliToken, tenant, subscription: tenant };
      const target = args.includes("--subscription");
      const account = target ? { ...profile, id: tenant } : profile;
      return changed && target === changedTarget ? { ...account, user: { type: "user", name: "different-user" } } : account;
    } });
    const { data } = await f.connect();
    changed = true;
    const read = await f.request("/read?kind=subscriptions", { headers: { "X-Dashboard-Session": data.session } });
    assert.equal(read.status, 409);
    assert.equal((await read.json()).code, "context-changed");
    assert.equal(f.fetchCalls.length, 0);
  }
});

test("exact subscription reads reject mismatched/list/missing-name results and cancellation", async () => {
  let tokenCalls = 0;
  const getToken = async () => { tokenCalls++; return cliToken; };
  for (const response of [{ subscriptionId: tenant, displayName: "Wrong" }, { value: [{ subscriptionId: subscription }] },
    { subscriptionId: subscription }, { subscriptionId: subscription, displayName: "Fixture", nextLink: "anything" }]) {
    await assert.rejects(fetchArmSubscription(subscription, getToken, undefined, async () => Response.json(response)), { code: "subscription-scope" });
  }
  await assert.rejects(fetchArmSubscription("invalid", getToken));
  const before = tokenCalls;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchArmSubscription(subscription, getToken, controller.signal));
  assert.equal(tokenCalls, before);
});

test("configured selection cannot retain an old subscription or start reads before its exact ARM result", () => {
  const others = [{ id: subscription, state: "Enabled" }];
  assert.equal(selectedSubscription(tenant, subscription, undefined), undefined);
  assert.equal(selectedSubscription(tenant, subscription, others), undefined);
  assert.equal(selectedSubscription(tenant, subscription, [...others, { id: tenant.toUpperCase(), state: "Enabled" }]), tenant);
  assert.equal(selectedSubscription(null, undefined, others), subscription);
  assert.equal(selectedSubscription(null, subscription, undefined), subscription);
});

test("changing configured scope clears previous identity and subscription-specific selections", () => {
  const store = useAppStore.getState();
  store.setAzureIdentity("old-session");
  store.setSubscriptionId(subscription);
  store.setComparisonRegions(["eastus"]);
  store.setRegionSearch("old region");
  const generation = useAppStore.getState().azureSessionGeneration;
  store.setAzureSubscriptionScope(tenant);
  const result = useAppStore.getState();
  assert.equal(result.azureSubscriptionScope, tenant);
  assert.equal(result.azureIdentity, null);
  assert.equal(result.subscriptionId, undefined);
  assert.deepEqual(result.comparisonRegions, []);
  assert.equal(result.regionSearch, "");
  assert.ok(result.azureSessionGeneration > generation);
  store.setAzureSubscriptionScope(null);
});
