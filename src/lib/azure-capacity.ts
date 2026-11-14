import { useEffect, useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { cpuCounts, parseQuota, type QuotaSnapshot } from "./workload-planning";
import { selectCapacityOffers, type CapacityView } from "./capacity-view";
import { useAppStore } from "@/lib/store";
import { readArmList } from "./arm-client";
import { useArmReadContext, type ArmReadContext } from "./azure-session";
import { selectedSubscription } from "./subscription-scope";
import { DASHBOARD_QUERY_CACHE } from "./query-client";
import type { ArmReadMetadata } from "./arm-http";

export interface SubscriptionOption {
  id: string;
  name: string;
  state: string;
}

export interface RegionInfo {
  name: string; // e.g. "eastus"
  displayName: string; // e.g. "East US"
  geography: string; // e.g. "US", "Europe"
}

export type OfferStatus = "available" | "zone-limited" | "restricted";

export interface VmOffer {
  key: string; // `${sku}|${region}`
  sku: string; // Standard_NC24ads_A100_v4
  size: string; // NC24ads_A100_v4
  series: string; // NC
  family: string; // standardNCADSA100v4Family
  region: string; // lower-case region name
  vcpus: number | null;
  quotaVcpus: number | null;
  gpus: number | null;
  memoryGB: number | null;
  zones: string[]; // zones the SKU is offered in
  availableZones: string[]; // zones not restricted for this subscription
  status: OfferStatus;
  reason: string | null; // restriction reason code, if any
}

export interface FamilyInfo {
  id: string;
  label: string;
  series: string;
}

export interface CapacityData {
  offers: VmOffer[];
  families: Map<string, FamilyInfo>;
  fetchedAt: Date;
  cached: boolean;
}

// ---------- adapters (narrow the broad ARM types at one boundary) ----------

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | null {
  if (v == null || (typeof v === "string" && !v.trim())) return null;
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export function seriesOf(size: string): string {
  const m = size.match(/^[A-Z]+/);
  return m ? m[0] : "Other";
}

function sizeTemplate(size: string): string {
  // NC24ads_A100_v4 -> NCads_A100_v4 ; M64-32ms -> Mms
  return size.replace(/^([A-Z]+)\d+(-\d+)?/, "$1");
}

// ---------- live reads ----------

async function fetchSubscriptions(context: ArmReadContext, signal: AbortSignal): Promise<SubscriptionOption[]> {
  const data = await readArmList({ kind: "subscriptions" }, context, signal);
  return data
    .map((raw) => {
      const s = raw as Record<string, unknown>;
      const id = str(s.subscriptionId)?.toLowerCase() ?? "";
      return { id, name: str(s.displayName) ?? id, state: str(s.state) ?? "Unknown" };
    })
    .filter((s) => s.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchRegions(subscriptionId: string, context: ArmReadContext, signal: AbortSignal): Promise<Map<string, RegionInfo>> {
  const data = await readArmList({ kind: "regions", subscriptionId }, context, signal);
  const map = new Map<string, RegionInfo>();
  for (const raw of data) {
    const l = raw as Record<string, unknown>;
    const name = str(l.name)?.toLowerCase();
    if (!name) continue;
    const meta = (l.metadata ?? {}) as Record<string, unknown>;
    map.set(name, {
      name,
      displayName: str(l.displayName) ?? name,
      geography: str(meta.geographyGroup) ?? "Other",
    });
  }
  return map;
}

async function fetchCapacity(subscriptionId: string, context: ArmReadContext, signal: AbortSignal): Promise<CapacityData> {
  let metadata: ArmReadMetadata | undefined;
  const data = await readArmList({ kind: "skus", subscriptionId }, context, signal, (result) => { metadata = result; });

  const offers: VmOffer[] = [];
  const familySizes = new Map<string, { series: string; templates: Map<string, number> }>();

  for (const raw of data) {
    const s = raw as Record<string, unknown>;
    if (str(s.resourceType) !== "virtualMachines") continue;
    const sku = str(s.name);
    if (!sku) continue;
    const size = str(s.size) ?? sku.replace(/^(Standard|Basic)_/, "");
    const family = str(s.family) ?? "unknown";
    const series = seriesOf(size);

    const caps = new Map<string, string>();
    if (Array.isArray(s.capabilities)) {
      for (const c of s.capabilities as Record<string, unknown>[]) {
        const n = str(c.name);
        const v = str(c.value);
        if (n && v !== undefined) caps.set(n, v);
      }
    }

    // restrictions apply per location (whole region) or per zone
    const restrictedRegions = new Map<string, string>();
    const restrictedZones = new Map<string, { zones: Set<string>; reason: string }>();
    if (Array.isArray(s.restrictions)) {
      for (const r of s.restrictions as Record<string, unknown>[]) {
        const type = str(r.type);
        const reason = str(r.reasonCode) ?? "Restricted";
        const info = (r.restrictionInfo ?? {}) as Record<string, unknown>;
        const locs = strArray(info.locations).length
          ? strArray(info.locations)
          : strArray(r.values);
        for (const loc of locs.map((x) => x.toLowerCase())) {
          if (type === "Location") restrictedRegions.set(loc, reason);
          else if (type === "Zone") {
            const entry = restrictedZones.get(loc) ?? { zones: new Set<string>(), reason };
            strArray(info.zones).forEach((z) => entry.zones.add(z));
            restrictedZones.set(loc, entry);
          }
        }
      }
    }

    const infos = Array.isArray(s.locationInfo)
      ? (s.locationInfo as Record<string, unknown>[])
      : strArray(s.locations).map((location) => ({ location }) as Record<string, unknown>);

    for (const li of infos) {
      const region = str(li.location)?.toLowerCase();
      if (!region) continue;
      const zones = [...new Set(strArray(li.zones))].sort();
      const zoneBlock = restrictedZones.get(region);
      const regionReason = restrictedRegions.get(region);
      const availableZones = regionReason
        ? []
        : zones.filter((z) => !zoneBlock?.zones.has(z));
      const status: OfferStatus = regionReason
        ? "restricted"
        : zoneBlock && zones.length > 0 && availableZones.length < zones.length
          ? "zone-limited"
          : "available";
      offers.push({
        key: `${sku}|${region}`,
        sku,
        size,
        series,
        family,
        region,
        ...cpuCounts(caps, size),
        gpus: num(caps.get("GPUs")),
        memoryGB: num(caps.get("MemoryGB")),
        zones,
        availableZones,
        status,
        reason: regionReason ?? (status === "zone-limited" ? zoneBlock?.reason ?? null : null),
      });
    }

    const fam = familySizes.get(family) ?? { series, templates: new Map<string, number>() };
    const t = sizeTemplate(size);
    fam.templates.set(t, (fam.templates.get(t) ?? 0) + 1);
    familySizes.set(family, fam);
  }

  const families = new Map<string, FamilyInfo>();
  for (const [id, f] of familySizes) {
    const label = [...f.templates.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? id;
    families.set(id, { id, label, series: f.series });
  }

  return { offers, families, fetchedAt: metadata?.fetchedAt ?? new Date(), cached: metadata?.cached ?? false };
}

// ---------- hooks ----------

export function useSubscriptions(context: ArmReadContext) {
  return useQuery({
    queryKey: ["arm", context.cacheKey, "subscriptions"],
    queryFn: ({ signal }) => fetchSubscriptions(context, signal),
    ...DASHBOARD_QUERY_CACHE,
    enabled: context.enabled,
    retry: false,
  });
}

export function useRegions(subscriptionId: string | undefined, context: ArmReadContext) {
  return useQuery({
    queryKey: ["arm", context.cacheKey, "regions", subscriptionId],
    queryFn: ({ signal }) => fetchRegions(subscriptionId!, context, signal),
    ...DASHBOARD_QUERY_CACHE,
    enabled: context.enabled && !!subscriptionId,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
    retry: false,
  });
}

export function useCapacity(subscriptionId: string | undefined, context: ArmReadContext) {
  return useQuery({
    queryKey: ["arm", context.cacheKey, "skus", subscriptionId],
    queryFn: ({ signal }) => fetchCapacity(subscriptionId!, context, signal),
    ...DASHBOARD_QUERY_CACHE,
    staleTime: (query) => {
      const data = query.state.data;
      const ageAtRead = data ? Math.max(0, query.state.dataUpdatedAt - data.fetchedAt.getTime()) : 0;
      return Math.max(0, DASHBOARD_QUERY_CACHE.staleTime - ageAtRead);
    },
    enabled: context.enabled && !!subscriptionId,
    retry: false,
  });
}

// ---------- shared scope (subscription + series) for every page ----------

export interface SeriesStat {
  id: string;
  families: number;
  gpu: boolean;
}

export function useCapacityScope(view: CapacityView, options: { includeQuota?: boolean } = {}) {
  const context = useArmReadContext();
  const regionSearch = useAppStore((s) => s.regionSearch);
  const setRegionSearch = useAppStore((s) => s.setRegionSearch);
  const availabilityRegionSearch = useAppStore((s) => s.availabilityRegionSearch);
  const setAvailabilityRegionSearch = useAppStore((s) => s.setAvailabilityRegionSearch);
  const workload = useAppStore((s) => s.workload);
  const setWorkload = useAppStore((s) => s.setWorkload);
  const comparisonRegions = useAppStore((s) => s.comparisonRegions);
  const setComparisonRegions = useAppStore((s) => s.setComparisonRegions);
  const storedSubId = useAppStore((s) => s.subscriptionId);
  const series = useAppStore((s) => s.series);
  const setSubId = useAppStore((s) => s.setSubscriptionId);
  const setSeries = useAppStore((s) => s.setSeries);

  const subs = useSubscriptions(context);
  const subId = selectedSubscription(context.subscriptionScope, storedSubId, subs.data);
  const regions = useRegions(subId, context);
  const capacity = useCapacity(subId, context);

  useEffect(() => {
    if (subId && subId !== storedSubId) setSubId(subId);
  }, [subId, storedSubId, setSubId]);

  const seriesStats = useMemo<SeriesStat[]>(() => {
    const m = new Map<string, { families: Set<string>; gpu: boolean }>();
    for (const o of capacity.data?.offers ?? []) {
      const s = m.get(o.series) ?? { families: new Set<string>(), gpu: false };
      s.families.add(o.family);
      if ((o.gpus ?? 0) > 0) s.gpu = true;
      m.set(o.series, s);
    }
    return [...m.entries()]
      .map(([id, s]) => ({ id, families: s.families.size, gpu: s.gpu }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [capacity.data]);

  useEffect(() => {
    if (seriesStats.length && !seriesStats.some((s) => s.id === series)) {
      setSeries((seriesStats.find((s) => s.gpu) ?? seriesStats[0]).id);
    }
  }, [seriesStats, series, setSeries]);

  const selected = useMemo(
    () => selectCapacityOffers(capacity.data?.offers ?? [], series, regions.data, view,
      { availabilityRegionSearch, regionSearch, workload }),
    [capacity.data, series, regions.data, view, availabilityRegionSearch, regionSearch, workload],
  );
  const activeComparisonRegions = view === "workload" && options.includeQuota !== false ? comparisonRegions : [];
  const quotaQueries = useQueries({
    queries: activeComparisonRegions.map((region) => ({
      queryKey: ["arm", context.cacheKey, "quota", subId, region],
      queryFn: async ({ signal }: { signal: AbortSignal }) => {
        const data = await readArmList({ kind: "quota", subscriptionId: subId!, region }, context, signal);
        return parseQuota({ value: data });
      },
      ...DASHBOARD_QUERY_CACHE,
      enabled: context.enabled && !!subId,
      staleTime: 5 * 60_000,
      gcTime: 60 * 60_000,
      retry: false,
      retryOnMount: false,
    })),
  });
  const quotas = new Map<string, QuotaSnapshot>(activeComparisonRegions.map((region, i) => {
    const query = quotaQueries[i];
    return [region, {
      state: query.isError ? "error" : query.isFetching || query.isPending ? "loading" : "ready",
      data: query.isError || query.isFetching ? undefined : query.data,
    }];
  }));

  return {
    view, workload, setWorkload, comparisonRegions, setComparisonRegions, ...selected, quotas, quotaQueries,
    setRegionSearch: view === "availability" ? setAvailabilityRegionSearch : setRegionSearch,
    subs,
    regions,
    capacity,
    subId,
    subscriptionLocked: context.subscriptionScope !== null,
    setSubId,
    series,
    setSeries,
    seriesStats,
    error: subs.error ?? regions.error ?? capacity.error,
    loading: subs.isPending || (!!subId && (capacity.isPending || regions.isPending)),
    refreshing: subs.isFetching || regions.isFetching || capacity.isFetching || quotaQueries.some((query) => query.isFetching),
    refetchAll: () => {
      if (!context.enabled) return;
      void subs.refetch();
      if (subId) {
        void regions.refetch();
        void capacity.refetch();
      }
      quotaQueries.forEach((q) => { void q.refetch(); });
    },
  };
}

export type CapacityScope = ReturnType<typeof useCapacityScope>;
