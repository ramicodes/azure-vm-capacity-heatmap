import type { VmOffer } from "./azure-capacity";
import { assessQuota, type QuotaSnapshot } from "./workload-planning.ts";

export function quotaGuidance(offer: VmOffer, count: number, snapshot?: QuotaSnapshot): string {
  const q = assessQuota(offer, count, snapshot);
  if (offer.status === "restricted") return `Subscription restriction: ${offer.reason ?? "reason not reported"}. A quota increase alone may not resolve this restriction.`;
  if (q.status === "not-requested") return "Check quota to read regional and family vCPU headroom.";
  if (q.status === "loading") return "Reading quota; no final assessment yet.";
  if (q.status === "error") return "Quota read failed. Retry or check your read permissions; sufficiency is unknown.";
  if (q.required === null) return "Required quota vCPUs are unknown for this size. Confirm its quota core count in Azure.";
  const required = q.required;
  const shortfalls = [
    { label: "regional", usage: q.regional, headroom: q.regionalHeadroom },
    { label: `family (${offer.family})`, usage: q.family, headroom: q.familyHeadroom },
  ].flatMap(({ label, usage, headroom }) => headroom !== null && headroom < required && usage?.used != null
    ? [`${label}: shortfall ${required - headroom} vCPUs; request a total limit of at least ${usage.used + required}`]
    : []);
  if (shortfalls.length) return `${shortfalls.join(". ")}. Unknown metrics still need verification.`;
  if (q.status === "unknown") return "Quota metrics are incomplete. Verify both regional and exact-family limits in Azure.";
  return "Regional and family vCPU headroom cover this candidate. This is not a reservation or allocation guarantee.";
}
