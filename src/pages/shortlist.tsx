import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueries } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConnectorErrorState, EmptyState, LoadingState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { ScopeControls, RefreshControl } from "@/components/scope-controls";
import { useCapacityScope } from "@/lib/azure-capacity";
import { useAppStore } from "@/lib/store";
import { useArmReadContext } from "@/lib/azure-session";
import { readArmList } from "@/lib/arm-client";
import { DASHBOARD_QUERY_CACHE } from "@/lib/query-client";
import { assessQuota, fitReasons, parseQuota, planningCsv, type QuotaSnapshot } from "@/lib/workload-planning";
import { quotaGuidance } from "@/lib/deployment-shortlist";
import { toast } from "sonner";

export function ShortlistPage() {
  const scope = useCapacityScope("workload", { includeQuota: false });
  const context = useArmReadContext();
  const keys = useAppStore((s) => s.shortlistKeys);
  const setKeys = useAppStore((s) => s.setShortlistKeys);
  const [search, setSearch] = useState("");
  const [checkedScope, setCheckedScope] = useState("");
  const selected = (scope.capacity.data?.offers ?? []).filter((offer) => keys.includes(offer.key));
  const regions = [...new Set(selected.map((offer) => offer.region))].sort();
  const checkKey = JSON.stringify([context.cacheKey, scope.subId, regions]);
  const queries = useQueries({
    queries: regions.map((region) => ({
      queryKey: ["arm", context.cacheKey, "quota", scope.subId, region],
      queryFn: async ({ signal }: { signal: AbortSignal }) => parseQuota({
        value: await readArmList({ kind: "quota", subscriptionId: scope.subId!, region }, context, signal),
      }),
      ...DASHBOARD_QUERY_CACHE,
      enabled: context.enabled && !!scope.subId && checkedScope === checkKey,
      staleTime: 5 * 60_000,
      retry: false,
      retryOnMount: false,
    })),
  });
  const quotas = new Map<string, QuotaSnapshot>(regions.map((region, index) => {
    const query = queries[index];
    return [region, {
      state: checkedScope !== checkKey ? "not-requested" : query.isError ? "error"
        : query.isPending || query.isFetching ? "loading" : "ready",
      data: checkedScope === checkKey && !query.isError && !query.isFetching ? query.data : undefined,
    }];
  }));
  const candidates = scope.seriesOffers.filter((offer) =>
    `${offer.sku} ${offer.region}`.toLowerCase().includes(search.trim().toLowerCase()));
  function download() {
    try {
      if (!scope.subId) throw new Error("Select a subscription before exporting.");
      const csv = planningCsv(selected, {
        subscriptionId: scope.subId,
        subscriptionName: scope.subs.data?.find((sub) => sub.id === scope.subId)?.name ?? scope.subId,
        series: [...new Set(selected.map((offer) => offer.series))].join("; "),
        workload: scope.workload, fetchedAt: scope.capacity.data?.fetchedAt,
      }, quotas);
      const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      try {
        anchor.href = url;
        anchor.download = "azure-vm-shortlist.csv";
        document.body.append(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      toast.error("Shortlist export failed. Select a subscription and try again.");
    }
  }
  return (
    <div className="space-y-5 pb-5 [&>section]:mx-4 sm:[&>section]:mx-6">
      <PageHeader title="Deployment shortlist" description="Compare up to three VM and region candidates, check quota, and identify your next action. Each candidate is an alternative, not a combined deployment." />
      <div className="planner-toolbar flex flex-wrap items-end gap-3 border-y border-border px-4 py-4 sm:px-6">
        <ScopeControls scope={scope} /><RefreshControl scope={scope} />
      </div>
      <div className="flex flex-wrap items-center gap-3 px-4 text-sm sm:px-6">
        <span>Planning for <strong>{scope.workload.count} additional VM{scope.workload.count === 1 ? "" : "s"}</strong> per candidate.</span>
        <Link className="underline underline-offset-4" to="/charts">Edit workload requirements</Link>
        <Link className="underline underline-offset-4" to="/cost">Compare retail costs</Link>
      </div>
      {scope.error ? <ConnectorErrorState error={scope.error} connector="Azure Resource Manager"
        action={<Button variant="outline" onClick={scope.refetchAll}>Try again</Button>} /> : scope.loading ? (
        <LoadingState className="px-4 sm:px-6" label="Loading the Azure VM catalog..." />
      ) : scope.subs.data?.length === 0 ? (
        <EmptyState title="No Azure subscriptions found for this account" />
      ) : (
        <>
          <section aria-labelledby="shortlist-title" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="shortlist-title" className="font-semibold">Selected candidates ({selected.length}/3)</h2>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!selected.length || queries.some((query) => query.isFetching)}
                  onClick={() => {
                    if (checkedScope === checkKey) queries.forEach((query) => { void query.refetch(); });
                    else setCheckedScope(checkKey);
                  }}>{queries.some((query) => query.isFetching) ? "Checking quota..." : "Check quota"}</Button>
                <Button variant="outline" disabled={!selected.length || !scope.subId} onClick={download}>Export shortlist CSV</Button>
              </div>
            </div>
            {!selected.length ? <EmptyState title="Build your deployment shortlist" description="Add candidates from the matching results below. Change series or region filters to compare alternatives; selected candidates remain visible." /> : (
              <div className="grid items-start gap-4 lg:grid-cols-3">
                {selected.map((offer) => {
                  const quota = quotas.get(offer.region);
                  const q = assessQuota(offer, scope.workload.count, quota);
                  const exclusions = fitReasons(offer, scope.workload);
                  return (
                    <article key={offer.key} className="min-w-0 space-y-3 rounded-md border border-border p-4">
                      <div className="space-y-1">
                        <h3 className="break-words font-semibold">{offer.sku}</h3>
                        <p className="text-sm">{scope.regions.data?.get(offer.region)?.displayName ?? offer.region}</p>
                      </div>
                      <dl className="grid grid-cols-2 gap-2 text-sm">
                        <dt>vCPUs / VM</dt><dd>{offer.vcpus ?? "Unknown"}</dd>
                        <dt>RAM / VM</dt><dd>{offer.memoryGB == null ? "Unknown" : `${offer.memoryGB} GiB`}</dd>
                        <dt>GPUs / VM</dt><dd>{offer.gpus ?? "Unknown"}</dd>
                        <dt>Usable zones</dt><dd>{offer.availableZones.join(", ") || "None reported"}</dd>
                        <dt>Eligibility</dt><dd>{offer.status}</dd>
                        <dt>Required vCPUs</dt><dd>{q.required ?? "Unknown"}</dd>
                        <dt>Regional headroom</dt><dd>{q.regionalHeadroom ?? "Unknown"}</dd>
                        <dt>Family headroom</dt><dd>{q.familyHeadroom ?? "Unknown"}</dd>
                      </dl>
                      <p className="text-sm">{exclusions.length
                        ? `Does not meet current requirements: ${exclusions.join("; ")}.`
                        : "Meets current capability and zone requirements."}</p>
                      <p className="text-sm font-medium">Quota: {q.status}</p>
                      <p className="text-sm">{quotaGuidance(offer, scope.workload.count, quota)}</p>
                      {quota?.data && <p className="text-xs text-muted-foreground">Quota checked {quota.data.fetchedAt.toLocaleString()}</p>}
                      <div className="flex flex-wrap items-center gap-3">
                        <a href="https://portal.azure.com/#view/Microsoft_Azure_Capacity/QuotaMenuBlade/~/myQuotas"
                          target="_blank" rel="noopener noreferrer" className="text-sm underline underline-offset-4">Review quotas in Azure</a>
                        <Button variant="ghost" size="sm" aria-label={`Remove ${offer.sku} in ${offer.region}`}
                          onClick={() => setKeys(keys.filter((key) => key !== offer.key))}>Remove</Button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
          <section aria-labelledby="candidate-title" className="space-y-3">
            <h2 id="candidate-title" className="font-semibold">Matching candidates</h2>
            <label htmlFor="candidate-search" className="block text-sm">Find a VM size or region</label>
            <Input id="candidate-search" className="max-w-sm" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="e.g. D4s_v5 or eastus" />
            <p role="status" className="text-sm text-muted-foreground">{candidates.length} results match the current series, region and workload filters. Showing up to 50; narrow your search for more.</p>
            {!candidates.length ? <EmptyState title="No matching candidates" description="Change the series or region filter, or edit the workload requirements." /> : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Candidates matching applied workload requirements</caption>
                  <thead className="border-b border-border bg-muted/50"><tr>
                    {["VM size", "Region", "vCPUs", "RAM GiB", "GPUs", "Eligibility", "Action"].map((label) => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}
                  </tr></thead>
                  <tbody>{candidates.slice(0, 50).map((offer) => <tr key={offer.key} className="border-b border-border last:border-0">
                    <th scope="row" className="px-3 py-2 font-medium">{offer.sku}</th>
                    <td className="px-3 py-2">{offer.region}</td><td className="px-3 py-2">{offer.vcpus ?? "Unknown"}</td>
                    <td className="px-3 py-2">{offer.memoryGB ?? "Unknown"}</td><td className="px-3 py-2">{offer.gpus ?? "Unknown"}</td>
                    <td className="px-3 py-2">{offer.status}</td>
                    <td className="px-3 py-2"><Button variant="outline" size="sm" disabled={keys.includes(offer.key) || keys.length >= 3}
                      aria-label={`Add ${offer.sku} in ${offer.region}`}
                      onClick={() => setKeys([...keys, offer.key])}>{keys.includes(offer.key) ? "Added" : "Add"}</Button></td>
                  </tr>)}</tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      <p className="mx-4 max-w-3xl text-xs text-muted-foreground sm:mx-6">The shortlist stays in memory and clears on subscription/account changes or reload. Quota checks are read-only and use cached results for up to five minutes. Review the correct subscription, region and exact VM family in Azure before requesting an increase. No request or deployment is submitted here. Offered sizes, zones and sufficient quota never guarantee allocation.</p>
    </div>
  );
}
