import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WORKLOAD, MAX_QUOTA_COVERAGE_REGIONS, QUOTA_SCAN_CONCURRENCY, assessQuota, cpuCounts,
  csvCell, deploymentReadiness, fitReasons, parseQuota, planningCsv, runBoundedQuotaScan, workloadValue,
} from "../src/lib/workload-planning.ts";

const offer = {
  key: "Standard_E32-8s_v5|eastus", sku: "Standard_E32-8s_v5", size: "E32-8s_v5",
  series: "E", family: "standardESv5Family", region: "eastus",
  vcpus: 8, quotaVcpus: 32, memoryGB: 256, gpus: null,
  zones: ["1", "2", "3"], availableZones: ["1", "3"], status: "zone-limited", reason: "NotAvailableForSubscription",
};
const ready = (regional = 100, family = 100) => ({
  state: "ready",
  data: parseQuota({ value: [
    { name: { value: "cores" }, unit: "Count", currentValue: 0, limit: regional },
    { name: { value: "standardESv5Family" }, unit: "Count", currentValue: 0, limit: family },
  ] }),
});

test("no-filter defaults retain offers with unknown capabilities and restrictions", () => {
  assert.deepEqual(fitReasons({ ...offer, status: "restricted", vcpus: null, memoryGB: null }, DEFAULT_WORKLOAD), []);
  assert.deepEqual(fitReasons(offer, DEFAULT_WORKLOAD), []);
});

test("active capability minima reject nulls and insufficient values", () => {
  for (const [field, value] of [["minVcpus", 9], ["minMemoryGB", 257], ["minGpus", 1], ["minZones", 3]]) {
    assert.equal(fitReasons(offer, { ...DEFAULT_WORKLOAD, [field]: value }).length, 1);
  }
  assert.match(fitReasons(offer, { ...DEFAULT_WORKLOAD, minGpus: 1 })[0], /unknown/);
  assert.deepEqual(fitReasons(offer, { ...DEFAULT_WORKLOAD, minVcpus: 8, minMemoryGB: 256, minZones: 2 }), []);
  assert.equal(fitReasons({ ...offer, availableZones: [] }, { ...DEFAULT_WORKLOAD, minZones: 1 }).length, 1);
  assert.equal(fitReasons({ ...offer, availableZones: ["1", "1"] }, { ...DEFAULT_WORKLOAD, minZones: 2 }).length, 1);
});

test("numeric inputs validate count, bounds, integers and fractional memory", () => {
  for (const invalid of ["", " ", "-1", "0", "1.5", "NaN", "Infinity", "10001"]) {
    assert.equal(workloadValue("count", invalid), null);
  }
  assert.equal(workloadValue("count", "3"), 3);
  assert.equal(workloadValue("minZones", "4"), null);
  assert.equal(workloadValue("minZones", "0"), 0);
  assert.equal(workloadValue("minMemoryGB", "0.5"), 0.5);
  assert.equal(workloadValue("minGpus", "0.5"), null);
});

test("constrained cores use active vCPUs for fit but full vCPUs for quota", () => {
  assert.deepEqual(cpuCounts(new Map([["vCPUs", "32"], ["vCPUsAvailable", "8"]]), "E32-8s_v5"), { vcpus: 8, quotaVcpus: 32 });
  assert.deepEqual(cpuCounts(new Map([["vCPUs", "32"]]), "E32-8s_v5"), { vcpus: null, quotaVcpus: 32 });
  assert.deepEqual(cpuCounts(new Map([["vCPUs", "32"]]), "E32s_v5"), { vcpus: 32, quotaVcpus: 32 });
  assert.deepEqual(cpuCounts(new Map([["vCPUs", "garbage"], ["vCPUsAvailable", "8"]]), "E32-8s_v5"), { vcpus: 8, quotaVcpus: null });
  assert.deepEqual(cpuCounts(new Map([["vCPUs", "32"], ["vCPUsAvailable", ""]]), "E32-8s_v5"), { vcpus: null, quotaVcpus: 32 });
  assert.equal(assessQuota(offer, 3, ready()).required, 96);
  assert.equal(assessQuota(offer, 4, ready()).status, "insufficient");
});

test("either regional or family quota insufficiency blocks count; exact headroom passes", () => {
  assert.equal(assessQuota(offer, 2, ready(63, 100)).status, "insufficient");
  assert.equal(assessQuota(offer, 2, ready(100, 63)).status, "insufficient");
  assert.equal(assessQuota(offer, 2, ready(64, 64)).status, "sufficient");
  const data = ready().data;
  data.usages[0].used = 90;
  assert.equal(assessQuota(offer, 1, { state: "ready", data }).regionalHeadroom, 10);
  assert.equal(assessQuota(offer, 1, { state: "ready", data }).status, "insufficient");
});

test("missing and unsupported quota stays unknown, not zero or unlimited", () => {
  assert.equal(assessQuota(offer, 1).status, "not-requested");
  assert.equal(assessQuota(offer, 1, { state: "loading" }).status, "loading");
  assert.equal(assessQuota(offer, 1, { state: "error", data: ready().data }).status, "error");
  assert.equal(assessQuota(offer, 1, { state: "error", data: ready().data }).regionalHeadroom, null);
  assert.equal(assessQuota(offer, 1, { state: "loading", data: ready().data }).familyHeadroom, null);
  assert.equal(assessQuota(offer, 1, { state: "ready", data: parseQuota({ value: [] }) }).status, "unknown");
  assert.equal(assessQuota({ ...offer, family: "unsupported" }, 1, ready()).status, "unknown");
  assert.equal(assessQuota({ ...offer, quotaVcpus: null }, 1, ready()).status, "unknown");
  assert.equal(assessQuota(offer, 0, ready()).status, "unknown");
  assert.equal(assessQuota({ ...offer, quotaVcpus: Number.MAX_SAFE_INTEGER }, 2, ready()).required, null);
  assert.equal(assessQuota({ ...offer, family: "STANDARDESV5FAMILY" }, 1, ready()).status, "sufficient");
  const invalid = parseQuota({ value: [{ name: { value: "cores" }, unit: "Count", currentValue: null, limit: -1 }] });
  assert.equal(invalid.usages[0].used, null);
  assert.equal(invalid.usages[0].limit, null);
  assert.equal(assessQuota(offer, 1, { state: "ready", data: invalid }).regionalHeadroom, null);
});

test("deployment readiness distinguishes matches, subscription restrictions, quota and unchecked regions", () => {
  const restricted = { ...offer, key: "Standard_E16s_v5|westus", region: "westus", status: "restricted" };
  const noMatch = { ...offer, key: "Standard_E16s_v5|centralus", region: "centralus" };
  const rows = deploymentReadiness(
    [offer, restricted, noMatch],
    [offer, restricted],
    1,
    new Map([["eastus", ready()]]),
  );
  assert.deepEqual(rows.map(({ region, readiness, matchingSkuCount, eligibleSkuCount }) => ({
    region, readiness, matchingSkuCount, eligibleSkuCount,
  })), [
    { region: "eastus", readiness: "ready", matchingSkuCount: 1, eligibleSkuCount: 1 },
    { region: "westus", readiness: "blocked", matchingSkuCount: 1, eligibleSkuCount: 0 },
    { region: "centralus", readiness: "blocked", matchingSkuCount: 0, eligibleSkuCount: 0 },
  ]);
});

test("deployment readiness blocks confirmed shortfalls but keeps missing quota unknown", () => {
  const insufficient = deploymentReadiness([offer], [offer], 2, new Map([["eastus", ready(63, 100)]]))[0];
  assert.equal(insufficient.readiness, "blocked");
  assert.match(insufficient.reason, /No eligible matching SKU/);

  const missingFamily = { state: "ready", data: parseQuota({ value: [
    { name: { value: "cores" }, unit: "Count", currentValue: 0, limit: 100 },
  ] }) };
  const unknown = deploymentReadiness([offer], [offer], 1, new Map([["eastus", missingFamily]]))[0];
  assert.equal(unknown.readiness, "unknown");
  assert.match(unknown.reason, /incomplete/);

  assert.equal(deploymentReadiness([offer], [offer], 1, new Map())[0].readiness, "not-checked");
  assert.equal(deploymentReadiness([offer], [offer], 1, new Map([["eastus", { state: "error" }]]))[0].readiness, "unknown");
});

test("quota coverage stays bounded and records per-region failures", async () => {
  const quota = ready().data;
  assert.ok(quota);
  const regions = Array.from({ length: 8 }, (_, i) => `region-${i}`);
  const completed = new Map();
  let active = 0;
  let peak = 0;
  await runBoundedQuotaScan(regions, async (region) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active--;
    if (region === "region-7") throw new Error("quota unavailable");
    return quota;
  }, (region, result) => completed.set(region, result), new AbortController().signal);
  assert.equal(peak, QUOTA_SCAN_CONCURRENCY);
  assert.equal(completed.size, regions.length);
  assert.equal(completed.get("region-0").state, "ready");
  assert.equal(completed.get("region-7").state, "error");
  await assert.rejects(() => runBoundedQuotaScan(
    Array.from({ length: MAX_QUOTA_COVERAGE_REGIONS + 1 }, (_, i) => `r${i}`),
    async () => quota,
    () => {},
    new AbortController().signal,
  ), /limited to/);
});

test("cancelling quota coverage stops queued regions", async () => {
  const controller = new AbortController();
  const started = [];
  const results = [];
  await runBoundedQuotaScan(Array.from({ length: 8 }, (_, i) => `region-${i}`), async (region, signal) => {
    started.push(region);
    if (started.length === 2) controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 1));
    if (signal.aborted) throw new Error("aborted");
    return ready().data;
  }, (region, result) => results.push([region, result]), controller.signal);
  assert.equal(started.length, 2);
  assert.deepEqual(results, []);
});

test("quota parser rejects unexpected or incomplete pages and ignores non-count metrics", () => {
  assert.throws(() => parseQuota({}), /shape/);
  assert.throws(() => parseQuota({ value: [], nextLink: "https://example.invalid/page2" }), /Paginated/);
  assert.deepEqual(parseQuota({ value: [null, { name: { value: "cores" }, unit: "Bytes", currentValue: 1, limit: 10 }] }).usages, []);
});

test("CSV escapes commas quotes and newlines and neutralizes spreadsheet formulas", () => {
  assert.equal(csvCell('A,"B"\nC'), '"A,""B""\nC"');
  for (const text of ["=SUM(1,2)", "+cmd", "-10", "@formula", "  =1", "\t=1", "\r=1", "\nhello"]) {
    assert.equal(csvCell(text), `"'${text.replaceAll('"', '""')}"`);
  }
  assert.equal(csvCell(null), '"Unknown"');
  assert.equal(csvCell(0), '"0"');
  assert.equal(csvCell(-1), '"-1"');
});

test("CSV includes scope, applied constraints, count, quota and fetch provenance without invented values", () => {
  const snapshot = ready();
  snapshot.data.fetchedAt = new Date("2026-01-02T03:04:05Z");
  const csv = planningCsv([offer], {
    subscriptionId: "sub-id", subscriptionName: "=UNTRUSTED", series: "E",
    workload: { ...DEFAULT_WORKLOAD, count: 2, minZones: 2 },
    fetchedAt: new Date("2026-01-01T00:00:00Z"),
  }, new Map([["eastus", snapshot]]));
  assert.match(csv, /"Subscription ID"/);
  assert.match(csv, /"Per-VM active vCPUs","Per-VM quota vCPUs"/);
  assert.match(csv, /"'=UNTRUSTED"/);
  assert.match(csv, /"2","64","sufficient"/);
  assert.match(csv, /"2026-01-02T03:04:05.000Z"/);
  assert.match(csv, /"2026-01-01T00:00:00.000Z"/);
  assert.match(csv, /"Unknown"/);
  assert.equal(csv.split("\r\n").length, 2);
  assert.equal(planningCsv([], { subscriptionId: "id", subscriptionName: "name", series: "E", workload: DEFAULT_WORKLOAD }, new Map()).split("\r\n").length, 1);
});
