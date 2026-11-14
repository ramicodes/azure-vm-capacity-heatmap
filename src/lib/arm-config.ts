export const ARM_ORIGIN = "https://management.azure.com";
export const ARM_SCOPE = `${ARM_ORIGIN}/user_impersonation`;

export interface AzureBrowserConfig {
  clientId: string;
  tenant: string;
  authority: string;
  redirectUri: string;
}

export interface ArmEnvironment {
  mode: "managed" | "standalone" | "cli" | "hosted";
  config: AzureBrowserConfig | null;
  problems: string[];
}

export function armCacheKey(environment: ArmEnvironment, identity: string | null, generation = 0, subscriptionScope: string | null = null): string {
  return environment.mode === "managed" ? "managed"
    : environment.mode === "cli" || environment.mode === "hosted" ? `${environment.mode}:${identity ?? "disconnected"}:${generation}:${subscriptionScope ?? "all"}`
    : `standalone:${environment.config?.clientId ?? ""}:${environment.config?.tenant ?? ""}:${identity ?? "signed-out"}:${generation}`;
}

export function armEnvironment(
  env: Record<string, string | undefined>,
  currentOrigin: string,
  development = false,
): ArmEnvironment {
  const origin = new URL(currentOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
  const mode = env.VITE_ARM_MODE?.trim() || (local ? "standalone" : "managed");
  if (mode === "managed") return { mode, config: null, problems: [] };
  if (mode === "hosted") return { mode, config: null, problems: [] };
  if (mode === "cli") {
    return development && currentOrigin === "http://127.0.0.1:5173"
      ? { mode, config: null, problems: [] }
      : { mode: "standalone", config: null, problems: ["CLI mode requires the development preview at http://127.0.0.1:5173."] };
  }
  if (mode !== "standalone") {
    return { mode: "standalone", config: null, problems: ["VITE_ARM_MODE must be managed, standalone, cli or hosted."] };
  }
  const problems: string[] = [];
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const clientId = env.VITE_AZURE_CLIENT_ID?.trim() ?? "";
  const tenant = env.VITE_AZURE_TENANT_ID?.trim() ?? "";
  if (!guid.test(clientId)) problems.push("Set VITE_AZURE_CLIENT_ID to the Application (client) ID GUID, not an api:// URI.");
  if (!guid.test(tenant) && tenant !== "organizations") {
    problems.push("Set VITE_AZURE_TENANT_ID to a directory GUID, or organizations only for a multi-tenant registration.");
  }
  const redirectUri = env.VITE_AZURE_REDIRECT_URI?.trim() || `${origin.origin}/`;
  try {
    const redirect = new URL(redirectUri);
    if (redirect.origin !== origin.origin || redirect.pathname !== "/" || redirect.search || redirect.hash ||
      redirect.username || redirect.password || (!local && redirect.protocol !== "https:")) {
      problems.push("VITE_AZURE_REDIRECT_URI must be this app's exact origin and root path, with HTTPS except on loopback.");
    }
  } catch {
    problems.push("VITE_AZURE_REDIRECT_URI must be a valid absolute URL.");
  }
  return {
    mode: "standalone",
    problems,
    config: problems.length ? null : { clientId, tenant, authority: `https://login.microsoftonline.com/${tenant}`, redirectUri },
  };
}

export function authFailureMessage(error: unknown): string {
  const code = error && typeof error === "object" && "errorCode" in error ? error.errorCode : undefined;
  switch (code) {
    case "user_cancelled": return "Azure sign-in was cancelled. Any existing connection was left unchanged.";
    case "popup_window_error":
    case "empty_window_error": return "The sign-in popup was blocked. Allow popups for this app and try again.";
    case "interaction_in_progress": return "An Azure sign-in is already in progress. Complete or close that popup first.";
    case "redirect_uri_mismatch": return "The redirect URI is not registered. Ask the app owner to check the SPA redirect URI.";
    case "consent_required": return "Azure consent is required. Ask the app owner or tenant administrator to review the delegated ARM permission.";
    default: return "Azure sign-in failed. Check the client ID, tenant, registered SPA redirect URI and your tenant's sign-in policy, then retry.";
  }
}
