import { ARM_ORIGIN } from "./arm-config.ts";

export type ArmRead =
  | { kind: "subscriptions" }
  | { kind: "regions"; subscriptionId: string }
  | { kind: "skus"; subscriptionId: string }
  | { kind: "quota"; subscriptionId: string; region: string };

export interface ArmReadMetadata {
  fetchedAt: Date;
  cached: boolean;
}

export class ArmReadError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}

export function armEndpoint(request: ArmRead) {
  if (request.kind === "subscriptions") return { path: "/subscriptions", version: "2022-12-01" };
  const base = `/subscriptions/${encodeURIComponent(request.subscriptionId)}`;
  if (request.kind === "regions") return { path: `${base}/locations`, version: "2022-12-01" };
  if (request.kind === "skus") return { path: `${base}/providers/Microsoft.Compute/skus`, version: "2021-07-01" };
  return { path: `${base}/providers/Microsoft.Compute/locations/${encodeURIComponent(request.region)}/usages`, version: "2025-04-01" };
}

export function armPageUrl(value: string, expectedPath: string, version: string): URL {
  let url: URL;
  try { url = new URL(value, ARM_ORIGIN); } catch {
    throw new ArmReadError("pagination", "ARM returned an invalid pagination URL.");
  }
  if (url.origin !== ARM_ORIGIN || url.username || url.password || url.hash ||
    url.pathname !== expectedPath || url.searchParams.getAll("api-version").length !== 1 || url.searchParams.get("api-version") !== version) {
    throw new ArmReadError("pagination", "ARM pagination was rejected because it changed the endpoint or API version.");
  }
  return url;
}

export function armListPage(data: unknown): { items: unknown[]; nextLink?: string } {
  if (Array.isArray(data)) return { items: data };
  if (!data || typeof data !== "object" || !("value" in data) || !Array.isArray(data.value)) {
    throw new ArmReadError("shape", "ARM returned an unexpected list response. No partial results were used.");
  }
  const next = "nextLink" in data ? data.nextLink : undefined;
  if (next != null && typeof next !== "string") {
    throw new ArmReadError("pagination", "ARM returned invalid pagination metadata. No partial results were used.");
  }
  return { items: data.value, nextLink: next || undefined };
}

export function managedArmItems(data: unknown): unknown[] {
  const page = armListPage(data);
  if (page.nextLink) {
    throw new ArmReadError("managed-pagination", "The managed connector cannot follow this paginated ARM response. No incomplete results were used.");
  }
  return page.items;
}

async function fetchArmJson(
  url: URL, getToken: () => Promise<string>, signal: AbortSignal | undefined, fetcher: typeof fetch,
): Promise<unknown> {
  signal?.throwIfAborted();
  const token = await getToken();
  signal?.throwIfAborted();
  let response: Response;
  try {
    response = await fetcher(url.href, {
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit", redirect: "error", cache: "no-store", signal,
    });
  } catch (error) {
    if (signal?.aborted || error instanceof ArmReadError) throw error;
    throw new ArmReadError("network", "ARM could not be reached. Check the network, browser CORS policy and Azure service availability.");
  }
  signal?.throwIfAborted();
  if (!response.ok) {
    const message = response.status === 401 ? "ARM rejected the sign-in token. Sign out and sign in again; check tenant policies."
      : response.status === 403 ? "ARM read access was denied. Check the signed-in account's Azure RBAC permissions and tenant policies."
      : response.status === 429 ? "ARM throttled this read. Wait before refreshing again."
      : `ARM read failed (HTTP ${response.status}). Retry later.`;
    throw new ArmReadError(`http-${response.status}`, message);
  }
  let data: unknown;
  try { data = await response.json(); } catch {
    signal?.throwIfAborted();
    throw new ArmReadError("shape", "ARM returned invalid JSON. No partial results were used.");
  }
  signal?.throwIfAborted();
  return data;
}

export async function fetchArmSubscription(
  subscriptionId: string, getToken: () => Promise<string>, signal?: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<unknown> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(subscriptionId)) {
    throw new ArmReadError("subscription-scope", "The configured subscription ID must be a GUID.");
  }
  const path = `/subscriptions/${subscriptionId.toLowerCase()}`;
  const data = await fetchArmJson(armPageUrl(`${path}?api-version=2022-12-01`, path, "2022-12-01"), getToken, signal, fetcher);
  if (!data || typeof data !== "object" || !("subscriptionId" in data) ||
      typeof data.subscriptionId !== "string" || data.subscriptionId.toLowerCase() !== subscriptionId.toLowerCase() ||
      !("displayName" in data) || typeof data.displayName !== "string" || !data.displayName.trim() ||
      "nextLink" in data) {
    throw new ArmReadError("subscription-scope", "ARM did not return the exact configured subscription and its name. No other subscription was used.");
  }
  return data;
}

export async function fetchArmList(
  request: ArmRead,
  getToken: () => Promise<string>,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<unknown[]> {
  const { path, version } = armEndpoint(request);
  let next: string | undefined = `${path}?api-version=${version}`;
  const seen = new Set<string>();
  const items: unknown[] = [];
  while (next) {
    signal?.throwIfAborted();
    const url = armPageUrl(next, path, version);
    if (seen.has(url.href) || seen.size >= 100) {
      throw new ArmReadError("pagination", "ARM pagination exceeded its 100-page bound or repeated a page. No partial results were used.");
    }
    seen.add(url.href);
    const page = armListPage(await fetchArmJson(url, getToken, signal, fetcher));
    if (items.length + page.items.length > 100000) throw new ArmReadError("pagination", "ARM results exceeded the 100,000-item bound. No partial results were used.");
    for (const item of page.items) items.push(item);
    next = page.nextLink;
  }
  return items;
}
