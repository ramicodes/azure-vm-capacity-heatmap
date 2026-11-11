import { useEffect, useState, type ReactNode } from "react";
import { Cloud, Info, LogIn, LogOut, ShieldCheck } from "lucide-react";
import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorState, LoadingState } from "@/components/states";
import { PageSection } from "@/components/page-section";
import { azureEnvironment, useAzureSession } from "@/lib/azure-session";
import { CliAccess } from "@/components/cli-access";

let popupCompletion: Promise<void> | undefined;

export function AzurePopupCallback() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    popupCompletion ??= broadcastResponseToMainFrame();
    void popupCompletion.catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  return (
    <PageSection className="p-6" title="Completing Azure sign-in">
      {failed ? <ErrorState title="The sign-in response could not be completed"
        description="Close this popup and retry sign-in from the dashboard. No authentication details are displayed here." />
        : <LoadingState rows={1} />}
    </PageSection>
  );
}

export function AzureAccess({ children }: { children: ReactNode }) {
  const session = useAzureSession();
  if (azureEnvironment.mode === "cli") return <CliAccess>{children}</CliAccess>;
  if (azureEnvironment.mode === "managed") return <>{children}</>;
  if (!azureEnvironment.config) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <PageSection className="rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8"
          title="Set up Azure sign-in" description="Connect an existing Entra app registration to this dashboard.">
          <div role="alert">
            <ErrorState className="items-start gap-1 py-0 text-left [&>p]:max-w-none"
              title="Public configuration needed"
              description="Add the app's public settings to .env.local and restart the preview. Never provide a client secret." />
          </div>
          <details className="group border-t border-border pt-4">
            <summary className="cursor-pointer rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring">
              Show setup instructions
            </summary>
            <div className="space-y-4 pt-4">
              <ul className="space-y-2 break-words text-sm text-muted-foreground">
                {azureEnvironment.problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
              <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
                {"VITE_ARM_MODE=standalone\nVITE_AZURE_CLIENT_ID=<application-client-id-guid>\nVITE_AZURE_TENANT_ID=<directory-tenant-id-guid>\nVITE_AZURE_REDIRECT_URI="}{window.location.origin}{"/"}
              </pre>
              <p className="text-sm leading-6 text-muted-foreground">
                Register this exact root URL as a Single-page application redirect. The app needs delegated
                Azure Service Management user_impersonation permission and the required tenant consent.
                An authorized owner must make registration or permission changes; this dashboard does not.
              </p>
            </div>
          </details>
          <p className="text-xs leading-5 text-muted-foreground">
            Standalone mode uses direct ARM reads, never the Power Apps connector or a data fallback.
          </p>
        </PageSection>
      </div>
    );
  }
  const configuration = azureEnvironment.config;
  const status = session.busy
    ? session.signOut.isPending ? "Signing out..." : session.signIn.isPending ? "Signing in..." : "Updating session..."
    : session.identity ? "Signed in" : "Not signed in";
  const feedback = (session.initialization.isError || session.issue) && (
    <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3">
      <ErrorState className="items-start gap-1 py-0 text-left [&>p]:max-w-none"
        title={session.initialization.isError ? "Sign-in could not initialize" : "Sign-in needs attention"}
        description={session.initialization.isError
          ? "Check browser support and public configuration, then retry initialization."
          : session.issue ?? undefined} />
    </div>
  );
  const primaryAction = (
    <Button size="sm" className="min-h-9"
      variant={session.identity && !session.issue ? "outline" : "default"}
      disabled={session.busy || (!session.initialization.isSuccess && !session.initialization.isError)}
      onClick={() => session.initialization.isError ? void session.initialization.refetch() : session.signIn.mutate()}>
      <LogIn className="size-4" aria-hidden="true" />
      {session.busy ? status : session.initialization.isError ? "Retry initialization"
        : session.identity ? session.issue ? "Sign in again" : "Switch account" : "Sign in to Azure"}
    </Button>
  );
  const details = (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="min-h-9 text-muted-foreground" aria-label="Azure sign-in connection details">
          <Info className="size-4" aria-hidden="true" />
          Connection details
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-4 text-sm">
        <h2 className="font-semibold">Azure sign-in details</h2>
        <dl className="space-y-3 text-xs">
          <div className="space-y-1">
            <dt className="font-medium">Directory</dt>
            <dd className="break-all text-muted-foreground">{configuration.tenant}</dd>
          </div>
          <div className="space-y-1">
            <dt className="font-medium">Registered SPA redirect URI</dt>
            <dd className="break-all text-muted-foreground">{configuration.redirectUri}</dd>
          </div>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">
          This app requests delegated Azure Service Management access, but only sends GET requests.
          Your account's Azure RBAC permissions still apply. No deployments, quota increases or permission changes.
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          The account and token cache stays in memory; reload requires sign-in again.
          Microsoft's session may persist independently. Sign out clears dashboard data even if its popup is cancelled.
        </p>
        <p className="text-xs leading-5 text-muted-foreground">
          Having trouble signing in? Check popup permissions, the registered SPA redirect and your tenant's consent policy.
        </p>
      </PopoverContent>
    </Popover>
  );
  if (session.identity) {
    return (
      <>
        <section aria-label="Azure sign-in" className="space-y-3 border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="flex min-w-0 items-center gap-3">
              <Cloud className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold">Azure account</h2>
                <p className="flex items-center gap-2 text-xs leading-5">
                  <span role="status" aria-live="polite" className="inline-flex items-center gap-1.5 font-medium">
                    <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
                    {status}
                  </span>
                  <span className="text-muted-foreground">Subscription permissions apply</span>
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {primaryAction}
              <Button variant="ghost" size="sm" className="min-h-9" disabled={session.busy}
                onClick={() => session.signOut.mutate()}>
                <LogOut className="size-4" aria-hidden="true" />
                Sign out
              </Button>
              {details}
            </div>
          </div>
          {feedback}
        </section>
        {children}
      </>
    );
  }
  return (
    <section aria-label="Azure sign-in" className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="space-y-6 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-border bg-muted/50 p-2.5">
              <Cloud className="size-5 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="min-w-0 space-y-2">
              <h1 className="text-xl font-semibold leading-tight tracking-tight">Your Azure workspace</h1>
              <p role="status" aria-live="polite" className="text-xs font-medium text-muted-foreground">
                {session.initialization.isFetching ? "Preparing sign-in..." : status}
              </p>
            </div>
          </div>
          <p className="max-w-prose text-sm leading-6 text-muted-foreground">
            Sign in with your work or school account to explore VM availability and selected-region quota across your subscriptions.
          </p>
          {feedback}
          <div className="flex flex-wrap items-center gap-3">
            {primaryAction}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
              Read-only ARM requests
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-border bg-muted/20 px-4 py-2 sm:px-6">
          <p className="text-xs text-muted-foreground">Your Azure permissions. No deployments.</p>
          {details}
        </div>
      </div>
    </section>
  );
}
