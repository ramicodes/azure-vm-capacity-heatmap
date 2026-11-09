import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "motion/react";
import { Toaster } from "@/components/ui/sonner";
import { routes } from "@/routes";
import { cn } from "@/lib/utils";

function CapacityMark() {
  // 3x3 heat grid mark — app identity
  const shades = [
    "fill-emerald-200", "fill-emerald-400", "fill-emerald-700",
    "fill-emerald-400", "fill-emerald-700", "fill-emerald-900",
    "fill-emerald-100", "fill-emerald-400", "fill-emerald-700",
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
  const { pathname } = useLocation();
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#heatmap"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2.5 px-4 sm:px-6">
          <CapacityMark />
          <span className="text-sm font-semibold tracking-tight">Azure VM Capacity Heatmap</span>
          <nav aria-label="Pages" className="ml-4 flex h-full items-stretch gap-1">
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
                        "flex items-center gap-1.5 border-b-2 px-2.5 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                        isActive
                          ? "border-primary font-medium text-foreground"
                          : "border-transparent text-muted-foreground hover:text-foreground",
                      )
                    }
                  >
                    {Icon && <Icon className="size-4" aria-hidden="true" />}
                    {r.label}
                  </NavLink>
                );
              })}
          </nav>
        </div>
      </header>
      <main className="flex flex-1 flex-col">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: "easeOut" }}
          className="flex-1"
        >
          <Outlet />
        </motion.div>
      </main>
      <Toaster />
    </div>
  );
}

export default AppShell;
