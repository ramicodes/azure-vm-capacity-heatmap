import test from "node:test";
import assert from "node:assert/strict";
import { useAppStore } from "../src/lib/store.ts";
import {
  createSavedScenario, deserializeSavedScenarios, MAX_SAVED_SCENARIOS,
  SAVED_SCENARIOS_KEY, serializeSavedScenarios, storeSavedScenarios, loadSavedScenarios,
} from "../src/lib/saved-scenarios.ts";

const settings = {
  series: "NC",
  regionSearch: "east",
  comparisonRegions: ["eastus", "westus"],
  workload: { count: 4, minVcpus: 8, minMemoryGB: 32, minGpus: 1, minZones: 2 },
};

test("round-trips only scenario planning fields", () => {
  const scenario = createSavedScenario("  GPU inference  ", settings, "scenario-1", "2026-01-01T00:00:00Z");
  const serialized = serializeSavedScenarios([scenario]);
  assert.equal(scenario.name, "GPU inference");
  assert.deepEqual(deserializeSavedScenarios(serialized), [scenario]);
  assert.doesNotMatch(serialized, /subscriptionId|accountId|quota|price/i);
});

test("rejects corrupt, unsupported, out-of-bounds, and excessive stored data", () => {
  assert.throws(() => deserializeSavedScenarios("{"), /could not be read/);
  assert.throws(() => deserializeSavedScenarios(JSON.stringify({ version: 2, items: [] })), /unsupported or invalid/);
  const invalid = createSavedScenario("GPU inference", settings, "scenario-1", "2026-01-01T00:00:00Z");
  assert.throws(() => serializeSavedScenarios(Array(MAX_SAVED_SCENARIOS + 1).fill(invalid)), /exceed the storage limit/);
});

test("reads and writes through browser storage without sharing across storage instances", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const scenario = createSavedScenario("GPU inference", settings, "scenario-1", "2026-01-01T00:00:00Z");
  storeSavedScenarios(storage, [scenario]);
  assert.equal(values.has(SAVED_SCENARIOS_KEY), true);
  assert.deepEqual(loadSavedScenarios(storage), [scenario]);
  assert.deepEqual(loadSavedScenarios({ getItem: () => null }), []);
});

test("applies all saved settings together without switching subscription or availability filters", () => {
  const previous = useAppStore.getState();
  useAppStore.setState({
    subscriptionId: "current-subscription",
    series: "D",
    regionSearch: "west",
    comparisonRegions: ["westus2"],
    workload: { count: 1, minVcpus: 0, minMemoryGB: 0, minGpus: 0, minZones: 0 },
    availabilityRegionSearch: "north",
  });
  const scenario = createSavedScenario("GPU inference", settings, "scenario-1", "2026-01-01T00:00:00Z");
  const updates = [];
  const unsubscribe = useAppStore.subscribe((state) => updates.push(state));
  try {
    useAppStore.getState().applyScenario(scenario);
    const state = useAppStore.getState();
    assert.equal(updates.length, 1);
    assert.equal(state.series, "NC");
    assert.equal(state.regionSearch, "east");
    assert.deepEqual(state.comparisonRegions, ["eastus", "westus"]);
    assert.deepEqual(state.workload, settings.workload);
    assert.notEqual(state.comparisonRegions, scenario.comparisonRegions);
    assert.notEqual(state.workload, scenario.workload);
    assert.equal(state.subscriptionId, "current-subscription");
    assert.equal(state.availabilityRegionSearch, "north");
  } finally {
    unsubscribe();
    useAppStore.setState(previous, true);
  }
});
