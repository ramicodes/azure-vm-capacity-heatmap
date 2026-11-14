import { useMutation, useQuery } from "@tanstack/react-query";
import { ArmReadError, type ArmRead, type ArmReadMetadata } from "./arm-http";
import { sessionErrorInvalidates } from "./cli-session-policy";
import { queryClient } from "./query-client";
import { useAppStore } from "./store";
import { subscriptionScope } from "./subscription-scope";

const bridgeOrigin = "http://127.0.0.1:5174";
let csrf: string | null = null;
const publicErrors: Record<string, string> = {
  "catalog-cache": "The local catalog cache could not be read or saved. Check the bridge terminal; clear its cache or disable ARM_SKU_CACHE and restart.",
  "cli-missing": "Azure CLI was not found. Install the official CLI and restart the local bridge.",
  "cli-login": "Azure CLI needs an authorized login or policy approval. Review it in your terminal; the dashboard never runs az login.",
  "cli-timeout": "Azure CLI timed out. Check its current login and try again.",
  "read-timeout": "The ARM read exceeded the local bridge's two-minute deadline. Retry with Refresh; no partial results were used.",
  "cli-context": "Use an authorized Azure public-cloud user context in Azure CLI.",
  "cli-failed": "Azure CLI could not read its context. Check az account show and organizational policy in your terminal.",
  "context-changed": "Azure CLI account, tenant or default subscription changed. Dashboard data was cleared. Connect again.",
  session: "The local CLI session expired or disconnected. Connect again.",
  "cli-token": "Azure CLI returned a different or invalid credential context. Connect again.",
  "http-401": "ARM rejected the CLI authorization. Review Azure CLI login and tenant policy in your terminal.",
  "http-403": "ARM denied this read. Check the CLI account's subscription RBAC permissions and policy.",
  "http-429": "ARM throttled this read. Wait before refreshing again.",
  busy: "The local CLI request queue is full. Wait for active reads to finish, then retry.",
  csrf: "The local bridge restarted. Refresh its connection and retry.",
  "subscription-scope": "This local bridge is restricted to its configured subscription. No other subscription was used.",
  "subscription-unavailable": "The configured subscription could not be read. Verify the exact subscription ID, CLI profile and Azure RBAC access. No other subscription was used.",
};

export function isInvalidCliSessionError(error: unknown): error is ArmReadError {
  return error instanceof ArmReadError && sessionErrorInvalidates(error.code);
}

async function applySubscriptionScope(metadata: object) {
  if (!("subscriptionScope" in metadata)) throw new ArmReadError("cli-shape", "The bridge did not return its subscription scope. Restart it and reconnect.");
  const scope = subscriptionScope(metadata.subscriptionScope);
  if (useAppStore.getState().azureSubscriptionScope !== scope) {
    useAppStore.getState().setAzureSubscriptionScope(scope);
    await queryClient.cancelQueries({ queryKey: ["arm"] });
    queryClient.removeQueries({ queryKey: ["arm"] });
  }
  return scope;
}

async function clearCliData(message?: string, expectedSession?: string) {
  if (expectedSession && useAppStore.getState().azureIdentity !== expectedSession) return;
  useAppStore.getState().setAzureIdentity(null);
  useAppStore.getState().setRegionSearch("");
  if (message) useAppStore.getState().setAzureAuthIssue(message);
  await queryClient.cancelQueries({ queryKey: ["arm"] });
  queryClient.removeQueries({ queryKey: ["arm"] });
}

async function bridgeRequest(route: string, method: "GET" | "POST", session: string | null, signal?: AbortSignal) {
  if (!import.meta.env.DEV || window.location.origin !== "http://127.0.0.1:5173") {
    throw new ArmReadError("cli-local", "CLI mode is available only in the local development preview.");
  }
  const headers: Record<string, string> = { "X-Dashboard-Cli": "1" };
  if (session) headers["X-Dashboard-Session"] = session;
  if (method === "POST" && csrf) headers["X-Dashboard-Csrf"] = csrf;
  let response: Response;
  try {
    response = await fetch(`${bridgeOrigin}${route}`, { method, headers, signal, credentials: "omit", redirect: "error", cache: "no-store" });
  } catch {
    signal?.throwIfAborted();
    throw new ArmReadError("cli-unreachable", "The local CLI bridge is unavailable. Run node scripts\\cli-arm-server.mjs in another terminal.");
  }
  let data: unknown;
  try { data = await response.json(); } catch {
    throw new ArmReadError("cli-shape", "The local bridge returned an invalid response.");
  }
  signal?.throwIfAborted();
  if (!response.ok) {
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : "bridge";
    const message = publicErrors[code] ?? "The local CLI bridge could not complete this read. Check its terminal and try again.";
    if (session && isInvalidCliSessionError(new ArmReadError(code, message))) {
      await clearCliData(message, session);
    }
    throw new ArmReadError(code, message);
  }
  if (!data || typeof data !== "object") throw new ArmReadError("cli-shape", "The local bridge returned an invalid response.");
  return data;
}

export async function readCliArm(request: ArmRead, session: string, signal?: AbortSignal, onMetadata?: (metadata: ArmReadMetadata) => void): Promise<unknown[]> {
  const scope = useAppStore.getState().azureSubscriptionScope;
  if (scope && request.kind !== "subscriptions" && request.subscriptionId.toLowerCase() !== scope) {
    throw new ArmReadError("subscription-scope", publicErrors["subscription-scope"]);
  }
  const params = new URLSearchParams({ kind: request.kind });
  if (request.kind !== "subscriptions") params.set("subscriptionId", request.subscriptionId);
  if (request.kind === "quota") params.set("region", request.region);
  const result = await bridgeRequest(`/read?${params}`, "GET", session, signal);
  if (!("value" in result) || !Array.isArray(result.value)) throw new ArmReadError("cli-shape", "The CLI bridge returned an unexpected list.");
  if (scope && request.kind === "subscriptions") {
    const item = result.value[0];
    if (result.value.length !== 1 || !item || typeof item !== "object" || typeof item.subscriptionId !== "string" ||
        item.subscriptionId.toLowerCase() !== scope) throw new ArmReadError("subscription-scope", publicErrors["subscription-scope"]);
  }
  if (useAppStore.getState().azureIdentity !== session) throw new ArmReadError("session", "The CLI connection changed. Discarded its previous read.");
  if (request.kind === "skus") {
    if (!("fetchedAt" in result) || typeof result.fetchedAt !== "number" || !Number.isFinite(result.fetchedAt) ||
        !Number.isFinite(new Date(result.fetchedAt).getTime()) || !("cached" in result) || typeof result.cached !== "boolean") {
      throw new ArmReadError("cli-shape", "The CLI bridge returned invalid catalog provenance. Restart the bridge and reconnect.");
    }
    onMetadata?.({ fetchedAt: new Date(result.fetchedAt), cached: result.cached });
  }
  return result.value;
}

export function useCliSession() {
  const identity = useAppStore((s) => s.azureIdentity);
  const issue = useAppStore((s) => s.azureAuthIssue);
  const busy = useAppStore((s) => s.azureAuthBusy);
  const status = useQuery({
    queryKey: ["cli-status", identity],
    queryFn: async ({ signal }) => {
      try {
        const result = await bridgeRequest("/status", "GET", identity, signal);
        if (!("csrf" in result) || typeof result.csrf !== "string" || !/^[a-f0-9]{64}$/.test(result.csrf)) {
          throw new ArmReadError("cli-shape", "The local bridge returned invalid session metadata.");
        }
        if (identity && useAppStore.getState().azureIdentity !== identity) throw new ArmReadError("session", "The CLI connection changed. Discarded its previous status.");
        await applySubscriptionScope(result);
        csrf = result.csrf;
        return true;
      } catch (error) {
        if (identity && !signal.aborted && isInvalidCliSessionError(error)) {
          await clearCliData(error instanceof ArmReadError ? error.message : "The CLI connection could not be verified. Connect again.", identity);
        }
        throw error;
      }
    },
    retry: false, staleTime: 60_000, gcTime: 0,
    refetchInterval: identity ? 60_000 : false, refetchIntervalInBackground: true,
    refetchOnWindowFocus: true, refetchOnReconnect: true,
  });
  const connect = useMutation({
    mutationFn: async () => {
      const store = useAppStore.getState();
      if (store.azureAuthBusy) throw new ArmReadError("busy", "A CLI connection action is already running.");
      store.setAzureAuthBusy(true);
      store.setAzureAuthIssue(null);
      try {
        // Refresh the anti-CSRF value in case the bridge was restarted.
        const metadata = await bridgeRequest("/status", "GET", null);
        if (!("csrf" in metadata) || typeof metadata.csrf !== "string") throw new ArmReadError("cli-shape", "The bridge returned invalid session metadata.");
        const scope = await applySubscriptionScope(metadata);
        csrf = metadata.csrf;
        const result = await bridgeRequest("/connect", "POST", store.azureIdentity);
        if (!("session" in result) || typeof result.session !== "string" || !/^[a-f0-9]{64}$/.test(result.session)) {
          throw new ArmReadError("cli-shape", "The bridge returned an invalid local session.");
        }
        if (!("subscriptionScope" in result) || subscriptionScope(result.subscriptionScope) !== scope) {
          throw new ArmReadError("subscription-scope", "The bridge's configured subscription changed while connecting. Reconnect before reading data.");
        }
        await clearCliData();
        store.setAzureIdentity(result.session);
      } catch (error) {
        store.setAzureAuthIssue(error instanceof ArmReadError ? error.message : "The local CLI connection failed.");
        throw error;
      } finally { store.setAzureAuthBusy(false); }
    },
  });
  const disconnect = useMutation({
    mutationFn: async () => {
      const store = useAppStore.getState();
      store.setAzureAuthBusy(true);
      const previous = store.azureIdentity;
      await clearCliData();
      try { await bridgeRequest("/disconnect", "POST", previous); } catch (error) {
        store.setAzureAuthIssue("Dashboard data was cleared, but the bridge could not confirm disconnect. Its local session expires after 30 minutes of inactivity or on bridge restart.");
        throw error;
      } finally { store.setAzureAuthBusy(false); }
    },
  });
  return { identity, issue, busy, status, connect, disconnect };
}
