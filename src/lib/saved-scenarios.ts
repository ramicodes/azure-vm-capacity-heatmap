import type { Workload } from "./workload-planning";

export const SAVED_SCENARIOS_KEY = "azure-vm-capacity-planner.scenarios.v1";
export const MAX_SAVED_SCENARIOS = 25;

export interface ScenarioSettings {
  series: string;
  regionSearch: string;
  comparisonRegions: string[];
  workload: Workload;
}

export interface SavedScenario extends ScenarioSettings {
  id: string;
  name: string;
  savedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validWorkload(value: unknown): value is Workload {
  if (!isRecord(value)) return false;
  const { count, minVcpus, minMemoryGB, minGpus, minZones } = value;
  return typeof count === "number" && Number.isSafeInteger(count) && count >= 1 && count <= 10_000 &&
    typeof minVcpus === "number" && Number.isSafeInteger(minVcpus) && minVcpus >= 0 && minVcpus <= 1_000_000 &&
    typeof minMemoryGB === "number" && Number.isFinite(minMemoryGB) && minMemoryGB >= 0 && minMemoryGB <= 1_000_000 &&
    typeof minGpus === "number" && Number.isSafeInteger(minGpus) && minGpus >= 0 && minGpus <= 1_000_000 &&
    typeof minZones === "number" && Number.isSafeInteger(minZones) && minZones >= 0 && minZones <= 3;
}

function isSavedScenario(value: unknown): value is SavedScenario {
  if (!isRecord(value)) return false;
  return typeof value.id === "string" && /^[A-Za-z0-9-]{1,80}$/.test(value.id) &&
    typeof value.name === "string" && value.name.trim().length > 0 && value.name.length <= 60 &&
    typeof value.savedAt === "string" && Number.isFinite(Date.parse(value.savedAt)) &&
    typeof value.series === "string" && /^[A-Z][A-Z0-9]{0,9}$/.test(value.series) &&
    typeof value.regionSearch === "string" && value.regionSearch.length <= 100 &&
    Array.isArray(value.comparisonRegions) && value.comparisonRegions.length <= 3 &&
    value.comparisonRegions.every((region) => typeof region === "string" && /^[a-z0-9-]{1,64}$/.test(region)) &&
    new Set(value.comparisonRegions).size === value.comparisonRegions.length &&
    validWorkload(value.workload);
}

function normalizeScenario(value: SavedScenario): SavedScenario {
  return {
    id: value.id,
    name: value.name.trim(),
    savedAt: value.savedAt,
    series: value.series,
    regionSearch: value.regionSearch,
    comparisonRegions: [...value.comparisonRegions],
    workload: { ...value.workload },
  };
}

export function createSavedScenario(
  name: string,
  settings: ScenarioSettings,
  id = crypto.randomUUID(),
  savedAt = new Date().toISOString(),
): SavedScenario {
  const scenario = { ...settings, id, name: name.trim(), savedAt };
  if (!isSavedScenario(scenario)) {
    throw new Error("Scenario name or settings are invalid.");
  }
  return normalizeScenario(scenario);
}

export function serializeSavedScenarios(scenarios: readonly SavedScenario[]): string {
  if (scenarios.length > MAX_SAVED_SCENARIOS || !scenarios.every(isSavedScenario)) {
    throw new Error("Saved scenarios are invalid or exceed the storage limit.");
  }
  return JSON.stringify({
    version: 1,
    items: scenarios.map((scenario) => normalizeScenario(scenario)),
  });
}

export function deserializeSavedScenarios(value: string | null): SavedScenario[] {
  if (value === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Saved scenarios could not be read. Remove the invalid browser data to continue.");
  }
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.items) ||
    parsed.items.length > MAX_SAVED_SCENARIOS || !parsed.items.every(isSavedScenario)) {
    throw new Error("Saved scenarios use an unsupported or invalid format.");
  }
  return parsed.items.map((scenario) => normalizeScenario(scenario));
}

export function loadSavedScenarios(storage: Pick<Storage, "getItem">): SavedScenario[] {
  return deserializeSavedScenarios(storage.getItem(SAVED_SCENARIOS_KEY));
}

export function storeSavedScenarios(
  storage: Pick<Storage, "setItem">,
  scenarios: readonly SavedScenario[],
): void {
  storage.setItem(SAVED_SCENARIOS_KEY, serializeSavedScenarios(scenarios));
}
