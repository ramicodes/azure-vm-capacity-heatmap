import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/page-header";
import { ConnectorErrorState, EmptyState, LoadingState } from "@/components/states";
import { RefreshControl, ScopeControls } from "@/components/scope-controls";
import { useCapacityScope } from "@/lib/azure-capacity";
import {
  estimateMonthlyCost, fetchRetailPricesForOffers, MAX_MONTHLY_HOURS, MAX_PRICING_SKUS,
  selectRetailPrice,
} from "@/lib/azure-pricing";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const hourlyMoney = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 3, maximumFractionDigits: 5,
});

export function CostPage() {
  const scope = useCapacityScope("workload", { includeQuota: false });
  const [regionInput, setRegionInput] = useState("");
  const [operatingSystem, setOperatingSystem] = useState<"linux" | "windows">("linux");
  const [hoursInput, setHoursInput] = useState("730");
  const regions = useMemo(() => [...new Set(scope.regionOffers.map((offer) => offer.region))]
    .sort((a, b) => (scope.regions.data?.get(a)?.displayName ?? a)
      .localeCompare(scope.regions.data?.get(b)?.displayName ?? b)), [scope.regionOffers, scope.regions.data]);
  const region = regions.includes(regionInput) ? regionInput : regions[0] ?? "";
  const candidates = useMemo(() => scope.seriesOffers
    .filter((offer) => offer.region === region && offer.status !== "restricted")
    .sort((a, b) => a.sku.localeCompare(b.sku)), [scope.seriesOffers, region]);
  const pricedOffers = candidates.slice(0, MAX_PRICING_SKUS);
  const skus = pricedOffers.map((offer) => offer.sku);
  const priceQuery = useQuery({
    queryKey: ["retail-prices", region, skus],
    queryFn: ({ signal }) => fetchRetailPricesForOffers(pricedOffers, region, signal),
    enabled: !!region && pricedOffers.length > 0,
    staleTime: 24 * 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const hours = /^\d+$/.test(hoursInput) ? Number(hoursInput) : NaN;
  const validHours = Number.isSafeInteger(hours) && hours >= 1 && hours <= MAX_MONTHLY_HOURS;
  const rows = useMemo(() => pricedOffers.map((offer) => {
    const records = priceQuery.data?.get(offer.sku) ?? [];
    const price = selectRetailPrice(records, offer.sku, region, operatingSystem);
    return {
      offer,
      price,
      monthlyPerVm: price && validHours
        ? estimateMonthlyCost(price.retailPrice, 1, hours)
        : null,
      monthly: price && validHours
        ? estimateMonthlyCost(price.retailPrice, scope.workload.count, hours)
        : null,
    };
  }).sort((a, b) => (a.monthly ?? Infinity) - (b.monthly ?? Infinity) || a.offer.sku.localeCompare(b.offer.sku)),
  [pricedOffers, priceQuery.data, region, operatingSystem, validHours, scope.workload.count, hours]);

  useEffect(() => {
    if (region && region !== regionInput) setRegionInput(region);
  }, [region, regionInput]);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Cost estimates" description="Compare public Azure VM compute rates for sizes that match the current Workload fit requirements. Estimates are in USD and are not a quote or a guarantee of billed cost." />
      <div className="planner-toolbar flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6">
        <ScopeControls scope={scope} />
        <RefreshControl scope={scope} />
      </div>
      <div className="planner-toolbar flex flex-wrap items-end gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="flex min-w-40 flex-col gap-1">
          <label htmlFor="cost-region" className="text-xs font-medium text-muted-foreground">Region</label>
          <select id="cost-region" value={region} onChange={(event) => setRegionInput(event.target.value)}
            disabled={scope.loading || regions.length === 0}
            className="h-9 max-w-full rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
            {regions.map((name) => (
              <option key={name} value={name}>{scope.regions.data?.get(name)?.displayName ?? name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cost-os" className="text-xs font-medium text-muted-foreground">Operating system</label>
          <select id="cost-os" value={operatingSystem} onChange={(event) => setOperatingSystem(event.target.value as "linux" | "windows")}
            className="h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring">
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
          </select>
        </div>
        <div className="flex w-40 flex-col gap-1">
          <label htmlFor="cost-hours" className="text-xs font-medium text-muted-foreground">Runtime hours / month</label>
          <Input id="cost-hours" type="number" min={1} max={MAX_MONTHLY_HOURS} step={1}
            value={hoursInput} onChange={(event) => setHoursInput(event.target.value)}
            aria-describedby="cost-assumptions cost-hours-error" aria-invalid={!validHours} />
        </div>
        <p id="cost-hours-error" role="status" className="text-xs text-destructive">
          {!validHours && `Enter a whole number from 1 to ${MAX_MONTHLY_HOURS}.`}
        </p>
        {region && candidates.length > 0 && (
          <Button type="button" variant="outline" onClick={() => void priceQuery.refetch()} disabled={priceQuery.isFetching}>
            {priceQuery.isFetching ? "Refreshing prices..." : "Refresh prices"}
          </Button>
        )}
        <p id="cost-assumptions" className="w-full text-xs text-muted-foreground">
          Public pay-as-you-go list rates only · {scope.workload.count} VM{scope.workload.count === 1 ? "" : "s"} ·
          {" "}{validHours ? hours : "—"} hours / month · Spot, reservations, negotiated discounts, storage, networking, tax,
          {" "}and additional software licensing are excluded.
        </p>
        <p role="status" aria-live="polite" className="w-full text-xs text-muted-foreground">
          {priceQuery.isFetching && !priceQuery.isPending ? "Refreshing retail prices. Previous estimates remain visible until the response arrives." : ""}
        </p>
      </div>

      {scope.error ? (
        <ConnectorErrorState error={scope.error} connector="Azure Resource Manager"
          action={<Button variant="outline" onClick={scope.refetchAll}>Try again</Button>} />
      ) : scope.loading ? (
        <div className="px-4 py-4 sm:px-6"><LoadingState rows={3} label="Loading the Azure VM catalog..." /></div>
      ) : priceQuery.isError ? (
        <ConnectorErrorState error={priceQuery.error} connector="Azure Retail Prices"
          action={<Button variant="outline" onClick={() => void priceQuery.refetch()}>Retry prices</Button>} />
      ) : candidates.length === 0 ? (
        <EmptyState className="py-8" title={region ? "No eligible sizes match this workload" : "No regions available"}
          description="Adjust the workload requirements or choose a series with offered sizes in Workload fit." />
      ) : priceQuery.isPending ? (
        <div className="px-4 py-4 sm:px-6"><LoadingState rows={4} label="Loading VM retail prices..." /></div>
      ) : (
        <section aria-label="Estimated VM compute prices" aria-busy={priceQuery.isFetching} className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
          {candidates.length > MAX_PRICING_SKUS && (
            <p role="status" className="text-sm text-muted-foreground">
              Showing the first {MAX_PRICING_SKUS} of {candidates.length} matching sizes. Narrow the workload or series to compare more precisely.
            </p>
          )}
          {rows.every((row) => row.price === null) ? (
            <EmptyState title={`No ${operatingSystem === "linux" ? "Linux" : "Windows"} retail rates found`}
              description="No current hourly public pay-as-you-go meter matched these VM sizes and region." />
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">
                  Public Azure retail compute estimates for {scope.regions.data?.get(region)?.displayName ?? region}
                </caption>
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th scope="col" className="px-3 py-2 text-left font-medium">VM size</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">vCPUs</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">RAM (GiB)</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Hourly / VM</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Monthly / VM</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Monthly total</th>
                    <th scope="col" className="px-3 py-2 text-left font-medium">Rate effective</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ offer, price, monthlyPerVm, monthly }) => (
                    <tr key={offer.key} className="border-b border-border last:border-0">
                      <th scope="row" className="px-3 py-2 text-left font-mono font-medium">{offer.size}</th>
                      <td className="px-3 py-2 text-right">{offer.vcpus ?? "Unknown"}</td>
                      <td className="px-3 py-2 text-right">{offer.memoryGB ?? "Unknown"}</td>
                      <td className="px-3 py-2 text-right">{price ? hourlyMoney.format(price.retailPrice) : "Rate unavailable"}</td>
                      <td className="px-3 py-2 text-right">
                        {monthlyPerVm === null ? "—" : money.format(monthlyPerVm)}
                      </td>
                      <td className="px-3 py-2 text-right font-medium">{monthly === null ? "—" : money.format(monthly)}</td>
                      <td className="px-3 py-2 text-left">{price ? new Date(price.effectiveStartDate).toLocaleDateString() : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="max-w-4xl text-xs text-muted-foreground">
            Source: <a className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
              href="https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices"
              target="_blank" rel="noreferrer">Azure Retail Prices API</a>. Rates are selected by exact VM size and region from current non-Spot hourly meters.
            {" "}Windows uses a published Windows meter when available. Validate final estimates with your agreement and Azure pricing tools.
          </p>
        </section>
      )}
    </div>
  );
}
