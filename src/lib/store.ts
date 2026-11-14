import { create } from "zustand";
import { DEFAULT_WORKLOAD, type Workload } from "./workload-planning.ts";
import type { ScenarioSettings } from "./saved-scenarios.ts";

// Global client state shared across components/routes. ONE module-scoped store,
// no Provider needed — import `useAppStore` anywhere. Use `useState` for
// component-local state; let TanStack Query own server/connector data (don't
// mirror it here). NEVER use raw React Context for mutable shared state.
//
// Rules:
//   • Put actions INSIDE the store (set-based, immutable updates); components call them.
//   • Read with a NARROW selector — `useAppStore((s) => s.items)`, never
//     `useAppStore()` with no selector. Don't return a fresh object/array from a
//     selector (it re-renders on every change); group with `useShallow`:
//     `import { useShallow } from "zustand/react/shallow"`
//     `const { a, b } = useAppStore(useShallow((s) => ({ a: s.a, b: s.b })));`
//
// Example (replace `AppState` with the app's real state + actions):
//   interface AppState {
//     items: Item[];
//     addItem: (text: string) => void;
//     toggleItem: (id: string) => void;
//   }
//   export const useAppStore = create<AppState>((set) => ({
//     items: [],
//     addItem: (text) =>
//       set((s) => ({ items: [...s.items, { id: crypto.randomUUID(), text, done: false }] })),
//     toggleItem: (id) =>
//       set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)) })),
//   }));
//
// In components:
//   const items = useAppStore((s) => s.items);      // read (targeted re-render)
//   const addItem = useAppStore((s) => s.addItem);  // action (stable reference)

interface AppState {
  // Shared subscription/series; each view owns its region search.
  subscriptionId: string | undefined;
  series: string;
  workload: Workload;
  comparisonRegions: string[];
  shortlistKeys: string[];
  setShortlistKeys: (keys: string[]) => void;
  regionSearch: string;
  availabilityRegionSearch: string;
  azureIdentity: string | null;
  azureSubscriptionScope: string | null;
  azureSessionGeneration: number;
  azureAuthIssue: string | null;
  azureAuthBusy: boolean;
  setAzureIdentity: (identity: string | null) => void;
  setAzureSubscriptionScope: (scope: string | null) => void;
  setAzureAuthIssue: (issue: string | null) => void;
  setAzureAuthBusy: (busy: boolean) => void;
  setRegionSearch: (text: string) => void;
  setAvailabilityRegionSearch: (text: string) => void;
  setWorkload: (workload: Workload) => void;
  setComparisonRegions: (regions: string[]) => void;
  setSubscriptionId: (id: string) => void;
  setSeries: (series: string) => void;
  applyScenario: (settings: ScenarioSettings) => void;
}

export const useAppStore = create<AppState>((set) => ({
  subscriptionId: undefined,
  series: "NC",
  workload: DEFAULT_WORKLOAD,
  comparisonRegions: [],
  shortlistKeys: [],
  setShortlistKeys: (keys) => set({ shortlistKeys: [...new Set(keys)].slice(0, 3) }),
  regionSearch: "",
  availabilityRegionSearch: "",
  azureIdentity: null,
  azureSubscriptionScope: null,
  azureSessionGeneration: 0,
  azureAuthIssue: null,
  azureAuthBusy: false,
  setAzureIdentity: (azureIdentity) => set((s) => ({
    azureIdentity, azureSessionGeneration: s.azureSessionGeneration + 1,
    azureAuthIssue: null, subscriptionId: undefined, comparisonRegions: [], shortlistKeys: [], availabilityRegionSearch: "",
  })),
  setAzureSubscriptionScope: (azureSubscriptionScope) => set((s) => ({
    azureSubscriptionScope, azureIdentity: null, azureSessionGeneration: s.azureSessionGeneration + 1,
    azureAuthIssue: null, subscriptionId: undefined, comparisonRegions: [], shortlistKeys: [], regionSearch: "", availabilityRegionSearch: "",
  })),
  setAzureAuthIssue: (azureAuthIssue) => set({ azureAuthIssue }),
  setAzureAuthBusy: (azureAuthBusy) => set({ azureAuthBusy }),
  setRegionSearch: (regionSearch) => set({ regionSearch }),
  setAvailabilityRegionSearch: (availabilityRegionSearch) => set({ availabilityRegionSearch }),
  setWorkload: (workload) => set({ workload }),
  setComparisonRegions: (comparisonRegions) => set({ comparisonRegions: [...new Set(comparisonRegions)].slice(0, 3) }),
  setSubscriptionId: (subscriptionId) => set({ subscriptionId, comparisonRegions: [], shortlistKeys: [] }),
  setSeries: (series) => set({ series }),
  applyScenario: (settings) => set({
    series: settings.series,
    regionSearch: settings.regionSearch,
    comparisonRegions: [...settings.comparisonRegions],
    workload: { ...settings.workload },
  }),
}));
