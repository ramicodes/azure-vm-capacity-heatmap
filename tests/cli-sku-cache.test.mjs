import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { createSkuCache, skuCacheKey } from "../scripts/cli-sku-cache.mjs";

const context = { tenant: "fixture-tenant", subscription: "fixture-subscription", user: "fixture-user" };
const value = [{ name: "Standard_D4", resourceType: "virtualMachines", capabilities: [{ name: "vCPUs", value: "4" }] }];

async function directory(t) {
  const result = await mkdtemp(path.join(tmpdir(), "planner-sku-cache-"));
  t.after(() => rm(result, { recursive: true, force: true }));
  return result;
}

test("catalog cache survives a new instance and preserves its original fetch time", async (t) => {
  const root = await directory(t);
  const key = skuCacheKey(context, "target");
  await createSkuCache(root, () => 100).write(key, { value, fetchedAt: 100 });
  assert.deepEqual(await createSkuCache(root, () => 200).read(key), { value, fetchedAt: 100 });
  const data = JSON.parse(gunzipSync(await readFile(path.join(root, `${key}.json.gz`))));
  assert.deepEqual(Object.keys(data).sort(), ["fetchedAt", "key", "value", "version"]);
  assert.ok(!JSON.stringify(data).includes(context.user));
});

test("different users, tenants, default contexts and target subscriptions cannot share a catalog", async (t) => {
  const root = await directory(t);
  const cache = createSkuCache(root, () => 100);
  await cache.write(skuCacheKey(context, "target"), { value, fetchedAt: 100 });
  for (const [active, target] of [
    [{ ...context, user: "another" }, "target"],
    [{ ...context, tenant: "another" }, "target"],
    [{ ...context, subscription: "another" }, "target"],
    [context, "another"],
  ]) {
    assert.equal(await cache.read(skuCacheKey(active, target)), null);
  }
});

test("expired and future-dated catalogs are removed rather than presented as current", async (t) => {
  const root = await directory(t);
  const key = skuCacheKey(context, "target");
  await createSkuCache(root, () => 100).write(key, { value, fetchedAt: 100 });
  assert.equal(await createSkuCache(root, () => 100 + 15 * 60_000).read(key), null);
  assert.equal((await readdir(root)).length, 0);
  await createSkuCache(root, () => 100).write(key, { value, fetchedAt: 100 });
  assert.equal(await createSkuCache(root, () => 99).read(key), null);
});

test("catalog cache retains at most four snapshots and never removes unrelated files", async (t) => {
  const root = await directory(t);
  await writeFile(path.join(root, "unrelated.txt"), "keep");
  const cache = createSkuCache(root);
  for (let i = 0; i < 6; i++) {
    await cache.write(skuCacheKey(context, `target-${i}`), { value, fetchedAt: Date.now() });
  }
  const files = await readdir(root);
  assert.equal(files.filter((file) => file.endsWith(".json.gz")).length, 4);
  assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "keep");
});

test("corrupt cache errors are explicit, sanitized, and cancellation cannot publish a snapshot", async (t) => {
  const root = await directory(t);
  const key = skuCacheKey(context, "target");
  const cache = createSkuCache(root);
  await writeFile(path.join(root, `${key}.json.gz`), "fixture-private-content");
  const errors = [];
  t.mock.method(console, "error", (message) => errors.push(message));
  await assert.rejects(cache.read(key), (error) => error.code === "catalog-cache" && !error.message.includes(root));
  assert.equal(errors.length, 1);
  assert.ok(!errors[0].includes("fixture-private-content"));
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(cache.write(skuCacheKey(context, "new-target"), { value, fetchedAt: Date.now() }, controller.signal), { name: "AbortError" });
  assert.equal((await readdir(root)).length, 1);
});
