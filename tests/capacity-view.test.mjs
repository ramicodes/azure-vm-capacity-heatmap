import test from "node:test";
import assert from "node:assert/strict";
import { selectCapacityOffers, summarizeRegionOffers } from "../src/lib/capacity-view.ts";
import { DEFAULT_WORKLOAD } from "../src/lib/workload-planning.ts";
import { useAppStore } from "../src/lib/store.ts";

const regions = new Map([
  ["eastus", { name: "eastus", displayName: "East US", geography: "US" }],
  ["westeurope", { name: "westeurope", displayName: "West Europe", geography: "Europe" }],
]);
const base = {
  sku: "Standard_NC8", size: "NC8", series: "NC", family: "ncFamily",
  vcpus: 8, quotaVcpus: 8, memoryGB: 32, gpus: 1,
  zones: ["1", "2"], availableZones: ["1"], status: "zone-limited", reason: null,
};
const offers = [
  { ...base, key: "small|eastus", region: "eastus" },
  { ...base, key: "large|eastus", region: "eastus", vcpus: 64, memoryGB: 256, status: "restricted", availableZones: [] },
  { ...base, key: "unknown|westeurope", region: "westeurope", vcpus: null, memoryGB: null },
  { ...base, key: "other|eastus", region: "eastus", series: "D" },
];
const filters = { workload: DEFAULT_WORKLOAD, regionSearch: "", availabilityRegionSearch: "" };

test("workload requirements and workload region search cannot filter availability", () => {
  const strict = { ...filters, regionSearch: "no-such-region", workload: {
    count: 10000, minVcpus: 1000000, minMemoryGB: 1000000, minGpus: 1000000, minZones: 3,
  } };
  const availability = selectCapacityOffers(offers, "NC", regions, "availability", strict);
  assert.deepEqual(availability.seriesOffers, offers.slice(0, 3));
  assert.equal(availability.seriesOffers[1].status, "restricted");
  assert.equal(availability.seriesOffers[2].vcpus, null);
  assert.equal(selectCapacityOffers(offers, "NC", regions, "workload", strict).seriesOffers.length, 0);
});

test("each view uses only its own region search, with shared subscription-supplied data and series", () => {
  const state = { ...filters, regionSearch: " EAST US ", availabilityRegionSearch: "Europe",
    workload: { ...DEFAULT_WORKLOAD, minVcpus: 64 } };
  const availability = selectCapacityOffers(offers, "NC", regions, "availability", state);
  const workload = selectCapacityOffers(offers, "NC", regions, "workload", state);
  assert.deepEqual(availability.seriesOffers.map(o => o.key), ["unknown|westeurope"]);
  assert.deepEqual(workload.regionOffers.map(o => o.key), ["small|eastus", "large|eastus"]);
  assert.deepEqual(workload.seriesOffers.map(o => o.key), ["large|eastus"]);
  assert.equal(selectCapacityOffers(offers, "D", regions, "workload", filters).seriesOffers.length, 1);
  assert.equal(selectCapacityOffers([], "NC", regions, "availability", state).seriesOffers.length, 0);
});

test("availability chart counts raw eligibility while workload chart partitions matches and exclusions", () => {
  const state = { ...filters, workload: { ...DEFAULT_WORKLOAD, minVcpus: 64 } };
  const availability = selectCapacityOffers(offers, "NC", regions, "availability", state);
  const workload = selectCapacityOffers(offers, "NC", regions, "workload", state);
  const raw = summarizeRegionOffers(availability.regionOffers, availability.seriesOffers, regions);
  const fit = summarizeRegionOffers(workload.regionOffers, workload.seriesOffers, regions);
  assert.deepEqual(raw.find(r => r.region === "eastus"), { region: "eastus", name: "East US", eligible: 1, restricted: 1, excluded: 0 });
  assert.deepEqual(fit.find(r => r.region === "eastus"), { region: "eastus", name: "East US", eligible: 0, restricted: 1, excluded: 1 });
  assert.equal(fit.find(r => r.region === "westeurope").excluded, 1);
  assert.equal(fit.reduce((sum, r) => sum + r.eligible + r.restricted + r.excluded, 0), 3);
});

test("navigation preserves independent filters; shared subscription changes clear comparison, not requirements", () => {
  const before = useAppStore.getState();
  try {
    before.setAvailabilityRegionSearch("Europe");
    before.setRegionSearch("East US");
    before.setWorkload({ ...DEFAULT_WORKLOAD, count: 3, minGpus: 2 });
    before.setComparisonRegions(["eastus"]);
    before.setSeries("D");
    before.setSubscriptionId("another-subscription");
    const state = useAppStore.getState();
    assert.equal(state.series, "D");
    assert.equal(state.subscriptionId, "another-subscription");
    assert.deepEqual(state.comparisonRegions, []);
    assert.equal(state.availabilityRegionSearch, "Europe");
    assert.equal(state.regionSearch, "East US");
    assert.equal(state.workload.count, 3);
    state.setAzureIdentity(null);
    assert.equal(useAppStore.getState().availabilityRegionSearch, "");
  } finally {
    useAppStore.setState(before, true);
  }
});
