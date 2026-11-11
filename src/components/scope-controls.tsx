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

// Subscription + VM series pickers shared by every page.
export function ScopeControls({ scope, onChange }: { scope: CapacityScope; onChange?: () => void }) {
  const { subs, subId, setSubId, series, setSeries, seriesStats } = scope;
  return (
    <>
      <div className="flex flex-col gap-1">
        <label htmlFor="region-q" className="text-xs font-medium text-muted-foreground">
          {scope.view === "availability" ? "Availability region filter" : "Workload region filter"}
        </label>
        <Input id="region-q" className="w-48" value={scope.regionSearch}
          onChange={(e) => { scope.setRegionSearch(e.target.value); onChange?.(); }} placeholder="e.g. UAE, Europe" />
      </div>
      <div className="flex min-w-56 flex-col gap-1">
        <label htmlFor="sub" className="text-xs font-medium text-muted-foreground">
          {scope.subscriptionLocked ? "Subscription (configured)" : "Subscription"}
        </label>
        <Select
          value={subId}
          onValueChange={(v) => { setSubId(v); onChange?.(); }}
          disabled={scope.subscriptionLocked || !subs.data?.length}
        >
          <SelectTrigger id="sub" className="w-64">
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

      <div className="flex flex-col gap-1">
        <label htmlFor="series" className="text-xs font-medium text-muted-foreground">
          VM series
        </label>
        <Select
          value={seriesStats.some((s) => s.id === series) ? series : undefined}
          onValueChange={(v) => { setSeries(v); onChange?.(); }}
          disabled={!seriesStats.length}
        >
          <SelectTrigger id="series" className="w-60">
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
    <div className="ml-auto flex items-center gap-2">
      {capacity.data && (
        <span className="text-xs text-muted-foreground">
          Fetched {capacity.data.fetchedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      )}
      <Button variant="outline" className="h-9" onClick={scope.refetchAll} disabled={capacity.isFetching || !subId}>
        <RefreshCw className={cn("size-4", capacity.isFetching && "animate-spin")} aria-hidden="true" />
        Refresh
      </Button>
    </div>
  );
}
