import { useMemo, useState } from "react";
import { Cpu, Lock, ServerOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfferSummaryChart } from "@/components/offer-summary-chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ChartLoadingState, ConnectorErrorState, EmptyState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { RefreshControl, ScopeControls } from "@/components/scope-controls";
import { cn } from "@/lib/utils";
import {
  useCapacityScope,
  type FamilyInfo,
  type OfferStatus,
  type RegionInfo,
  type VmOffer,
} from "@/lib/azure-capacity";

// ---------- encodings ----------

const HEAT = [
  { min: 1, max: 1, cls: "bg-[#ebf3fc] text-[#0c3b5e]" },
  { min: 2, max: 3, cls: "bg-[#cfe4fa] text-[#0c3b5e]" },
  { min: 4, max: 5, cls: "bg-[#96c6fa] text-[#0c3b5e]" },
  { min: 6, max: 8, cls: "bg-[#0f6cbd] text-white" },
  { min: 9, max: Infinity, cls: "bg-[#0c3b5e] text-white" },
] as const;

function heatClass(v: number) {
  return (HEAT.find((h) => v >= h.min && v <= h.max) ?? HEAT[HEAT.length - 1]).cls;
}

const RESTRICTED_CELL =
  "bg-amber-100 text-amber-950 bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(180_83_9/0.18)_4px_6px)]";

const STATUS_TONE: Record<OfferStatus, { label: string; dot: string; badge: string }> = {
  available: {
    label: "Available",
    dot: "bg-emerald-600",
    badge: "bg-emerald-50 text-emerald-900 ring-emerald-600/30 dark:bg-emerald-950 dark:text-emerald-100",
  },
  "zone-limited": {
    label: "Some zones restricted",
    dot: "bg-amber-500",
    badge: "bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-100",
  },
  restricted: {
    label: "Not available to subscription",
    dot: "bg-red-600",
    badge: "bg-red-50 text-red-900 ring-red-600/30 dark:bg-red-950 dark:text-red-100",
  },
};

// ---------- aggregation ----------

interface Cell {
  offered: number;
  available: number;
  zones: number;
}

interface RegionRow {
  region: RegionInfo;
  availableSizes: number;
  offeredSizes: number;
  maxZones: number;
  cells: Map<string, Cell>;
}

function buildRows(offers: VmOffer[], regions: Map<string, RegionInfo> | undefined) {
  const rows = new Map<string, RegionRow>();
  for (const o of offers) {
    let row = rows.get(o.region);
    if (!row) {
      row = {
        region: regions?.get(o.region) ?? { name: o.region, displayName: o.region, geography: "Other" },
        availableSizes: 0,
        offeredSizes: 0,
        maxZones: 0,
        cells: new Map(),
      };
      rows.set(o.region, row);
    }
    const cell = row.cells.get(o.family) ?? { offered: 0, available: 0, zones: 0 };
    cell.offered += 1;
    row.offeredSizes += 1;
    if (o.status !== "restricted") {
      cell.available += 1;
      cell.zones = Math.max(cell.zones, o.availableZones.length);
      row.availableSizes += 1;
      row.maxZones = Math.max(row.maxZones, o.availableZones.length);
    }
    row.cells.set(o.family, cell);
  }
  return [...rows.values()];
}

// ---------- page ----------

type Selection = { region: string; family: string | null } | null;

export function HomePage() {
  const scope = useCapacityScope("availability");
  const { regions, capacity, subs, series, seriesOffers } = scope;
  const [view, setView] = useState<"ranked" | "geo">("ranked");
  const query = scope.regionSearch;
  const [selection, setSelection] = useState<Selection>(null);

  const allRows = useMemo(() => buildRows(seriesOffers, regions.data), [seriesOffers, regions.data]);

  const families = useMemo(() => {
    const reach = new Map<string, number>();
    for (const r of allRows)
      for (const [f, c] of r.cells) if (c.available > 0) reach.set(f, (reach.get(f) ?? 0) + 1);
    const ids = new Set(seriesOffers.map((o) => o.family));
    return [...ids]
      .map((id) => capacity.data?.families.get(id) ?? ({ id, label: id, series } as FamilyInfo))
      .sort((a, b) => (reach.get(b.id) ?? 0) - (reach.get(a.id) ?? 0) || a.label.localeCompare(b.label));
  }, [allRows, seriesOffers, capacity.data, series]);

  const rows = useMemo(() => {
    const rank = (a: RegionRow, b: RegionRow) =>
      b.availableSizes - a.availableSizes ||
      b.maxZones - a.maxZones ||
      a.region.displayName.localeCompare(b.region.displayName);
    return view === "ranked"
      ? [...allRows].sort(rank)
      : [...allRows].sort(
          (a, b) => a.region.geography.localeCompare(b.region.geography) || rank(a, b),
        );
  }, [allRows, view]);

  const regionsWithAvailability = allRows.filter((r) => r.availableSizes > 0).length;
  const active: Selection = selection && rows.some((r) => r.region.name === selection.region)
    ? { region: selection.region, family: seriesOffers.some((o) => o.region === selection.region && o.family === selection.family) ? selection.family : null }
    : (rows[0] ? { region: rows[0].region.name, family: null } : null);

  const { error, loading } = scope;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="VM availability" description="Explore offered sizes and subscription restrictions. Workload requirements and quota checks live in Workload fit and do not filter this view." />
      {/* toolbar */}
      <div className="planner-toolbar flex flex-wrap items-end gap-x-4 gap-y-3 border-b border-border px-4 py-4 sm:px-6">
        <ScopeControls scope={scope} onChange={() => setSelection(null)} />

        <div className="flex flex-col gap-1">
          <span id="order-label" className="text-xs font-medium text-muted-foreground">
            Order
          </span>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={view}
            onValueChange={(v) => v && setView(v as "ranked" | "geo")}
            aria-labelledby="order-label"
          >
            <ToggleGroupItem value="ranked" className="h-9 px-3 text-xs">Most available</ToggleGroupItem>
            <ToggleGroupItem value="geo" className="h-9 px-3 text-xs">By geography</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <RefreshControl scope={scope} />
      </div>

      {error ? (
        <ConnectorErrorState
          error={error}
          connector="Azure Resource Manager"
          action={
            <Button variant="outline" onClick={scope.refetchAll}>
              Try again
            </Button>
          }
        />
      ) : subs.data && subs.data.length === 0 ? (
        <EmptyState icon={ServerOff} title="No Azure subscriptions found for this account" />
      ) : loading ? (
        <div className="px-4 py-5 sm:px-6"><ChartLoadingState label="Generating VM availability charts..." /></div>
      ) : (
        <>
        <div className="min-w-0 px-4 pt-4 sm:px-6"><OfferSummaryChart scope={scope} /></div>
        <div className="flex min-h-0 flex-1 flex-col 2xl:flex-row">
          <section
            id="heatmap"
            tabIndex={-1}
            aria-labelledby="heatmap-title"
            className="flex min-w-0 flex-1 flex-col gap-3 px-4 py-4 outline-none sm:px-6"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <div>
                <h2 id="heatmap-title" className="text-lg font-semibold tracking-tight">
                  {series}-series availability by region
                </h2>
                <p id="heatmap-summary" className="text-sm text-muted-foreground">
                  {families.length} {families.length === 1 ? "family" : "families"} · offered in {allRows.length} regions ·
                  sizes available to this subscription in {regionsWithAvailability}
                  {query && ` · showing ${rows.length} matching “${query}”`}
                </p>
              </div>
              <Legend />
            </div>

            {rows.length === 0 ? (
              <EmptyState icon={Cpu} title={query ? `No regions match “${query}”` : `No ${series}-series sizes in this subscription's regions`} />
            ) : (
              <HeatmapTable
                rows={rows}
                families={families}
                grouped={view === "geo"}
                active={active}
                onSelect={setSelection}
              />
            )}
          </section>

          {active && (
            <DetailPane
              selection={active}
              region={allRows.find((r) => r.region.name === active.region)?.region}
              family={active.family ? families.find((f) => f.id === active.family) : undefined}
              offers={seriesOffers.filter(
                (o) => o.region === active.region && (!active.family || o.family === active.family),
              )}
              series={series}
              onClearFamily={() => setSelection({ region: active.region, family: null })}
            />
          )}
        </div>
        </>
      )}
    </div>
  );
}

// ---------- heatmap ----------

function HeatmapTable({
  rows,
  families,
  grouped,
  active,
  onSelect,
}: {
  rows: RegionRow[];
  families: FamilyInfo[];
  grouped: boolean;
  active: Selection;
  onSelect: (s: Selection) => void;
}) {
  const maxTotal = Math.max(1, ...rows.map((r) => r.availableSizes));
  let lastGeo = "";
  return (
    <div className="relative min-h-0 flex-1 overflow-auto rounded-md border border-border lg:max-h-[calc(100vh-13rem)]">
      <table className="border-separate border-spacing-0 text-sm" aria-describedby="heatmap-summary">
        <caption className="sr-only">
          Available VM sizes per region and family. Each cell shows how many sizes of that family are available to the subscription in that region.
        </caption>
        <thead className="sticky top-0 z-20 bg-background">
          <tr>
            <th scope="col" className="sticky left-0 z-30 min-w-44 border-b border-border bg-background px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Region
            </th>
            <th scope="col" className="min-w-36 border-b border-border px-3 py-2 text-left text-xs font-medium text-muted-foreground">
              Available sizes
            </th>
            {families.map((f) => (
              <th
                key={f.id}
                scope="col"
                className="h-36 w-11 min-w-11 border-b border-border px-0 pb-2 align-bottom font-mono text-[11px] font-normal text-foreground"
              >
                <span className="mx-auto block w-4 rotate-180 whitespace-nowrap [writing-mode:vertical-rl]" title={f.id}>
                  {f.label}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => {
            const out = [];
            if (grouped && r.region.geography !== lastGeo) {
              lastGeo = r.region.geography;
              out.push(
                <tr key={`g-${lastGeo}`}>
                  <th
                    scope="colgroup"
                    colSpan={families.length + 2}
                    className="sticky left-0 border-b border-border bg-muted px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-foreground"
                  >
                    {lastGeo}
                  </th>
                </tr>,
              );
            }
            const rowActive = active?.region === r.region.name;
            out.push(
              <tr key={r.region.name} className="group">
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 border-b border-border bg-background p-0 text-left font-normal",
                    rowActive && "bg-muted",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelect({ region: r.region.name, family: null })}
                    aria-pressed={rowActive && !active?.family}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <span className="text-sm font-medium leading-tight">{r.region.displayName}</span>
                    {!grouped && <span className="text-[11px] leading-tight text-muted-foreground">{r.region.geography}</span>}
                  </button>
                </th>
                <td className={cn("border-b border-border px-3 py-1.5", rowActive && "bg-muted")}>
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${(r.availableSizes / maxTotal) * 100}%` }} />
                    </div>
                    <span className="tabular-nums">
                      <span className="font-semibold">{r.availableSizes}</span>
                      <span className="text-muted-foreground">/{r.offeredSizes}</span>
                    </span>
                    {r.maxZones > 0 && (
                      <span className="rounded bg-muted px-1 text-[11px] tabular-nums text-foreground" title="Availability zones">
                        {r.maxZones}AZ
                      </span>
                    )}
                  </div>
                </td>
                {families.map((f) => (
                  <HeatCell
                    key={f.id}
                    cell={r.cells.get(f.id)}
                    region={r.region.displayName}
                    family={f.label}
                    selected={rowActive && active?.family === f.id}
                    onClick={() => onSelect({ region: r.region.name, family: f.id })}
                  />
                ))}
              </tr>,
            );
            return out;
          })}
        </tbody>
      </table>
    </div>
  );
}

function HeatCell({
  cell,
  region,
  family,
  selected,
  onClick,
}: {
  cell: Cell | undefined;
  region: string;
  family: string;
  selected: boolean;
  onClick: () => void;
}) {
  if (!cell) {
    return (
      <td className="border-b border-border p-0.5">
        <div className="flex h-8 items-center justify-center rounded-sm bg-muted/50 text-xs text-muted-foreground">
          <span aria-hidden="true">·</span>
          <span className="sr-only">{family} not offered in {region}</span>
        </div>
      </td>
    );
  }
  const restricted = cell.available === 0;
  const label = restricted
    ? `${region}, ${family}: offered but not available to this subscription`
    : `${region}, ${family}: ${cell.available} of ${cell.offered} sizes available${cell.zones ? `, ${cell.zones} zones` : ""}`;
  return (
    <td className="border-b border-border p-0.5">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selected}
        aria-label={label}
        title={label}
        className={cn(
          "relative flex h-8 w-full items-center justify-center rounded-sm text-xs font-semibold tabular-nums transition-shadow focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring forced-colors:border forced-colors:border-[CanvasText]",
          restricted ? RESTRICTED_CELL : heatClass(cell.available),
          selected && "ring-2 ring-foreground ring-offset-1 ring-offset-background",
        )}
      >
        {restricted ? <Lock className="size-3.5" aria-hidden="true" /> : cell.available}
        {!restricted && cell.zones > 0 && (
          <span className="absolute right-0.5 top-0 text-[9px] font-medium opacity-80" aria-hidden="true">
            {cell.zones}z
          </span>
        )}
      </button>
    </td>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs" aria-label="Legend">
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground">Sizes available</span>
        <div className="flex">
          {HEAT.map((h) => (
            <span key={h.min} className={cn("flex h-5 min-w-7 items-center justify-center px-1 tabular-nums first:rounded-l-sm last:rounded-r-sm", h.cls)}>
              {h.max === Infinity ? `${h.min}+` : h.min === h.max ? h.min : `${h.min}–${h.max}`}
            </span>
          ))}
        </div>
      </div>
      <span className="flex items-center gap-1.5">
        <span className={cn("flex size-5 items-center justify-center rounded-sm", RESTRICTED_CELL)}>
          <Lock className="size-3" aria-hidden="true" />
        </span>
        Restricted for subscription
      </span>
      <span className="flex items-center gap-1.5">
        <span className="flex size-5 items-center justify-center rounded-sm bg-muted/50 text-muted-foreground" aria-hidden="true">·</span>
        Not offered
      </span>
      <span className="flex items-center gap-1.5">
        <span className="font-semibold">3z</span> availability zones
      </span>
    </div>
  );
}

// ---------- detail ----------

function DetailPane({
  selection,
  region,
  family,
  offers,
  series,
  onClearFamily,
}: {
  selection: NonNullable<Selection>;
  region: RegionInfo | undefined;
  family: FamilyInfo | undefined;
  offers: VmOffer[];
  series: string;
  onClearFamily: () => void;
}) {
  const sorted = [...offers].sort(
    (a, b) => a.family.localeCompare(b.family) || (a.vcpus ?? 0) - (b.vcpus ?? 0) || a.size.localeCompare(b.size),
  );
  const available = offers.filter((o) => o.status !== "restricted").length;
  return (
    <aside
      aria-labelledby="detail-title"
      className="flex w-full shrink-0 flex-col border-t border-border bg-card 2xl:w-[25rem] 2xl:border-l 2xl:border-t-0"
    >
      <div className="border-b border-border px-4 py-3">
        <h2 id="detail-title" className="text-base font-semibold">
          {region?.displayName ?? selection.region}
        </h2>
        <p className="text-sm text-muted-foreground">
          {family ? (
            <>
              <span className="font-mono text-foreground">{family.label}</span> ·{" "}
            </>
          ) : (
            `${series}-series · `
          )}
          {available} of {offers.length} sizes available · <span className="font-mono">{selection.region}</span>
        </p>
        {family && (
          <Button variant="link" size="sm" className="h-auto px-0" onClick={onClearFamily}>
            Show all {series}-series sizes in this region
          </Button>
        )}
        <p className="mt-2 text-xs text-muted-foreground">vCPU shows active cores. Subscription eligibility does not establish quota sufficiency or guarantee allocation; use Workload fit for requirements and quota checks.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-auto lg:max-h-[calc(100vh-9.5rem)]">
        <table className="w-full text-sm">
          <caption className="sr-only">VM sizes in {region?.displayName ?? selection.region}</caption>
          <thead className="sticky top-0 bg-card">
            <tr className="text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 text-left font-medium">Size</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">vCPU</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">GPU</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">GiB</th>
              <th scope="col" className="px-4 py-2 text-left font-medium">Zones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((o) => {
              const tone = STATUS_TONE[o.status];
              return (
                <tr key={o.key} className="border-t border-border align-top">
                  <td className="px-4 py-2">
                    <div className="font-mono text-[13px]">{o.size}</div>
                    <span className={cn("mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] ring-1 ring-inset", tone.badge)}>
                      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden="true" />
                      {tone.label}
                      {o.reason && o.status !== "available" ? ` · ${o.reason}` : ""}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">{o.vcpus ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{o.gpus ?? "—"}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{o.memoryGB ?? "—"}</td>
                  <td className="px-4 py-2">
                    {o.zones.length === 0 ? (
                      <span className="text-muted-foreground">Regional</span>
                    ) : (
                      <span className="flex gap-1">
                        {o.zones.map((z) => {
                          const ok = o.availableZones.includes(z);
                          return (
                            <span
                              key={z}
                              className={cn(
                                "flex size-5 items-center justify-center rounded-sm text-[11px] font-semibold",
                                ok ? "bg-emerald-700 text-white" : "bg-muted text-foreground line-through",
                              )}
                              aria-label={`Zone ${z} ${ok ? "available" : "restricted"}`}
                            >
                              {z}
                            </span>
                          );
                        })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
