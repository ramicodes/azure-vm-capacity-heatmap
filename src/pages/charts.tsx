import { ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectorErrorState, EmptyState } from "@/components/states";
import { RefreshControl, ScopeControls } from "@/components/scope-controls";
import { PlanningControls } from "@/components/planning-controls";
import { OfferSummaryChart } from "@/components/offer-summary-chart";
import { useCapacityScope } from "@/lib/azure-capacity";

export function ChartsPage() {
  const scope = useCapacityScope("workload");
  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1 px-4 pt-4 sm:px-6">
        <h1 className="text-lg font-semibold tracking-tight">Workload fit</h1>
        <p className="text-sm text-muted-foreground">Apply requirements, inspect matching and excluded sizes, compare regions and check vCPU quota. This tab's filters do not change VM availability.</p>
      </div>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
        <ScopeControls scope={scope} />
        <RefreshControl scope={scope} />
      </div>
      <PlanningControls scope={scope} />
      {scope.error ? (
        <ConnectorErrorState error={scope.error} connector="Azure Resource Manager"
          action={<Button variant="outline" onClick={scope.refetchAll}>Try again</Button>} />
      ) : scope.subs.data && scope.subs.data.length === 0 ? (
        <EmptyState icon={ServerOff} title="No Azure subscriptions found for this account" />
      ) : scope.loading ? (
        <div role="status" aria-label="Loading workload fit" className="px-4 py-4 sm:px-6">
          <Skeleton className="h-80 w-full rounded-xl" />
        </div>
      ) : (
        <section aria-label="Workload matching analysis" className="min-w-0 space-y-3 px-4 py-4 sm:px-6">
          {scope.regionOffers.length > 0 && scope.seriesOffers.length === 0 && (
            <EmptyState title="No sizes match the applied requirements" description="Reduce a capability or zone minimum, or reset the workload. Excluded offerings remain visible in the analysis below." />
          )}
          <OfferSummaryChart scope={scope} />
        </section>
      )}
    </div>
  );
}
