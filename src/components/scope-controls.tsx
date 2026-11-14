import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { CapacityScope } from "@/lib/azure-capacity";
import { azureEnvironment } from "@/lib/azure-session";

// Subscription + VM series pickers shared by every page.
export function ScopeControls({ scope, onChange }: { scope: CapacityScope; onChange?: () => void }) {
  const { subs, subId, setSubId, series, setSeries, seriesStats } = scope;
  return (
    <>
      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
        <label htmlFor="sub" className="text-xs font-medium text-muted-foreground">
          {scope.subscriptionLocked ? "Subscription (configured)" : "Subscription"}
        </label>
        <Select
          value={subId}
          onValueChange={(v) => { setSubId(v); onChange?.(); }}
          disabled={scope.subscriptionLocked || !subs.data?.length}
        >
          <SelectTrigger id="sub" className="w-full sm:w-64">
            <SelectValue placeholder={subs.isPending ? "Loading…" : "Select subscription"} />
          </SelectTrigger>
          <SelectContent>
            {subs.data?.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
        <label htmlFor="region-q" className="text-xs font-medium text-muted-foreground">
          {scope.view === "availability" ? "Availability region filter" : "Workload region filter"}
        </label>
        <Input id="region-q" className="w-full sm:w-48" value={scope.regionSearch}
          onChange={(e) => { scope.setRegionSearch(e.target.value); onChange?.(); }} placeholder="e.g. UAE, Europe" />
      </div>

      <div className="flex w-full min-w-0 flex-col gap-1 sm:w-auto">
        <label htmlFor="series" className="text-xs font-medium text-muted-foreground">
          VM series
        </label>
        <Select
          value={seriesStats.some((s) => s.id === series) ? series : undefined}
          onValueChange={(v) => { setSeries(v); onChange?.(); }}
          disabled={!seriesStats.length}
        >
          <SelectTrigger id="series" className="w-full sm:w-60">
            <SelectValue placeholder="Series" />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {seriesStats.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.id}-series · {s.families} {s.families === 1 ? "family" : "families"}
                {s.gpu ? " · GPU" : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {seriesStats.some((s) => s.gpu) && (
        <div className="flex flex-col gap-1">
          <span id="gpu-label" className="text-xs font-medium text-muted-foreground">
            GPU series
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={series}
            onValueChange={(v) => { if (v) { setSeries(v); onChange?.(); } }}
            aria-labelledby="gpu-label"
            className="flex-wrap justify-start"
          >
            {seriesStats.filter((s) => s.gpu).map((s) => (
              <ToggleGroupItem key={s.id} value={s.id} className="h-9 px-3 font-mono text-xs">
                {s.id}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
    </>
  );
}

export function RefreshControl({ scope }: { scope: CapacityScope }) {
  const { capacity, subId } = scope;
  return (
    <div className="flex w-full flex-wrap items-center gap-3 sm:ml-auto sm:w-auto">
      {capacity.data && (
        <span className="text-xs text-muted-foreground">
          {capacity.data.cached && `${azureEnvironment.mode === "hosted" ? "Server cache" : "Local cache"} · `}
          Fetched {capacity.data.fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
      <Button variant="outline" className="h-9" onClick={scope.refetchAll} disabled={scope.refreshing || !subId}>
        <RefreshCw className={cn("size-4", scope.refreshing && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        {scope.refreshing ? "Refreshing data..." : "Refresh data"}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {scope.refreshing ? "Reading Azure data. Existing results remain visible during refresh." : ""}
      </span>
    </div>
  );
}
