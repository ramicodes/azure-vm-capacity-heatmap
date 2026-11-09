import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown, ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConnectorErrorState, EmptyState } from "@/components/states";
import { RefreshControl, ScopeControls } from "@/components/scope-controls";
import { useCapacityScope } from "@/lib/azure-capacity";

// emerald-700 / amber-500 — same encoding as the heatmap (available vs restricted)
const AVAILABLE = "#047857";
const RESTRICTED = "#f59e0b";

const sizesConfig = {
  available: { label: "Available sizes", color: AVAILABLE },
  restricted: { label: "Restricted sizes", color: RESTRICTED },
} satisfies ChartConfig;

const reachConfig = {
  available: { label: "Regions available", color: AVAILABLE },
  restricted: { label: "Regions restricted", color: RESTRICTED },
} satisfies ChartConfig;

const zonesConfig = {
  regions: { label: "Regions", color: AVAILABLE },
} satisfies ChartConfig;

export function ChartsPage() {
  const scope = useCapacityScope();
  const { series, seriesOffers, regions, capacity } = scope;
  const [topN, setTopN] = useState<"10" | "15" | "all">("15");

  const regionStats = useMemo(() => {
    const m = new Map<string, { region: string; name: string; geography: string; available: number; restricted: number; zones: number }>();
    for (const o of seriesOffers) {
      const info = regions.data?.get(o.region);
      const r = m.get(o.region) ?? {
        region: o.region,
        name: info?.displayName ?? o.region,
        geography: info?.geography ?? "Other",
        available: 0,
        restricted: 0,
        zones: 0,
      };
      if (o.status === "restricted") r.restricted += 1;
      else {
        r.available += 1;
        r.zones = Math.max(r.zones, o.availableZones.length);
      }
      m.set(o.region, r);
    }
    return [...m.values()].sort((a, b) => b.available - a.available || a.restricted - b.restricted || a.name.localeCompare(b.name));
  }, [seriesOffers, regions.data]);

  const familyStats = useMemo(() => {
    const m = new Map<string, { available: Set<string>; restrictedOnly: Set<string>; offered: Set<string> }>();
    for (const o of seriesOffers) {
      const f = m.get(o.family) ?? { available: new Set<string>(), restrictedOnly: new Set<string>(), offered: new Set<string>() };
      f.offered.add(o.region);
      if (o.status !== "restricted") f.available.add(o.region);
      m.set(o.family, f);
    }
    return [...m.entries()]
      .map(([id, f]) => {
        const restricted = [...f.offered].filter((r) => !f.available.has(r)).length;
        return {
          id,
          label: capacity.data?.families.get(id)?.label ?? id,
          available: f.available.size,
          restricted,
        };
      })
      .sort((a, b) => b.available - a.available || a.label.localeCompare(b.label));
  }, [seriesOffers, capacity.data]);

  const zoneStats = useMemo(() => {
    const buckets = [0, 1, 2, 3].map((z) => ({ zones: z, label: z === 0 ? "No zones" : `${z} zone${z > 1 ? "s" : ""}`, regions: 0, names: [] as string[] }));
    for (const r of regionStats) {
      if (r.available === 0) continue;
      const b = buckets[Math.min(r.zones, 3)];
      b.regions += 1;
      b.names.push(r.name);
    }
    return buckets;
  }, [regionStats]);

  const shownRegions = topN === "all" ? regionStats : regionStats.slice(0, Number(topN));
  const withAvailability = regionStats.filter((r) => r.available > 0);
  const top = regionStats[0];
  const noneCount = regionStats.length - withAvailability.length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-3 sm:px-6">
        <ScopeControls scope={scope} />
        <RefreshControl scope={scope} />
      </div>

      {scope.error ? (
        <ConnectorErrorState
          error={scope.error}
          connector="Azure Resource Manager"
          action={<Button variant="outline" onClick={scope.refetchAll}>Try again</Button>}
        />
      ) : scope.subs.data && scope.subs.data.length === 0 ? (
        <EmptyState icon={ServerOff} title="No Azure subscriptions found for this account" />
      ) : scope.loading ? (
        <ChartsSkeleton />
      ) : regionStats.length === 0 ? (
        <EmptyState icon={ServerOff} title={`No ${series}-series sizes in this subscription's regions`} />
      ) : (
        <section id="heatmap" tabIndex={-1} aria-labelledby="charts-title" className="flex flex-col gap-4 px-4 py-4 outline-none sm:px-6">
          <h1 id="charts-title" className="text-lg font-semibold tracking-tight">
            {series}-series capacity charts
          </h1>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            {/* Top regions */}
            <ChartCard
              id="top-regions"
              title="Regions with the most available sizes"
              summary={
                top && top.available > 0
                  ? `${top.name} leads with ${top.available} available ${series}-series sizes. ${withAvailability.length} of ${regionStats.length} regions have at least one size available${noneCount ? `; ${noneCount} have none` : ""}.`
                  : `No ${series}-series sizes are available to this subscription in any region.`
              }
              action={
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  value={topN}
                  onValueChange={(v) => v && setTopN(v as typeof topN)}
                  aria-label="Regions shown"
                >
                  <ToggleGroupItem value="10" className="px-2.5 text-xs">Top 10</ToggleGroupItem>
                  <ToggleGroupItem value="15" className="px-2.5 text-xs">Top 15</ToggleGroupItem>
                  <ToggleGroupItem value="all" className="px-2.5 text-xs">All {regionStats.length}</ToggleGroupItem>
                </ToggleGroup>
              }
              table={
                <DataTable
                  head={["Region", "Geography", "Available", "Restricted", "Zones"]}
                  rows={regionStats.map((r) => [r.name, r.geography, r.available, r.restricted, r.zones || "—"])}
                />
              }
            >
              <ChartContainer config={sizesConfig} className="aspect-auto w-full" style={{ height: shownRegions.length * 30 + 60 }} aria-hidden="true">
                <BarChart data={shownRegions} layout="vertical" margin={{ left: 8, right: 16 }} accessibilityLayer={false}>
                  <CartesianGrid horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="name" width={130} tickLine={false} axisLine={false} interval={0} />
                  <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="available" stackId="s" fill="var(--color-available)" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="restricted" stackId="s" fill="var(--color-restricted)" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ChartContainer>
            </ChartCard>

            <div className="flex flex-col gap-4">
              {/* Family reach */}
              <ChartCard
                id="family-reach"
                title="Family reach across regions"
                summary={
                  familyStats[0]
                    ? `${familyStats[0].label} is available in the most regions (${familyStats[0].available}).${
                        familyStats.length > 1
                          ? ` ${familyStats[familyStats.length - 1].label} is available in the fewest (${familyStats[familyStats.length - 1].available}).`
                          : ""
                      }`
                    : ""
                }
                table={
                  <DataTable
                    head={["Family", "Regions available", "Regions restricted"]}
                    rows={familyStats.map((f) => [f.label, f.available, f.restricted])}
                  />
                }
              >
                <ChartContainer config={reachConfig} className="aspect-auto w-full" style={{ height: familyStats.length * 30 + 60 }} aria-hidden="true">
                  <BarChart data={familyStats} layout="vertical" margin={{ left: 8, right: 16 }} accessibilityLayer={false}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                    <YAxis type="category" dataKey="label" width={130} tickLine={false} axisLine={false} interval={0} tick={{ fontFamily: "ui-monospace, monospace", fontSize: 11 }} />
                    <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="available" stackId="f" fill="var(--color-available)" />
                    <Bar dataKey="restricted" stackId="f" fill="var(--color-restricted)" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ChartContainer>
              </ChartCard>

              {/* Zone coverage */}
              <ChartCard
                id="zone-coverage"
                title="Availability-zone coverage"
                summary={`Of the ${withAvailability.length} regions with ${series}-series sizes available, ${zoneStats[3].regions} offer them in 3 zones and ${zoneStats[0].regions} have no zone support.`}
                table={
                  <DataTable
                    head={["Usable zones", "Regions", "Region names"]}
                    rows={zoneStats.map((z) => [z.label, z.regions, z.names.join(", ") || "—"])}
                  />
                }
              >
                <ChartContainer config={zonesConfig} className="aspect-auto h-52 w-full" aria-hidden="true">
                  <BarChart data={zoneStats} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer={false}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={28} />
                    <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent hideLabel={false} />} />
                    <Bar dataKey="regions" fill="var(--color-regions)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </ChartCard>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function ChartCard({
  id,
  title,
  summary,
  action,
  table,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  action?: ReactNode;
  table: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="gap-3 py-4" aria-labelledby={`${id}-title`}>
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle id={`${id}-title`} className="text-sm font-semibold">
              {title}
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 px-4">
        {children}
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" aria-expanded={open}>
              <ChevronDown className={open ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"} aria-hidden="true" />
              {open ? "Hide data table" : "Show data table"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>{table}</CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            {head.map((h, i) => (
              <TableHead key={h} className={i > 0 && typeof rows[0]?.[i] === "number" ? "text-right" : undefined}>
                {h}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={String(r[0])}>
              {r.map((c, i) => (
                <TableCell key={i} className={typeof c === "number" ? "text-right tabular-nums" : "whitespace-normal"}>
                  {c}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ChartsSkeleton() {
  return (
    <div role="status" aria-label="Loading charts" className="grid gap-4 px-4 py-4 sm:px-6 xl:grid-cols-[1.3fr_1fr]">
      <Skeleton className="h-[28rem] w-full rounded-xl" />
      <div className="flex flex-col gap-4">
        <Skeleton className="h-56 w-full rounded-xl" />
        <Skeleton className="h-56 w-full rounded-xl" />
      </div>
    </div>
  );
}
