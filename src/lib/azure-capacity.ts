import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAppStore } from "@/lib/store";
import { AzureResourceManagerService } from "../../generated";

// ARM API versions used for the three live reads.
const SUBSCRIPTIONS_API = "2022-12-01";
const LOCATIONS_API = "2022-12-01";
const SKUS_API = "2021-07-01";

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
}

// ---------- adapters (narrow the broad ARM types at one boundary) ----------

function listFrom(data: unknown, what: string): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object" && Array.isArray((data as { value?: unknown }).value)) {
    return (data as { value: unknown[] }).value;
  }
  throw new Error(`Unexpected ${what} response shape`);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
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

async function fetchSubscriptions(): Promise<SubscriptionOption[]> {
  const result = await AzureResourceManagerService.Subscriptions_List(SUBSCRIPTIONS_API);
  if (!result.success) throw result.error;
  return listFrom(result.data, "subscriptions")
    .map((raw) => {
      const s = raw as Record<string, unknown>;
      const id = str(s.subscriptionId) ?? "";
      return { id, name: str(s.displayName) ?? id, state: str(s.state) ?? "Unknown" };
    })
    .filter((s) => s.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchRegions(subscriptionId: string): Promise<Map<string, RegionInfo>> {
  const result = await AzureResourceManagerService.Subscriptions_ListLocations(
    subscriptionId,
    LOCATIONS_API,
  );
  if (!result.success) throw result.error;
  const map = new Map<string, RegionInfo>();
  for (const raw of listFrom(result.data, "locations")) {
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

async function fetchCapacity(subscriptionId: string): Promise<CapacityData> {
  const result = await AzureResourceManagerService.Provider_Resources_GetById(
    subscriptionId,
    "Microsoft.Compute",
    "skus",
    SKUS_API,
  );
  if (!result.success) throw result.error;

  const offers: VmOffer[] = [];
  const familySizes = new Map<string, { series: string; templates: Map<string, number> }>();

  for (const raw of listFrom(result.data, "resource SKUs")) {
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
      const zones = strArray(li.zones).sort();
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
        vcpus: num(caps.get("vCPUs")),
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

  return { offers, families, fetchedAt: new Date() };
}

// ---------- hooks ----------

export function useSubscriptions() {
  return useQuery({ queryKey: ["arm", "subscriptions"], queryFn: fetchSubscriptions, staleTime: 10 * 60_000 });
}

export function useRegions(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: ["arm", "regions", subscriptionId],
    queryFn: () => fetchRegions(subscriptionId!),
    enabled: !!subscriptionId,
    staleTime: 60 * 60_000,
  });
}

export function useCapacity(subscriptionId: string | undefined) {
  return useQuery({
    queryKey: ["arm", "skus", subscriptionId],
    queryFn: () => fetchCapacity(subscriptionId!),
    enabled: !!subscriptionId,
    staleTime: 5 * 60_000,
  });
}

// ---------- shared scope (subscription + series) for every page ----------

export interface SeriesStat {
  id: string;
  families: number;
  gpu: boolean;
}

export function useCapacityScope() {
  const subId = useAppStore((s) => s.subscriptionId);
  const series = useAppStore((s) => s.series);
  const setSubId = useAppStore((s) => s.setSubscriptionId);
  const setSeries = useAppStore((s) => s.setSeries);

  const subs = useSubscriptions();
  const regions = useRegions(subId);
  const capacity = useCapacity(subId);

  useEffect(() => {
    if (!subId && subs.data?.length) {
      setSubId((subs.data.find((s) => s.state === "Enabled") ?? subs.data[0]).id);
    }
  }, [subs.data, subId, setSubId]);

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

  const seriesOffers = useMemo(
    () => (capacity.data?.offers ?? []).filter((o) => o.series === series),
    [capacity.data, series],
  );

  return {
    subs,
    regions,
    capacity,
    subId,
    setSubId,
    series,
    setSeries,
    seriesStats,
    seriesOffers,
    error: subs.error ?? regions.error ?? capacity.error,
    loading: subs.isPending || (!!subId && capacity.isPending),
    refetchAll: () => {
      void subs.refetch();
      void regions.refetch();
      void capacity.refetch();
    },
  };
}

export type CapacityScope = ReturnType<typeof useCapacityScope>;
