import { ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChartLoadingState, ConnectorErrorState, EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { RefreshControl, ScopeControls } from "@/components/scope-controls";
import { PlanningControls } from "@/components/planning-controls";
import { OfferSummaryChart } from "@/components/offer-summary-chart";
import { useCapacityScope } from "@/lib/azure-capacity";

export function ChartsPage() {
  const scope = useCapacityScope("workload");
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Workload fit" description="Apply requirements, inspect matching and excluded sizes, compare regions and check vCPU quota. This tab's filters do not change VM availability." />
      <div className="planner-toolbar flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6">
        <ScopeControls scope={scope} />
        <RefreshControl scope={scope} />
      </div>
      <PlanningControls scope={scope}>
      {scope.error ? (
        <ConnectorErrorState error={scope.error} connector="Azure Resource Manager"
          action={<Button variant="outline" onClick={scope.refetchAll}>Try again</Button>} />
      ) : scope.subs.data && scope.subs.data.length === 0 ? (
        <EmptyState icon={ServerOff} title="No Azure subscriptions found for this account" />
      ) : scope.loading ? (
        <ChartLoadingState label="Generating workload fit charts..." />
      ) : (
        <section aria-label="Workload matching analysis" className="min-w-0 space-y-3">
          {scope.regionOffers.length > 0 && scope.seriesOffers.length === 0 && (
            <EmptyState title="No sizes match the applied requirements" description="Reduce a capability or zone minimum, or reset the workload. Excluded offerings remain visible in the analysis below." />
          )}
          <OfferSummaryChart scope={scope} />
        </section>
      )}
      </PlanningControls>
    </div>
  );
}
