import { useEffect, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ErrorState, LoadingState } from "@/components/states";
import { hostedJson, hostedSession } from "@/lib/hosted-session";
import { useAppStore } from "@/lib/store";
import { queryClient } from "@/lib/query-client";

export function HostedAccess({ children }: { children: ReactNode }) {
  const identity = useAppStore((s) => s.azureIdentity);
  const session = useQuery({
    queryKey: ["hosted-auth"],
    queryFn: async ({ signal }) => hostedSession(await hostedJson("/api/session", signal)),
    retry: false, staleTime: 30000, refetchInterval: 60000,
  });
  useEffect(() => {
    const store = useAppStore.getState();
    const next = session.isError ? null : session.data?.identity ?? null;
    const scope = session.isError ? null : session.data?.subscriptionId ?? null;
    if (store.azureIdentity !== next || store.azureSubscriptionScope !== scope) {
      void queryClient.cancelQueries({ queryKey: ["arm"] });
      queryClient.removeQueries({ queryKey: ["arm"] });
      if (store.azureSubscriptionScope !== scope) store.setAzureSubscriptionScope(scope);
      if (useAppStore.getState().azureIdentity !== next) store.setAzureIdentity(next);
    }
  }, [session.data, session.isError]);
  if (session.isPending) return <LoadingState rows={2} />;
  if (session.isError) return <div className="space-y-3 p-6">
    <ErrorState title="Hosted sign-in needs attention" description={session.error.message} />
    <Button asChild><a href="/.auth/login/aad?post_login_redirect_uri=/">Sign in</a></Button>
    <Button variant="outline" onClick={() => void session.refetch()}>Retry session</Button>
  </div>;
  if (!identity || identity !== session.data.identity) return <LoadingState rows={2} />;
  return <>
    <section aria-label="Hosted access" className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 text-sm sm:px-6">
      <p>Managed-identity workspace · Configured subscription only · Access restricted by the app owner</p>
      <Button variant="ghost" size="sm" asChild><a href="/.auth/logout">Sign out</a></Button>
    </section>
    {children}
  </>;
}
