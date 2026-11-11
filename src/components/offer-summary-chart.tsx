import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { EmptyState } from "@/components/states";
import type { CapacityScope } from "@/lib/azure-capacity";
import { summarizeRegionOffers } from "@/lib/capacity-view";

export function OfferSummaryChart({ scope }: { scope: CapacityScope }) {
  const workload = scope.view === "workload";
  const [topN, setTopN] = useState<"10" | "all">("10");
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => summarizeRegionOffers(scope.regionOffers, scope.seriesOffers, scope.regions.data),
    [scope.regionOffers, scope.seriesOffers, scope.regions.data]);
  const shown = topN === "all" ? rows : rows.slice(0, 10);
  const title = workload ? "Requirement matches and exclusions by region" : "Subscription eligibility by region";
  const config: ChartConfig = {
    eligible: { label: workload ? "Matching eligible sizes" : "Eligible sizes", color: "#047857" },
    restricted: { label: workload ? "Matching restricted sizes" : "Restricted sizes", color: "#f59e0b" },
    ...(workload ? { excluded: { label: "Excluded by requirements", color: "#64748b" } } : {}),
  };
  if (!rows.length) return <EmptyState title="No offerings in this region scope" description="Change this tab's region search or the selected VM series." />;
  return (
    <Card className="min-w-0 gap-3 py-4" aria-labelledby={`${scope.view}-chart-title`}>
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle id={`${scope.view}-chart-title`} className="text-sm font-semibold">{title}</CardTitle>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">
              {workload
                ? "Within this tab's region search, separate capability/zone matches from excluded offerings. Matching restricted sizes still cannot be used by this subscription."
                : "All offered sizes in this tab's region search, independent of workload requirements. Eligible means not subscription-restricted, not free capacity."}
              {" "}Counts are SKU-region offerings; quota and allocation are not inferred.
            </p>
          </div>
          <ToggleGroup type="single" variant="outline" size="sm" value={topN}
            onValueChange={(v) => { if (v === "10" || v === "all") setTopN(v); }} aria-label="Chart regions shown">
            <ToggleGroupItem value="10" className="px-2.5 text-xs">Top 10</ToggleGroupItem>
            <ToggleGroupItem value="all" className="px-2.5 text-xs">All {rows.length}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2 px-4">
        <ChartContainer config={config} className="aspect-auto w-full" style={{ height: shown.length * 28 + 70 }} aria-hidden="true">
          <BarChart data={shown} layout="vertical" margin={{ left: 0, right: 12 }} accessibilityLayer={false}>
            <CartesianGrid horizontal={false} />
            <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
            <YAxis type="category" dataKey="name" width={115} tickLine={false} axisLine={false} interval={0} />
            <ChartTooltip cursor={{ fillOpacity: 0.4 }} content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar dataKey="eligible" stackId="offer" fill="var(--color-eligible)" />
            <Bar dataKey="restricted" stackId="offer" fill="var(--color-restricted)" />
            {workload && <Bar dataKey="excluded" stackId="offer" fill="var(--color-excluded)" />}
          </BarChart>
        </ChartContainer>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 px-2 text-xs">
              <ChevronDown className={open ? "size-4 rotate-180" : "size-4"} aria-hidden="true" />
              {open ? "Hide data table" : "Show data table"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="max-h-72 overflow-auto rounded-md border border-border">
              <Table>
                <caption className="sr-only">{title}; all regions in this tab's search, not just the chart's top 10</caption>
                <TableHeader><TableRow>
                  <TableHead>Region</TableHead>
                  <TableHead className="text-right">{workload ? "Matching eligible" : "Eligible"}</TableHead>
                  <TableHead className="text-right">{workload ? "Matching restricted" : "Restricted"}</TableHead>
                  {workload && <TableHead className="text-right">Excluded by requirements</TableHead>}
                </TableRow></TableHeader>
                <TableBody>{rows.map((row) => (
                  <TableRow key={row.region}>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.eligible}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.restricted}</TableCell>
                    {workload && <TableCell className="text-right tabular-nums">{row.excluded}</TableCell>}
                  </TableRow>
                ))}</TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
