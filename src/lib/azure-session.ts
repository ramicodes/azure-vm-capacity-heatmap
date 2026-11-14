import { useMutation, useQuery } from "@tanstack/react-query";
import {
  BrowserCacheLocation, CacheLookupPolicy, InteractionRequiredAuthError, PublicClientApplication,
  type AccountInfo,
} from "@azure/msal-browser";
import { armCacheKey, armEnvironment, ARM_SCOPE, authFailureMessage } from "./arm-config";
import { ArmReadError } from "./arm-http";
import { queryClient } from "./query-client";
import { useAppStore } from "./store";

export const azureEnvironment = armEnvironment(import.meta.env, window.location.origin, import.meta.env.DEV);
let clientPromise: Promise<PublicClientApplication> | undefined;

function accountKey(account: AccountInfo) {
  return `${account.homeAccountId}:${account.tenantId}:${account.localAccountId}`;
}

async function getClient(): Promise<PublicClientApplication> {
  const config = azureEnvironment.config;
  if (!config) throw new Error("Standalone Azure configuration is incomplete.");
  if (!clientPromise) {
    clientPromise = (async () => {
      const client = new PublicClientApplication({
        auth: { clientId: config.clientId, authority: config.authority, redirectUri: config.redirectUri, postLogoutRedirectUri: config.redirectUri },
        cache: { cacheLocation: BrowserCacheLocation.MemoryStorage },
        system: { allowPlatformBroker: false, loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => undefined } },
      });
      await client.initialize();
      return client;
    })().catch(() => {
      clientPromise = undefined;
      throw new Error("Azure sign-in could not initialize. Check browser support and configuration, then retry.");
    });
  }
  return clientPromise;
}

async function clearArmData() {
  await queryClient.cancelQueries({ queryKey: ["arm"] });
  queryClient.removeQueries({ queryKey: ["arm"] });
}

export function useArmReadContext() {
  const identity = useAppStore((s) => s.azureIdentity);
  const generation = useAppStore((s) => s.azureSessionGeneration);
  const cliScope = useAppStore((s) => s.azureSubscriptionScope);
  const managed = azureEnvironment.mode === "managed";
  const subscriptionScope = azureEnvironment.mode === "cli" || azureEnvironment.mode === "hosted" ? cliScope : null;
  return {
    mode: azureEnvironment.mode,
    identity,
    subscriptionScope,
    enabled: managed || ((azureEnvironment.mode === "cli" || azureEnvironment.mode === "hosted" || azureEnvironment.config !== null) && identity !== null),
    cacheKey: armCacheKey(azureEnvironment, identity, generation, subscriptionScope),
  };
}

export type ArmReadContext = ReturnType<typeof useArmReadContext>;

export function useAzureSession() {
  const identity = useAppStore((s) => s.azureIdentity);
  const issue = useAppStore((s) => s.azureAuthIssue);
  const busy = useAppStore((s) => s.azureAuthBusy);
  const initialization = useQuery({
    queryKey: ["azure-auth", "initialize"],
    queryFn: async () => { await getClient(); return true; },
    enabled: azureEnvironment.mode === "standalone" && azureEnvironment.config !== null,
    staleTime: Infinity, gcTime: Infinity, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
  });
  const signIn = useMutation({
    mutationFn: async () => {
      const store = useAppStore.getState();
      if (store.azureAuthBusy) throw new Error("An Azure sign-in is already in progress.");
      store.setAzureAuthBusy(true);
      store.setAzureAuthIssue(null);
      try {
        const client = await getClient();
        const result = await client.loginPopup({ scopes: [ARM_SCOPE], prompt: "select_account" });
        if (!result.account) throw new Error("No Azure account was returned.");
        await clearArmData();
        client.setActiveAccount(result.account);
        store.setAzureIdentity(accountKey(result.account));
      } catch (error) {
        const message = authFailureMessage(error);
        store.setAzureAuthIssue(message);
        throw new Error(message);
      } finally {
        store.setAzureAuthBusy(false);
      }
    },
  });
  const signOut = useMutation({
    mutationFn: async () => {
      const store = useAppStore.getState();
      if (store.azureAuthBusy) throw new Error("An Azure account action is already in progress.");
      store.setAzureAuthBusy(true);
      store.setAzureIdentity(null);
      try {
        await clearArmData();
        const client = await getClient();
        const account = client.getActiveAccount();
        client.setActiveAccount(null);
        try {
          await client.logoutPopup({ account, postLogoutRedirectUri: azureEnvironment.config!.redirectUri });
        } finally {
          try { await client.clearCache(); } finally { clientPromise = undefined; }
        }
      } catch {
        const message = "Dashboard data was cleared, but Microsoft sign-out did not complete. Close any sign-out popup and retry if needed.";
        store.setAzureAuthIssue(message);
        throw new Error(message);
      } finally {
        store.setAzureAuthBusy(false);
      }
    },
  });
  return { identity, issue, busy, initialization, signIn, signOut };
}

export async function azureAccessToken(expectedIdentity: string): Promise<string> {
  const client = await getClient();
  const account = client.getActiveAccount();
  const current = () => useAppStore.getState().azureIdentity === expectedIdentity;
  if (!account || !current() || accountKey(account) !== expectedIdentity) {
    throw new ArmReadError("session", "The Azure account changed. Sign in again before reading data.");
  }
  try {
    const result = await client.acquireTokenSilent({
      scopes: [ARM_SCOPE], account, cacheLookupPolicy: CacheLookupPolicy.AccessTokenAndRefreshToken,
    });
    if (!current()) throw new ArmReadError("session", "The Azure account changed. Discarded the previous account's request.");
    if (!result.accessToken) throw new ArmReadError("authentication", "Azure returned no ARM access token. Sign in again.");
    return result.accessToken;
  } catch (error) {
    if (error instanceof ArmReadError) throw error;
    const message = error instanceof InteractionRequiredAuthError
      ? "Azure needs interactive sign-in again. Use Sign in again to continue."
      : "Azure could not refresh the sign-in session. Sign in again or check your tenant's policies.";
    if (current()) useAppStore.getState().setAzureAuthIssue(message);
    throw new ArmReadError("authentication", message);
  }
}
