import { NavLink, Outlet } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";
import { BrowserUtils } from "@azure/msal-browser";
import { AzureAccess, AzurePopupCallback } from "@/components/azure-access";

function CapacityMark() {
  const shades = [
    "fill-white/40", "fill-white/70", "fill-white",
    "fill-white/70", "fill-white", "fill-white/90",
    "fill-white/30", "fill-white/70", "fill-white",
  ];
  return (
    <svg viewBox="0 0 22 22" className="size-6" aria-hidden="true">
      {shades.map((c, i) => (
        <rect key={i} x={(i % 3) * 7.5} y={Math.floor(i / 3) * 7.5} width="6.5" height="6.5" rx="1.2" className={c} />
      ))}
    </svg>
  );
}

export function AppShell() {
  if (BrowserUtils.isInPopup()) return <AzurePopupCallback />;
  return (
    <div className="planner-app flex min-h-screen flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="planner-header sticky top-0 z-40">
        <div className="flex min-h-16 items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <CapacityMark />
            <span className="text-sm font-semibold leading-5 sm:text-base">Azure VM Capacity Planner</span>
          </div>
          <span className="hidden shrink-0 items-center gap-2 text-sm sm:inline-flex">
            <ShieldCheck className="size-4" aria-hidden="true" />
            Read-only planning
          </span>
        </div>
      </header>
      <div className="mx-auto grid w-full max-w-[1920px] flex-1 lg:grid-cols-[216px_minmax(0,1fr)]">
        <aside className="planner-navigation min-w-0 border-b border-border lg:sticky lg:top-16 lg:self-start lg:border-0 lg:px-3 lg:py-6">
          <nav aria-label="Pages" className="flex min-w-0 gap-1 overflow-x-auto px-3 py-2 lg:flex-col lg:overflow-visible lg:p-0">
            {routes
              .filter((r) => r.label)
              .map((r) => {
                const Icon = r.icon;
                return (
                  <NavLink
                    key={r.path}
                    to={r.path}
                    end={r.path === "/"}
                    className={({ isActive }) =>
                      cn(
                        "planner-nav-link relative flex shrink-0 items-center gap-2.5 rounded-md px-3 py-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                        isActive
                          ? "bg-accent font-semibold text-primary"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )
                    }
                  >
                    {Icon && <Icon className="size-4" aria-hidden="true" />}
                    {r.label}
                  </NavLink>
                );
              })}
          </nav>
          <p className="mx-3 mt-8 hidden border-t border-border pt-4 text-xs leading-5 text-muted-foreground lg:block">
            Compare eligibility, workload fit and quota. Published availability does not guarantee allocation.
          </p>
        </aside>
        <main id="main-content" tabIndex={-1} className="planner-main m-0 min-w-0 outline-none lg:my-6 lg:mr-6">
          <AzureAccess><Outlet /></AzureAccess>
        </main>
      </div>
      <Toaster />
    </div>
  );
}

export default AppShell;
