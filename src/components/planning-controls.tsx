import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ConnectorErrorState, EmptyState, LoadingState } from "@/components/states";
import { PageSection } from "@/components/page-section";
import { readArmList } from "@/lib/arm-client";
import { useArmReadContext } from "@/lib/azure-session";
import type { CapacityScope, VmOffer } from "@/lib/azure-capacity";
import {
  DEFAULT_WORKLOAD, MAX_QUOTA_COVERAGE_REGIONS, QUOTA_SCAN_CONCURRENCY, QuotaDataError,
  assessQuota, deploymentReadiness, fitReasons, parseQuota, planningCsv, quotaHeadroom,
  quotaSummary, runBoundedQuotaScan, workloadValue, type DeploymentReadinessRow,
  type QuotaScanOutcome, type QuotaSnapshot, type QuotaUsage, type RegionQuota, type Workload,
} from "@/lib/workload-planning";

const FIELDS: { key: keyof Workload; label: string; min: number; max: number; step: number }[] = [
  { key: "count", label: "Additional VM count", min: 1, max: 10000, step: 1 },
  { key: "minVcpus", label: "Min vCPUs / VM", min: 0, max: 1000000, step: 1 },
  { key: "minMemoryGB", label: "Min RAM GiB / VM", min: 0, max: 1000000, step: 0.1 },
  { key: "minGpus", label: "Min GPUs / VM", min: 0, max: 1000000, step: 1 },
  { key: "minZones", label: "Min available zones", min: 0, max: 3, step: 1 },
];

export function PlanningControls({ scope, children }: { scope: CapacityScope; children?: ReactNode }) {
  return (
    <div className="space-y-4 border-b border-border px-4 py-4 sm:px-6">
      <WorkloadForm key={JSON.stringify(scope.workload)} scope={scope} />
      <p className="text-xs text-muted-foreground">
        {scope.seriesOffers.length} of {scope.unfilteredOffers.length} offered SKU-region results match the applied capability, zone and region filters.
        {" "}Subscription restrictions are retained and labelled separately; quota does not hide results.
        {" "}GPU count does not establish GPU model equivalence. Availability and sufficient quota never guarantee allocation.
      </p>
      {children}
      <details className="rounded-md border border-border p-3">
        <summary className="cursor-pointer text-sm font-semibold">Region comparison &amp; quota coverage</summary>
        <div className="mt-4 space-y-5">
          <RegionComparison scope={scope} />
          <QuotaCoverageReport scope={scope} />
        </div>
      </details>
    </div>
  );
}

function WorkloadForm({ scope }: { scope: CapacityScope }) {
  const [values, setValues] = useState(() => Object.fromEntries(
    FIELDS.map(({ key }) => [key, String(scope.workload[key])]),
  ));
  const [error, setError] = useState("");
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed: Workload = { ...DEFAULT_WORKLOAD };
    for (const { key, label } of FIELDS) {
      const value = workloadValue(key, values[key]);
      if (value === null) {
        setError(`Enter a valid value for ${label}. The previous applied filters are unchanged.`);
        return;
      }
      parsed[key] = value;
    }
    scope.setWorkload(parsed);
    setError("");
  }
  function download() {
    try {
      const text = planningCsv(scope.seriesOffers, {
        subscriptionId: scope.subId!,
        subscriptionName: scope.subs.data?.find((s) => s.id === scope.subId)?.name ?? scope.subId!,
        series: scope.series,
        workload: scope.workload,
        fetchedAt: scope.capacity.data?.fetchedAt,
      }, scope.quotas);
      const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = "azure-vm-planning.csv";
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error("CSV download failed. Please try again.");
    }
  }
  return (
    <form onSubmit={apply} noValidate aria-label="Workload fit filters" className="space-y-3 rounded-lg border border-border bg-card p-4">
      <fieldset className="flex flex-wrap items-end gap-3">
        <legend className="mb-2 text-sm font-semibold">Requirements</legend>
        {FIELDS.map(({ key, label, min, max, step }) => (
          <div key={key} className="flex w-36 flex-col gap-1">
            <label htmlFor={`workload-${key}`} className="text-xs font-medium text-muted-foreground">{label}</label>
            <Input id={`workload-${key}`} type="number" min={min} max={max} step={key === "minMemoryGB" ? "any" : step}
              value={values[key]} aria-describedby="workload-help workload-error"
              aria-invalid={workloadValue(key, values[key]) === null}
              onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))} />
          </div>
        ))}
        <Button type="submit">Apply workload</Button>
        <Button type="button" variant="ghost" onClick={() => {
          setValues(Object.fromEntries(FIELDS.map(({ key }) => [key, String(DEFAULT_WORKLOAD[key])])));
          scope.setWorkload({ ...DEFAULT_WORKLOAD });
          setError("");
        }}>Reset workload</Button>
        <Button type="button" variant="outline" disabled={!scope.subId || !scope.seriesOffers.length || !!scope.error || scope.capacity.isFetching}
          onClick={download}>Download filtered CSV ({scope.seriesOffers.length})</Button>
      </fieldset>
      <p id="workload-help" className="text-xs text-muted-foreground">
        Zero disables a minimum. Unknown capabilities fail active minima. Apply changes before exporting.
        {" "}Count is additional instances of each candidate SKU, not a combined deployment.
      </p>
      <p id="workload-error" role="status" className="text-sm text-destructive">{error}</p>
    </form>
  );
}

function UsageLine({ label, usage }: { label: string; usage?: QuotaUsage }) {
  return (
    <p className="text-xs">
      <span className="font-medium">{label}</span>: used {usage?.used ?? "unknown"} / limit {usage?.limit ?? "unknown"};
      {" "}headroom {quotaHeadroom(usage) ?? "unknown"} vCPUs
    </p>
  );
}

function RegionComparison({ scope }: { scope: CapacityScope }) {
  const candidates = [...new Set(scope.unfilteredOffers.map((o) => o.region))].sort((a, b) =>
    (scope.regions.data?.get(a)?.displayName ?? a).localeCompare(scope.regions.data?.get(b)?.displayName ?? b));
  const [choice, setChoice] = useState("");
  const canAdd = candidates.includes(choice) && !scope.comparisonRegions.includes(choice) && scope.comparisonRegions.length < 3;
  return (
    <PageSection title="Region comparison" description="Select up to three regions for a side-by-side review of matching SKUs and read-only vCPU usage.">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <label htmlFor="compare-region" className="text-xs font-medium">Add region to compare</label>
          <select id="compare-region" value={choice} onChange={(e) => setChoice(e.target.value)}
            disabled={!scope.subId || scope.loading || scope.comparisonRegions.length >= 3}
            className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
            <option value="">Select a region</option>
            {candidates.filter((r) => !scope.comparisonRegions.includes(r)).map((r) => (
              <option key={r} value={r}>{scope.regions.data?.get(r)?.displayName ?? r}</option>
            ))}
          </select>
        </div>
        <Button type="button" variant="outline" disabled={!canAdd || scope.loading || !!scope.error} onClick={() => {
          scope.setComparisonRegions([...scope.comparisonRegions, choice]);
          setChoice("");
        }}>Compare & fetch quota</Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Quota checks regional and exact-family vCPU headroom for regular (non-Spot) VMs.
        {" "}Missing metrics or families stay unknown; API or permission failures are errors, never zero or unlimited.
        {" "}Other limits and actual capacity are not checked. Logical zone numbers are subscription-specific and are not physical equivalences across subscriptions or regions.
      </p>
      {scope.comparisonRegions.length === 0 ? (
        <EmptyState className="py-4" title="No comparison regions selected" description="Choose a region above to compare matching SKUs and inspect quota." />
      ) : (
        <div className="grid min-w-0 items-start gap-3 lg:grid-cols-3">
          {scope.comparisonRegions.map((region, i) => {
            const query = scope.quotaQueries[i];
            const snapshot = scope.quotas.get(region);
            const all = scope.unfilteredOffers.filter((o) => o.region === region);
            const matching = scope.seriesOffers.filter((o) => o.region === region);
            const families = [...new Set(all.map((o) => o.family))].sort();
            return (
              <Card key={region} className="min-w-0 gap-3 py-3">
                <CardHeader className="px-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm">{scope.regions.data?.get(region)?.displayName ?? region}</CardTitle>
                    <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${region} from comparison`}
                      onClick={() => scope.setComparisonRegions(scope.comparisonRegions.filter((r) => r !== region))}>Remove</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">{matching.length} matching SKUs; {matching.filter((o) => o.status === "restricted").length} subscription-restricted</p>
                </CardHeader>
                <CardContent className="min-w-0 space-y-3 px-3">
                  {snapshot?.state === "loading" ? <LoadingState rows={1} /> : snapshot?.state === "error" ? (
                    <div role="status">
                      <p className="text-sm font-medium text-destructive">Quota unavailable for {region}</p>
                      <p className="text-xs text-muted-foreground">{query.error instanceof QuotaDataError
                        ? query.error.message
                        : "Check ARM read permission and API/connector support. Quota sufficiency is unknown."}</p>
                      <ConnectorErrorState error={query.error} connector="Azure Resource Manager" className="py-3"
                        action={<Button type="button" size="sm" variant="outline" onClick={() => void query.refetch()}>Retry quota</Button>} />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <UsageLine label="Total regional vCPUs" usage={snapshot?.data?.usages.find((q) => q.name === "cores")} />
                      {families.map((family) => (
                        <div key={family} className="break-words">
                          <UsageLine label={family} usage={snapshot?.data?.usages.find((q) => q.name === family.toLowerCase())} />
                        </div>
                      ))}
                      <p className="text-xs text-muted-foreground">Quota fetched {snapshot?.data?.fetchedAt.toLocaleString() ?? "unknown"}</p>
                      <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>Refresh quota</Button>
                    </div>
                  )}
                  {matching.length === 0 ? <EmptyState className="py-4" title="No matching SKUs" description="The applied region, capability or zone filters exclude this region's sizes." /> : (
                    <div className="max-h-80 space-y-2 overflow-auto" aria-label={`Matching SKUs in ${region}`} tabIndex={0}>
                      {matching.map((o) => <OfferComparison key={o.key} offer={o} count={scope.workload.count} snapshot={snapshot} />)}
                    </div>
                  )}
                  {all.length > matching.length && (
                    <details className="text-xs">
                      <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-ring">Excluded SKUs ({all.length - matching.length})</summary>
                      <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                        {all.filter((o) => !matching.some((m) => m.key === o.key)).map((o) => (
                          <li key={o.key} className="break-words"><span className="font-mono">{o.size}</span>: {fitReasons(o, scope.workload).join("; ") || "Excluded by region search"}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </PageSection>
  );
}

function QuotaCoverageReport({ scope }: { scope: CapacityScope }) {
  const context = useArmReadContext();
  const queryClient = useQueryClient();
  const [results, setResults] = useState<Map<string, QuotaScanOutcome>>(() => new Map());
  const [progress, setProgress] = useState<{
    state: "idle" | "running" | "cancelled" | "complete";
    completed: number;
    total: number;
  }>({ state: "idle", completed: 0, total: 0 });
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const scopeKey = JSON.stringify([
    context.cacheKey, context.enabled, scope.subId, scope.series, scope.regionSearch,
    scope.workload, scope.comparisonRegions, scope.capacity.data?.fetchedAt.getTime(),
    scope.quotaQueries.map((query) => query.isFetching),
    scope.regionOffers.map((offer) => offer.key), scope.seriesOffers.map((offer) => offer.key),
  ]);
  const readiness = useMemo(() => {
    const quotas = new Map<string, QuotaSnapshot>([...results].map(([region, result]) => [
      region, { state: result.state, data: result.data },
    ]));
    return deploymentReadiness(scope.regionOffers, scope.seriesOffers, scope.workload.count, quotas)
      .sort((a, b) =>
        (scope.regions.data?.get(a.region)?.displayName ?? a.region)
          .localeCompare(scope.regions.data?.get(b.region)?.displayName ?? b.region));
  }, [results, scope.regionOffers, scope.seriesOffers, scope.workload.count, scope.regions.data]);
  const scanRegions = readiness.filter((row) => row.eligibleSkuCount > 0).map((row) => row.region);
  const canScan = context.enabled && !!scope.subId && scanRegions.length > 0 &&
    scanRegions.length <= MAX_QUOTA_COVERAGE_REGIONS &&
    !scope.quotaQueries.some((query) => query.isFetching);
  const counts = readiness.reduce((total, row) => {
    total[row.readiness]++;
    return total;
  }, { ready: 0, blocked: 0, unknown: 0, "not-checked": 0 });

  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    generation.current++;
    setResults(new Map());
    setProgress({ state: "idle", completed: 0, total: 0 });
    return () => controller.current?.abort();
  }, [scopeKey]);

  async function startScan() {
    if (!canScan || !scope.subId) return;
    const resume = progress.state === "cancelled";
    const targets = resume
      ? scanRegions.filter((region) => results.get(region)?.state !== "ready")
      : scanRegions;
    const run = ++generation.current;
    const abortController = new AbortController();
    controller.current = abortController;
    const previousCount = resume ? scanRegions.length - targets.length : 0;
    if (!resume) setResults(new Map());
    setProgress({ state: "running", completed: previousCount, total: scanRegions.length });
    try {
      await runBoundedQuotaScan(targets, async (region, signal) => {
        const queryKey = ["arm", context.cacheKey, "quota", scope.subId, region];
        const cached = queryClient.getQueryData<RegionQuota>(queryKey);
        const cachedState = queryClient.getQueryState(queryKey);
        if (cached && cachedState?.dataUpdatedAt && cachedState.dataUpdatedAt > 0 &&
          Date.now() - cachedState.dataUpdatedAt < 5 * 60_000) {
          return cached;
        }
        const raw = await readArmList({ kind: "quota", subscriptionId: scope.subId!, region }, context, signal);
        const data = parseQuota({ value: raw });
        queryClient.setQueryData(queryKey, data);
        return data;
      }, (region, result) => {
        if (generation.current !== run || abortController.signal.aborted) return;
        setResults((previous) => new Map(previous).set(region, result));
        setProgress((previous) => ({ ...previous, completed: previous.completed + 1 }));
      }, abortController.signal);
    } finally {
      if (generation.current === run) {
        controller.current = null;
        setProgress((previous) => ({
          ...previous,
          state: abortController.signal.aborted ? "cancelled" : "complete",
        }));
      }
    }
  }

  const statusVariant: Record<DeploymentReadinessRow["readiness"], "default" | "destructive" | "secondary" | "outline"> = {
    ready: "default",
    blocked: "destructive",
    unknown: "secondary",
    "not-checked": "outline",
  };

  return (
    <PageSection
      title="Quota coverage & deployment readiness"
      description="Evaluate the current workload across regions in this series and region search. Only matching, subscription-eligible regions need quota reads."
      action={progress.state === "running" ? (
        <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>Cancel scan</Button>
      ) : (
        <Button type="button" variant="outline" disabled={!canScan}
          onClick={() => void startScan()}>
          {progress.state === "cancelled" ? "Resume quota scan"
            : progress.state === "complete" ? "Refresh quota coverage"
            : "Scan quota coverage"}
        </Button>
      )}
      className="border-t border-border pt-4"
    >
      <p className="text-xs text-muted-foreground">
        Ready {counts.ready} · Blocked {counts.blocked} · Unknown {counts.unknown} · Not checked {counts["not-checked"]}.
        {" "}A region is ready when at least one matching eligible SKU has enough regional and family vCPU quota for the requested VM count.
        {" "}This does not verify other deployment constraints, actual capacity, or guarantee allocation.
      </p>
      {progress.state === "running" && (
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          Checking {progress.completed} of {progress.total} regions, with up to {QUOTA_SCAN_CONCURRENCY} reads at a time.
        </p>
      )}
      {scanRegions.length > MAX_QUOTA_COVERAGE_REGIONS && (
        <p role="status" className="text-sm text-muted-foreground">
          {scanRegions.length} eligible regions exceed the {MAX_QUOTA_COVERAGE_REGIONS}-region scan limit. Narrow the region search before scanning.
        </p>
      )}
      {scope.quotaQueries.some((query) => query.isFetching) && (
        <p role="status" className="text-sm text-muted-foreground">
          Wait for the selected-region quota requests to finish before starting the coverage scan.
        </p>
      )}
      {readiness.length > 0 && scanRegions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No quota reads are needed because no region has a matching, subscription-eligible SKU.
        </p>
      )}
      {readiness.length === 0 ? (
        <EmptyState className="py-4" title="No regions in the current result scope"
          description="Choose a VM series with offered regions or clear the region search to build a readiness report." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Region</th>
                <th scope="col" className="px-3 py-2 font-medium">Readiness</th>
                <th scope="col" className="px-3 py-2 font-medium">Matching / eligible SKUs</th>
                <th scope="col" className="px-3 py-2 font-medium">Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {readiness.map((row) => (
                <tr key={row.region} className="align-top">
                  <th scope="row" className="px-3 py-2 font-medium">
                    {scope.regions.data?.get(row.region)?.displayName ?? row.region}
                  </th>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant[row.readiness]}>
                      {row.readiness === "not-checked" ? "Not checked" : row.readiness}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{row.matchingSkuCount} / {row.eligibleSkuCount}</td>
                  <td className="max-w-[42rem] px-3 py-2 text-muted-foreground">
                    <p>{row.reason}</p>
                    {row.checkedAt && <p className="mt-1 text-xs">Quota checked {row.checkedAt.toLocaleString()}</p>}
                    {row.readiness === "unknown" && results.get(row.region)?.state === "error" && (
                      <p className="mt-1 text-xs text-destructive">Check ARM read permission and API or connector support.</p>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PageSection>
  );
}

function OfferComparison({ offer: o, count, snapshot }: { offer: VmOffer; count: number; snapshot?: QuotaSnapshot }) {
  const quota = assessQuota(o, count, snapshot);
  return (
    <div className="space-y-1 rounded-md border border-border p-2 text-xs">
      <p className="break-words font-mono font-medium">{o.sku}</p>
      <p>Capability / zone fit: matches applied minima</p>
      <p>Subscription eligibility: {o.status}{o.reason ? ` (${o.reason})` : ""}</p>
      <p>{o.vcpus ?? "Unknown"} active vCPUs; {o.memoryGB ?? "Unknown"} GiB; {o.gpus ?? "Unknown"} GPUs / VM</p>
      <p>Available zones: {o.availableZones.join(", ") || "None reported"} / offered: {o.zones.join(", ") || "None reported"}</p>
      <p className={quota.status === "insufficient" ? "font-medium text-destructive" : ""}>{quotaSummary(o, count, snapshot)}</p>
    </div>
  );
}
