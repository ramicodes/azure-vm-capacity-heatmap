import { ArmReadError, type ArmRead, type ArmReadMetadata } from "./arm-http.ts";

const seenReads = new Set<string>();

export async function hostedJson(path: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(path, { credentials: "same-origin", cache: "no-store", redirect: "error", signal }); }
  catch {
    signal?.throwIfAborted();
    throw new ArmReadError("hosted-network", "The hosted session could not be reached. Retry, or sign in again if your session expired.");
  }
  if (!response.ok) throw new ArmReadError(`hosted-${response.status}`, response.status === 401
    ? "Your hosted session expired. Sign in again."
    : response.status === 403 ? "Access denied. The app owner must check your allowed identity and the backend's Azure Reader access."
      : `The managed-identity backend could not complete this read (HTTP ${response.status}). Retry later.`);
  return response.json();
}

export function hostedSession(value: unknown): { identity: string; subscriptionId: string; tenant: string } {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!value || typeof value !== "object" || !("identity" in value) || !("subscriptionId" in value) || !("tenant" in value) ||
    typeof value.identity !== "string" || !guid.test(value.identity) ||
    typeof value.subscriptionId !== "string" || !guid.test(value.subscriptionId) ||
    typeof value.tenant !== "string" || !guid.test(value.tenant)) {
    throw new ArmReadError("hosted-shape", "The hosted session returned invalid configuration.");
  }
  return { identity: value.identity, subscriptionId: value.subscriptionId, tenant: value.tenant };
}

export async function readHostedArm(request: ArmRead, signal?: AbortSignal, onMetadata?: (metadata: ArmReadMetadata) => void, sessionKey = ""): Promise<unknown[]> {
  const params = new URLSearchParams({ kind: request.kind });
  if (request.kind !== "subscriptions") params.set("subscriptionId", request.subscriptionId);
  if (request.kind === "quota") params.set("region", request.region);
  const key = `${sessionKey}:${params}`;
  if (seenReads.has(key)) params.set("refresh", "1");
  const data = await hostedJson(`/api/arm?${params}`, signal);
  if (!data || typeof data !== "object" || !("items" in data) || !Array.isArray(data.items) ||
    !("cached" in data) || typeof data.cached !== "boolean" ||
    !("fetchedAt" in data) || typeof data.fetchedAt !== "string" || !Number.isFinite(Date.parse(data.fetchedAt))) {
    throw new ArmReadError("hosted-shape", "The backend returned incomplete Azure data.");
  }
  signal?.throwIfAborted();
  if (seenReads.size >= 64) seenReads.delete(seenReads.values().next().value!);
  seenReads.add(key);
  onMetadata?.({ cached: data.cached, fetchedAt: new Date(data.fetchedAt) });
  return data.items;
}
