import type { ArmEnvironment } from "./arm-config.ts";

export function getRouterBasename(baseUrl: string, pathname: string, mode: ArmEnvironment["mode"]): string {
  const buildBase = baseUrl.replace(/\/$/, "");
  if (
    buildBase &&
    buildBase.startsWith("/") &&
    (pathname === buildBase || pathname.startsWith(buildBase + "/"))
  ) {
    return buildBase;
  }
  // Standalone routes are rooted at the origin, not mounted at their first route segment.
  if (mode !== "managed") return "/";
  const parts = pathname.split("/").filter(Boolean);
  return parts.length ? `/${parts[0]}/` : "/";
}
