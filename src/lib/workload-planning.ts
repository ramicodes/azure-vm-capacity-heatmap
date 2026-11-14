import type { VmOffer } from "./azure-capacity";

export interface Workload {
  count: number;
  minVcpus: number;
  minMemoryGB: number;
  minGpus: number;
  minZones: number;
}

export const DEFAULT_WORKLOAD: Workload = {
  count: 1, minVcpus: 0, minMemoryGB: 0, minGpus: 0, minZones: 0,
};

export function cpuCounts(capabilities: ReadonlyMap<string, string>, size: string) {
  function positive(value: string | undefined) {
    if (!value?.trim()) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  const quotaVcpus = positive(capabilities.get("vCPUs"));
  const constrained = /^[A-Z]+\d+-\d+/.test(size);
  const vcpus = capabilities.has("vCPUsAvailable")
    ? positive(capabilities.get("vCPUsAvailable"))
    : constrained ? null : quotaVcpus;
  return { vcpus, quotaVcpus };
}

export function workloadValue(key: keyof Workload, text: string): number | null {
  if (!text.trim()) return null;
  const value = Number(text);
  const max = key === "count" ? 10000 : key === "minZones" ? 3 : 1000000;
  return Number.isFinite(value) && value >= (key === "count" ? 1 : 0) &&
    value <= max && (key === "minMemoryGB" || Number.isInteger(value)) ? value : null;
}

export function fitReasons(offer: VmOffer, workload: Workload): string[] {
  const reasons: string[] = [];
  for (const [value, minimum, label] of [
    [offer.vcpus, workload.minVcpus, "per-VM vCPUs"],
    [offer.memoryGB, workload.minMemoryGB, "per-VM RAM (GiB)"],
    [offer.gpus, workload.minGpus, "per-VM GPUs"],
  ] as const) {
    if (minimum > 0 && (value === null || value < minimum)) {
      reasons.push(`${label}: ${value === null ? "unknown" : value}, needs ${minimum}`);
    }
  }
  const zoneCount = new Set(offer.availableZones).size;
  if (workload.minZones > zoneCount) {
    reasons.push(`Available zones: ${zoneCount}, needs ${workload.minZones}`);
  }
  return reasons;
}

export interface QuotaUsage {
  name: string;
  used: number | null;
  limit: number | null;
}

export interface RegionQuota {
  usages: QuotaUsage[];
  fetchedAt: Date;
}

export interface QuotaSnapshot {
  state: "not-requested" | "loading" | "error" | "ready";
  data?: RegionQuota;
}

export interface QuotaScanOutcome {
  state: "ready" | "error";
  data?: RegionQuota;
  error?: unknown;
}

export const MAX_QUOTA_COVERAGE_REGIONS = 50;
export const QUOTA_SCAN_CONCURRENCY = 3;

export interface DeploymentReadinessRow {
  region: string;
  matchingSkuCount: number;
  eligibleSkuCount: number;
  readySkuCount: number;
  readiness: "ready" | "blocked" | "unknown" | "not-checked";
  reason: string;
  checkedAt?: Date;
}

export async function runBoundedQuotaScan(
  regions: readonly string[],
  fetchQuota: (region: string, signal: AbortSignal) => Promise<RegionQuota>,
  onResult: (region: string, result: QuotaScanOutcome) => void,
  signal: AbortSignal,
): Promise<void> {
  if (regions.length > MAX_QUOTA_COVERAGE_REGIONS) {
    throw new RangeError(`Quota coverage is limited to ${MAX_QUOTA_COVERAGE_REGIONS} regions per scan.`);
  }
  let next = 0;
  async function worker() {
    while (!signal.aborted) {
      const index = next++;
      if (index >= regions.length) return;
      const region = regions[index];
      try {
        const data = await fetchQuota(region, signal);
        if (!signal.aborted) onResult(region, { state: "ready", data });
      } catch (error) {
        if (!signal.aborted) onResult(region, { state: "error", error });
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(QUOTA_SCAN_CONCURRENCY, regions.length) },
    () => worker(),
  ));
}

function quotaNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export class QuotaDataError extends Error {}

export function parseQuota(data: unknown): RegionQuota {
  if (!data || typeof data !== "object" || !("value" in data) || !Array.isArray(data.value)) {
    throw new QuotaDataError("Unexpected regional usage response shape. Quota is unknown.");
  }
  if ("nextLink" in data && data.nextLink) {
    throw new QuotaDataError("Paginated regional usage response is not supported; quota is unknown.");
  }
  const usages: QuotaUsage[] = [];
  for (const item of data.value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const name = raw.name;
    if (!name || typeof name !== "object" || !("value" in name) || typeof name.value !== "string") continue;
    if (raw.unit !== "Count") continue;
    usages.push({ name: name.value.toLowerCase(), used: quotaNumber(raw.currentValue), limit: quotaNumber(raw.limit) });
  }
  return { usages, fetchedAt: new Date() };
}

export function quotaHeadroom(usage: QuotaUsage | undefined): number | null {
  return usage?.used != null && usage.limit != null ? usage.limit - usage.used : null;
}

export function assessQuota(offer: VmOffer, count: number, snapshot?: QuotaSnapshot) {
  const data = snapshot?.state === "ready" ? snapshot.data : undefined;
  const regional = data?.usages.find((q) => q.name.toLowerCase() === "cores");
  const family = data?.usages.find((q) => q.name.toLowerCase() === offer.family.toLowerCase());
  const product = offer.quotaVcpus != null ? offer.quotaVcpus * count : NaN;
  const required = Number.isSafeInteger(product) && product > 0 &&
    Number.isSafeInteger(count) && count > 0 ? product : null;
  const regionalHeadroom = quotaHeadroom(regional);
  const familyHeadroom = quotaHeadroom(family);
  const state = snapshot?.state ?? "not-requested";
  const insufficient = required !== null && [regionalHeadroom, familyHeadroom].some((h) => h !== null && h < required);
  const status = state !== "ready" ? state
    : insufficient ? "insufficient"
    : required === null || regionalHeadroom === null || familyHeadroom === null ? "unknown"
    : "sufficient";
  return { status, required, regional, family, regionalHeadroom, familyHeadroom };
}

export function quotaSummary(offer: VmOffer, count: number, snapshot?: QuotaSnapshot): string {
  const q = assessQuota(offer, count, snapshot);
  return `Quota ${q.status}; additional vCPUs ${q.required ?? "unknown"}; regional headroom ${q.regionalHeadroom ?? "unknown"}; family headroom ${q.familyHeadroom ?? "unknown"}`;
}

export function deploymentReadiness(
  offers: readonly VmOffer[],
  matchingOffers: readonly VmOffer[],
  count: number,
  quotas: ReadonlyMap<string, QuotaSnapshot>,
): DeploymentReadinessRow[] {
  const regions = [...new Set(offers.map((offer) => offer.region))];
  return regions.map((region) => {
    const matching = matchingOffers.filter((offer) => offer.region === region);
    const eligible = matching.filter((offer) => offer.status !== "restricted");
    const row = {
      region,
      matchingSkuCount: matching.length,
      eligibleSkuCount: eligible.length,
      readySkuCount: 0,
      readiness: "not-checked" as DeploymentReadinessRow["readiness"],
      reason: "Quota has not been checked for this region.",
    };
    if (matching.length === 0) {
      return {
        ...row,
        readiness: "blocked",
        reason: "No SKUs meet the applied capability and zone requirements.",
      };
    }
    if (eligible.length === 0) {
      return {
        ...row,
        readiness: "blocked",
        reason: "All matching SKUs are restricted for this subscription.",
      };
    }
    const snapshot = quotas.get(region);
    if (!snapshot || snapshot.state === "not-requested") return row;
    if (snapshot.state !== "ready") {
      return {
        ...row,
        readiness: "unknown",
        reason: snapshot.state === "error"
          ? "Quota could not be read; sufficiency is unknown."
          : "Quota is still loading; readiness is not final.",
      };
    }
    const assessments = eligible.map((offer) => assessQuota(offer, count, snapshot));
    const readySkuCount = assessments.filter((assessment) => assessment.status === "sufficient").length;
    if (readySkuCount > 0) {
      return {
        ...row,
        readiness: "ready",
        readySkuCount,
        reason: `${readySkuCount} matching SKU${readySkuCount === 1 ? "" : "s"} has sufficient regional and family vCPU headroom.`,
        checkedAt: snapshot.data?.fetchedAt,
      };
    }
    if (assessments.every((assessment) => assessment.status === "insufficient")) {
      return {
        ...row,
        readiness: "blocked",
        reason: "No eligible matching SKU has enough regional and family vCPU headroom for the requested VM count.",
        checkedAt: snapshot.data?.fetchedAt,
      };
    }
    return {
      ...row,
      readiness: "unknown",
      reason: "Quota metrics are incomplete for eligible SKUs; no passing SKU is confirmed.",
      checkedAt: snapshot.data?.fetchedAt,
    };
  });
}

export function csvCell(value: string | number | null | undefined): string {
  let text = value == null ? "Unknown" : String(value);
  let first = 0;
  while (first < text.length && (text.charCodeAt(first) <= 32 || /\s/.test(text[first]))) first++;
  if (typeof value === "string" && (["=", "+", "-", "@"].includes(text[first]) || /^[\t\r\n]/.test(text))) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function planningCsv(
  offers: VmOffer[],
  context: { subscriptionId: string; subscriptionName: string; series: string; workload: Workload; fetchedAt?: Date },
  quotas: ReadonlyMap<string, QuotaSnapshot>,
): string {
  const headings = [
    "Subscription ID", "Subscription name", "Series", "SKU", "Region", "Family",
    "Per-VM active vCPUs", "Per-VM quota vCPUs", "Per-VM RAM GiB", "Per-VM GPU count",
    "Subscription eligibility", "Restriction reason", "Offered zones", "Available zones",
    "Workload fit", "Requested additional VMs", "Required additional vCPUs", "Quota status",
    "Regional used vCPUs", "Regional limit vCPUs", "Regional headroom vCPUs",
    "Family used vCPUs", "Family limit vCPUs", "Family headroom vCPUs",
    "Minimum vCPUs", "Minimum RAM GiB", "Minimum GPUs", "Minimum available zones",
    "SKU fetched at UTC", "Quota fetched at UTC", "Allocation guarantee",
  ];
  const rows = offers.map((o) => {
    const snapshot = quotas.get(o.region);
    const q = assessQuota(o, context.workload.count, snapshot);
    return [
      context.subscriptionId, context.subscriptionName, context.series, o.sku, o.region, o.family,
      o.vcpus, o.quotaVcpus, o.memoryGB, o.gpus, o.status, o.reason ?? "None reported",
      o.zones.join("; ") || "None reported", o.availableZones.join("; ") || "None reported",
      fitReasons(o, context.workload).join("; ") || "Matches capability and zone minima",
      context.workload.count, q.required, q.status, q.regional?.used, q.regional?.limit, q.regionalHeadroom,
      q.family?.used, q.family?.limit, q.familyHeadroom,
      context.workload.minVcpus, context.workload.minMemoryGB, context.workload.minGpus, context.workload.minZones,
      context.fetchedAt?.toISOString(), snapshot?.data?.fetchedAt.toISOString(), "No",
    ].map(csvCell).join(",");
  });
  return [headings.map(csvCell).join(","), ...rows].join("\r\n");
}
