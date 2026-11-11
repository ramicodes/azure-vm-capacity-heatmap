import type { RegionInfo, VmOffer } from "./azure-capacity";
import { fitReasons, type Workload } from "./workload-planning.ts";

export type CapacityView = "availability" | "workload";

export function selectCapacityOffers(
  offers: readonly VmOffer[],
  series: string,
  regions: ReadonlyMap<string, RegionInfo> | undefined,
  view: CapacityView,
  filters: { availabilityRegionSearch: string; regionSearch: string; workload: Workload },
) {
  const regionSearch = view === "availability" ? filters.availabilityRegionSearch : filters.regionSearch;
  const search = regionSearch.trim().toLowerCase();
  const unfilteredOffers = offers.filter((o) => o.series === series);
  const regionOffers = unfilteredOffers.filter((o) => {
    const region = regions?.get(o.region);
    return `${o.region} ${region?.displayName ?? ""} ${region?.geography ?? ""}`.toLowerCase().includes(search);
  });
  const seriesOffers = view === "workload"
    ? regionOffers.filter((o) => fitReasons(o, filters.workload).length === 0)
    : regionOffers;
  return { unfilteredOffers, regionOffers, seriesOffers, regionSearch };
}

export function summarizeRegionOffers(
  offers: readonly VmOffer[],
  matching: readonly VmOffer[],
  regions: ReadonlyMap<string, RegionInfo> | undefined,
) {
  const matches = new Set(matching.map((o) => o.key));
  const rows = new Map<string, { region: string; name: string; eligible: number; restricted: number; excluded: number }>();
  for (const offer of offers) {
    const row = rows.get(offer.region) ?? {
      region: offer.region, name: regions?.get(offer.region)?.displayName ?? offer.region,
      eligible: 0, restricted: 0, excluded: 0,
    };
    if (!matches.has(offer.key)) row.excluded++;
    else if (offer.status === "restricted") row.restricted++;
    else row.eligible++;
    rows.set(offer.region, row);
  }
  return [...rows.values()].sort((a, b) => b.eligible - a.eligible || b.restricted - a.restricted || a.name.localeCompare(b.name));
}
