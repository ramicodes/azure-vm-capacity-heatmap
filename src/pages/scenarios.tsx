import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/states";
import { useAppStore } from "@/lib/store";
import {
  createSavedScenario, loadSavedScenarios, MAX_SAVED_SCENARIOS,
  storeSavedScenarios, type SavedScenario,
} from "@/lib/saved-scenarios";

function describeWorkload(scenario: SavedScenario) {
  const { workload } = scenario;
  const requirements = [
    workload.minVcpus > 0 ? `${workload.minVcpus}+ vCPUs` : null,
    workload.minMemoryGB > 0 ? `${workload.minMemoryGB}+ GiB RAM` : null,
    workload.minGpus > 0 ? `${workload.minGpus}+ GPUs` : null,
    workload.minZones > 0 ? `${workload.minZones}+ zones` : null,
  ].filter(Boolean);
  return `${workload.count} VM${workload.count === 1 ? "" : "s"}${requirements.length ? ` · ${requirements.join(" · ")}` : " · no capability minimums"}`;
}

export function ScenariosPage() {
  const navigate = useNavigate();
  const series = useAppStore((state) => state.series);
  const regionSearch = useAppStore((state) => state.regionSearch);
  const comparisonRegions = useAppStore((state) => state.comparisonRegions);
  const workload = useAppStore((state) => state.workload);
  const applyScenario = useAppStore((state) => state.applyScenario);
  const [name, setName] = useState("");
  const [scenarios, setScenarios] = useState<SavedScenario[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    try {
      setScenarios(loadSavedScenarios(window.localStorage));
      setStorageReady(true);
    } catch {
      setStorageError("Saved scenarios are unavailable in this browser. Check local storage access and try again.");
    }
  }, []);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!storageReady) return;
    if (scenarios.length >= MAX_SAVED_SCENARIOS) {
      setStorageError(`You can save up to ${MAX_SAVED_SCENARIOS} scenarios. Delete one before saving another.`);
      return;
    }
    try {
      const scenario = createSavedScenario(name, { series, regionSearch, comparisonRegions, workload });
      const updated = [scenario, ...scenarios];
      storeSavedScenarios(window.localStorage, updated);
      setScenarios(updated);
      setName("");
      setStorageError("");
      toast.success("Scenario saved in this browser.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The scenario could not be saved.";
      setStorageError(message);
      toast.error(message);
    }
  }

  function remove(id: string) {
    const updated = scenarios.filter((scenario) => scenario.id !== id);
    try {
      storeSavedScenarios(window.localStorage, updated);
      setScenarios(updated);
      setStorageError("");
      toast.success("Scenario removed from this browser.");
    } catch {
      setStorageError("The scenario could not be removed. Check local storage access and try again.");
      toast.error("The scenario could not be removed.");
    }
  }

  function apply(scenario: SavedScenario) {
    applyScenario(scenario);
    navigate("/charts");
    toast.success(`Applied “${scenario.name}”. Showing Workload fit for the current subscription.`);
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Saved scenarios" description="Save and reuse workload filters and region selections in this browser. Apply a scenario to open its matching SKUs and regional comparisons in Workload fit, using the currently selected subscription." />
      <section aria-labelledby="save-scenario-title" className="space-y-3 border-b border-border px-4 py-4 sm:px-6">
        <h2 id="save-scenario-title" className="text-sm font-semibold">Save current workload setup</h2>
        <p className="text-xs text-muted-foreground">
          Current series: {series} · {describeWorkload({ id: "current", name: "", savedAt: "", series, regionSearch, comparisonRegions, workload })}
          {" "}· {comparisonRegions.length} comparison region{comparisonRegions.length === 1 ? "" : "s"}
        </p>
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="flex w-full max-w-sm flex-col gap-1">
            <label htmlFor="scenario-name" className="text-xs font-medium text-muted-foreground">Scenario name</label>
            <Input id="scenario-name" value={name} maxLength={60} required
              onChange={(event) => setName(event.target.value)} placeholder="e.g. GPU inference in East US" />
          </div>
          <Button type="submit" disabled={!storageReady || !name.trim() || scenarios.length >= MAX_SAVED_SCENARIOS}>
            Save scenario
          </Button>
          <Link to="/charts" className="inline-flex h-9 items-center rounded-md px-3 text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
            Edit in Workload fit
          </Link>
        </form>
        {storageError && <p role="alert" className="text-sm text-destructive">{storageError}</p>}
      </section>

      <section aria-labelledby="saved-scenarios-title" className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="saved-scenarios-title" className="text-sm font-semibold">Your scenarios</h2>
          <p className="text-xs text-muted-foreground">{scenarios.length} of {MAX_SAVED_SCENARIOS} saved · stored only in this browser</p>
        </div>
        {!storageReady && !storageError ? (
          <p role="status" className="text-sm text-muted-foreground">Reading saved scenarios…</p>
        ) : storageError && !storageReady ? (
          <EmptyState title="Browser storage unavailable" description={storageError} />
        ) : scenarios.length === 0 ? (
          <EmptyState title="No saved scenarios yet" description="Configure requirements in Workload fit, then return here to name and save the setup. Apply a saved scenario to view its matches; saving alone does not run an analysis." />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <caption className="sr-only">Saved workload scenarios in this browser</caption>
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Scenario</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Setup</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Regions</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Saved</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {scenarios.map((scenario) => (
                  <tr key={scenario.id} className="border-b border-border last:border-0">
                    <th scope="row" className="max-w-60 px-3 py-2 text-left font-medium">
                      <span className="block truncate">{scenario.name}</span>
                      <span className="text-xs font-normal text-muted-foreground">{scenario.series}-series</span>
                    </th>
                    <td className="px-3 py-2">{describeWorkload(scenario)}</td>
                    <td className="px-3 py-2">
                      {scenario.comparisonRegions.length
                        ? scenario.comparisonRegions.join(", ")
                        : "Region search only"}
                      {scenario.regionSearch && <span className="block text-xs text-muted-foreground">Search: {scenario.regionSearch}</span>}
                    </td>
                    <td className="px-3 py-2">{new Date(scenario.savedAt).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" variant="outline" aria-label={`Apply ${scenario.name} and view matches`}
                          onClick={() => apply(scenario)}>Apply &amp; view matches</Button>
                        <Button type="button" size="sm" variant="ghost" aria-label={`Delete ${scenario.name}`}
                          onClick={() => remove(scenario.id)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="max-w-3xl text-xs text-muted-foreground">
          Scenarios contain only the VM series, workload requirements, region search, and comparison-region names. They do not contain subscription IDs, account details, quota results, or cost results, and are not synchronized to other browsers.
        </p>
      </section>
    </div>
  );
}
