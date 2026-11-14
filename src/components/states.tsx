import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { LoaderCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  connectorErrorMessage,
  isConnectorPolicyBlock,
} from "@/lib/connector-error";
import { cn } from "@/lib/utils";

// Designed empty / error / loading states. Use these so every zero-data,
// failure, and loading case looks intentional instead of a bare container.

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 py-16 text-center",
        className,
      )}
    >
      {Icon && (
        <Icon className="size-10 text-muted-foreground" aria-hidden="true" />
      )}
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  description,
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 py-16 text-center",
        className,
      )}
    >
      <p className="font-medium text-destructive">{title}</p>
      {description && (
        <p className="max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action}
    </div>
  );
}

// The error state for any failed connector call: pass `result.error` (or the
// query error it was rethrown as). A DLP/ACP policy block names the policy;
// anything else stays generic.
export function ConnectorErrorState({
  error,
  connector,
  action,
  className,
}: {
  error: unknown;
  connector: string;
  action?: ReactNode;
  className?: string;
}) {
  const blocked = isConnectorPolicyBlock(error);
  return (
    <ErrorState
      title={blocked ? "Blocked by your organization's policy" : undefined}
      description={connectorErrorMessage(error, connector)}
      action={blocked ? undefined : action}
      className={className}
    />
  );
}

// Generic-shape loading fallback. For a table, card grid, or chart, write a
// Skeleton that MIRRORS the final layout instead — shaped skeletons read as
// intentional; uniform rows everywhere look generic.
export function LoadingState({
  rows = 3,
  className,
  label = "Loading",
}: {
  rows?: number;
  className?: string;
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("space-y-3", className)}
    >
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </p>
      <div aria-hidden="true" className="space-y-3">{Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-lg" />
      ))}</div>
    </div>
  );
}

export function ChartLoadingState({ label }: { label: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-card p-5 sm:p-6">
      <p role="status" aria-live="polite" className="flex items-center gap-2 text-sm font-medium">
        <LoaderCircle className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        Reading Azure offerings and preparing the regional analysis. Large VM catalogs can take a moment.
      </p>
      <div aria-hidden="true" className="mt-6 space-y-4">
        {[72, 90, 58, 80, 46, 65].map((width, index) => (
          <div key={index} className="flex items-center gap-4">
            <Skeleton className="h-3 w-16 shrink-0 sm:w-24" />
            <Skeleton className="h-6 rounded-sm" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
