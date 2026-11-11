import type { ReactNode } from "react";
import { Cloud, Info, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ErrorState } from "@/components/states";
import { useCliSession } from "@/lib/cli-session";

export function CliAccess({ children }: { children: ReactNode }) {
  const session = useCliSession();
  const feedback = session.issue || (session.status.isError ? session.status.error.message : null);
  const details = (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="min-h-9 text-muted-foreground" aria-label="Local Azure CLI connection details">
          <Info className="size-4" aria-hidden="true" />Connection details
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] space-y-3 text-xs leading-5">
        <h2 className="text-sm font-semibold">Local Azure CLI access</h2>
        <p>Uses the CLI's existing authorized public-cloud user context. It is not a consent bypass.
          Tenant policy and Azure RBAC still apply. The dashboard never runs az login or changes CLI context.</p>
        <p>Tokens stay in the loopback server. Only dashboard GET reads are allowed.
          Context is checked on every read and every 15 seconds while connected; changes clear dashboard data.</p>
        <p>To change accounts or directories, use your own terminal, then reconnect here.
          Disconnect clears dashboard data without signing Azure CLI out. Local sessions expire after 30 minutes.</p>
      </PopoverContent>
    </Popover>
  );
  const action = (
    <Button size="sm" className="min-h-9" variant={session.identity && !feedback ? "outline" : "default"}
      disabled={session.busy} onClick={() => session.connect.mutate()}>
      <RefreshCw className="size-4" aria-hidden="true" />
      {session.busy ? "Updating connection..." : session.identity ? "Reconnect CLI" : "Connect Azure CLI"}
    </Button>
  );
  const error = feedback && (
    <div role="alert" className="rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3">
      <ErrorState className="items-start gap-1 py-0 text-left [&>p]:max-w-none"
        title="CLI connection needs attention" description={feedback} />
    </div>
  );
  if (session.identity) return (
    <>
      <section aria-label="Local Azure CLI connection" className="space-y-3 border-b border-border bg-muted/20 px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Cloud className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold">Local Azure CLI</h2>
              <p role="status" aria-live="polite" className="text-xs leading-5 text-muted-foreground">
                {session.busy ? "Updating connection..." : "CLI context selected"} · Subscription permissions apply
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {action}
            <Button size="sm" variant="ghost" className="min-h-9" disabled={session.busy} onClick={() => session.disconnect.mutate()}>
              <LogOut className="size-4" aria-hidden="true" />Disconnect
            </Button>
            {details}
          </div>
        </div>
        {error}
      </section>
      {children}
    </>
  );
  return (
    <section aria-label="Local Azure CLI connection" className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="rounded-lg border border-border bg-card shadow-sm">
        <div className="space-y-6 p-6 sm:p-8">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-border bg-muted/50 p-2.5"><Cloud className="size-5 text-muted-foreground" aria-hidden="true" /></div>
            <div className="min-w-0 space-y-2">
              <h1 className="text-xl font-semibold leading-tight tracking-tight">Use your local Azure CLI</h1>
              <p role="status" aria-live="polite" className="text-xs font-medium text-muted-foreground">
                {session.busy ? "Checking CLI authorization..." : "Not connected"}
              </p>
            </div>
          </div>
          <p className="text-sm leading-6 text-muted-foreground">
            Explore VM offerings and quota using the CLI's existing authorized account. No browser Azure tokens or new app registration.
          </p>
          {error}
          <div className="flex flex-wrap items-center gap-3">
            {action}
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-4" aria-hidden="true" />Local, read-only ARM requests</span>
          </div>
          <details className="border-t border-border pt-4">
            <summary className="cursor-pointer rounded-sm text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring">Start the local bridge</summary>
            <p className="pt-3 text-xs leading-5 text-muted-foreground">In this repository, run the following in a separate terminal. Keep it running alongside the preview.</p>
            <pre className="mt-3 overflow-auto rounded-md bg-muted p-3 text-xs">node scripts\cli-arm-server.mjs</pre>
            <p className="pt-3 text-xs leading-5 text-muted-foreground">Check az account show yourself. If login or consent is required, use only your organization's authorized process. The dashboard cannot grant access.</p>
          </details>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/20 px-4 py-2 sm:px-6">
          <p className="text-xs text-muted-foreground">Loopback development only. No deployments.</p>{details}
        </div>
      </div>
    </section>
  );
}
