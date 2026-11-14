import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { ArmReadError, fetchArmList, fetchArmSubscription } from "../src/lib/arm-http.ts";
import { dashboardItems } from "../scripts/dashboard-items.mjs";
import retailPrices from "../api/retail-prices/index.cjs";

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const oidClaim = "http://schemas.microsoft.com/identity/claims/objectidentifier";
const tidClaim = "http://schemas.microsoft.com/identity/claims/tenantid";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };

export class HostedError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function hostedConfig(env) {
  const { PLANNER_SUBSCRIPTION_ID: subscription, PLANNER_TENANT_ID: tenant, PLANNER_ALLOWED_USER_IDS: users, WEBSITE_SITE_NAME: site } = env;
  const allowedUsers = (users ?? "").split(",").map((id) => id.trim().toLowerCase());
  if (!site || !guid.test(subscription ?? "") || !guid.test(tenant ?? "") ||
    !allowedUsers.length || allowedUsers.some((id) => !guid.test(id))) {
    throw new Error("App Service and explicit subscription, tenant and user allowlist configuration are required.");
  }
  return { subscription: subscription.toLowerCase(), tenant: tenant.toLowerCase(), allowedUsers };
}

export function authorizedPrincipal(headers, config) {
  const encoded = headers["x-ms-client-principal"];
  if (typeof encoded !== "string" || encoded.length > 32768) throw new HostedError(401, "authentication", "Sign in through App Service.");
  let principal;
  try { principal = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); }
  catch { throw new HostedError(401, "authentication", "Invalid App Service session."); }
  if (!principal || typeof principal !== "object") throw new HostedError(401, "authentication", "Invalid App Service session.");
  const claims = Array.isArray(principal.claims) ? principal.claims : [];
  const values = (names) => claims.filter((claim) => names.includes(claim?.typ)).map((claim) => claim.val);
  const tenants = values([tidClaim, "tid"]);
  const identities = values([oidClaim, "oid"]);
  if (principal.auth_typ !== "aad" || !tenants.length || !identities.length ||
    tenants.some((id) => typeof id !== "string" || id.toLowerCase() !== config.tenant) ||
    identities.some((id) => typeof id !== "string" || id.toLowerCase() !== identities[0].toLowerCase()) ||
    !config.allowedUsers.includes(identities[0].toLowerCase())) {
    throw new HostedError(403, "authorization", "This identity is not authorized to use the planner.");
  }
  return identities[0].toLowerCase();
}

export function hostedRequest(url, config) {
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !["kind", "subscriptionId", "region", "refresh"].includes(key)) ||
    (url.searchParams.has("refresh") && url.searchParams.get("refresh") !== "1")) {
    throw new HostedError(400, "request", "Only exact planner read parameters are supported.");
  }
  const count = keys.length - (url.searchParams.has("refresh") ? 1 : 0);
  const refresh = url.searchParams.has("refresh") ? { refresh: true } : {};
  const kind = url.searchParams.get("kind");
  if (kind === "subscriptions" && count === 1) return { kind, ...refresh };
  if (!["regions", "skus", "quota"].includes(kind) ||
    url.searchParams.get("subscriptionId")?.toLowerCase() !== config.subscription ||
    count !== (kind === "quota" ? 3 : 2) ||
    (kind === "quota" && !/^[a-z][a-z0-9]{0,62}$/.test(url.searchParams.get("region") ?? ""))) {
    throw new HostedError(400, "request", "Select the configured subscription and a valid planner read.");
  }
  return { kind, subscriptionId: config.subscription, ...(kind === "quota" ? { region: url.searchParams.get("region") } : {}), ...refresh };
}

export function managedIdentityToken(env, fetcher = fetch, now = Date.now) {
  let token;
  let pending;
  return async () => {
    if (token && token.expires > now() + 120000) return token.value;
    if (pending) return pending;
    pending = (async () => {
      if (!env.IDENTITY_ENDPOINT || !env.IDENTITY_HEADER) throw new HostedError(503, "identity", "The backend managed identity is unavailable.");
      const url = new URL(env.IDENTITY_ENDPOINT);
      url.searchParams.set("api-version", "2019-08-01");
      url.searchParams.set("resource", "https://management.azure.com/");
      const response = await fetcher(url, {
        headers: { "X-IDENTITY-HEADER": env.IDENTITY_HEADER }, redirect: "error", signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new HostedError(503, "identity", "The backend managed identity could not authenticate.");
      const data = await response.json();
      const expires = Number(data.expires_on) * 1000;
      if (typeof data.access_token !== "string" || !data.access_token || !Number.isFinite(expires) || expires <= now() + 120000) {
        throw new HostedError(503, "identity", "The backend managed identity returned invalid token metadata.");
      }
      token = { value: data.access_token, expires };
      return token.value;
    })();
    try { return await pending; } finally { pending = undefined; }
  };
}

export function boundedArmFetch(fetcher = fetch, limit = 200 * 1024 * 1024) {
  let size = 0;
  return async (url, options) => {
    const response = await fetcher(url, options);
    if (!response.ok) return response;
    if (Number(response.headers.get("content-length")) + size > limit) {
      await response.body?.cancel();
      throw new HostedError(502, "size", "Azure returned a response exceeding the planner size bound.");
    }
    const chunks = [];
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > limit) throw new HostedError(502, "size", "Azure returned a response exceeding the planner size bound.");
      chunks.push(chunk);
    }
    return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
  };
}

export function createPlannerServer({ config, getToken, fetcher, now = Date.now, distRoot = root, log = console } = {}) {
  const cache = new Map();
  const pending = new Map();
  let priceReads = 0;
  async function read(request) {
    const { refresh, ...armRequest } = request;
    const key = JSON.stringify(armRequest);
    const saved = cache.get(key);
    if (!refresh && saved && saved.until > now()) return { ...saved.result, cached: true };
    if (pending.has(key)) return pending.get(key);
    if (pending.size >= 3) throw new HostedError(429, "busy", "Three Azure reads are active. Retry after they finish.");
    const work = (async () => {
      const signal = AbortSignal.timeout(180000);
      const readFetch = fetcher ?? boundedArmFetch();
      const items = request.kind === "subscriptions"
        ? [await fetchArmSubscription(config.subscription, getToken, signal, readFetch)]
        : await fetchArmList(armRequest, getToken, signal, readFetch);
      const result = { items: dashboardItems(request.kind, items), fetchedAt: new Date(now()).toISOString(), cached: false };
      const age = request.kind === "skus" ? 15 * 60000 : request.kind === "quota" ? 5 * 60000 : 60 * 60000;
      if (cache.size >= 64) cache.delete(cache.keys().next().value);
      cache.set(key, { result, until: now() + age });
      return result;
    })();
    pending.set(key, work);
    try { return await work; } finally { pending.delete(key); }
  }
  return createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'");
    const json = (status, data) => {
      res.statusCode = status;
      res.setHeader("Content-Type", "application/json");
      const body = Buffer.from(JSON.stringify(data));
      if (body.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "")) {
        res.setHeader("Content-Encoding", "gzip");
        res.setHeader("Vary", "Accept-Encoding");
        res.end(gzipSync(body));
      } else res.end(body);
    };
    try {
      if ((req.url?.length ?? 0) > 2500) throw new HostedError(414, "request", "The planner URL is too long.");
      const url = new URL(req.url, "http://planner.internal");
      if (url.pathname === "/healthz" && req.method === "GET") return json(200, { status: "ok" });
      const identity = authorizedPrincipal(req.headers, config);
      if (!["GET", "HEAD"].includes(req.method) || req.headers["transfer-encoding"] ||
        (req.headers["content-length"] && req.headers["content-length"] !== "0")) {
        throw new HostedError(405, "method", "The planner accepts read-only requests without bodies.");
      }
      if (req.headers.origin && req.headers.origin !== `https://${req.headers.host}`) {
        throw new HostedError(403, "origin", "Cross-origin reads are not supported.");
      }
      if (url.pathname.startsWith("/api/") && req.method !== "GET") throw new HostedError(405, "method", "API reads require GET.");
      if (url.pathname === "/api/session") return json(200, { identity, tenant: config.tenant, subscriptionId: config.subscription });
      if (url.pathname === "/api/arm") return json(200, await read(hostedRequest(url, config)));
      if (url.pathname === "/api/retail-prices") {
        if (priceReads >= 3) throw new HostedError(429, "busy", "Three price reads are active. Retry after they finish.");
        const context = { warn: () => log.warn("Retail price upstream failed."), error: () => log.error("Retail price proxy failed.") };
        priceReads++;
        try { await retailPrices(context, { method: req.method, url: url.href }); }
        finally { priceReads--; }
        res.statusCode = context.res.status;
        res.setHeader("Content-Type", "application/json");
        res.end(context.res.body);
        return;
      }
      if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.auth/")) throw new HostedError(404, "route", "Unknown planner endpoint.");
      const pathname = decodeURIComponent(url.pathname);
      const file = path.resolve(distRoot, `.${pathname}`);
      if (!file.startsWith(`${path.resolve(distRoot)}${path.sep}`) && file !== path.resolve(distRoot)) throw new HostedError(404, "route", "Unknown file.");
      const fallback = ["/", "/charts", "/cost", "/shortlist", "/scenarios"].includes(pathname);
      const target = fallback ? path.join(distRoot, "index.html") : file;
      let info;
      try { info = await stat(target); } catch (error) {
        if (error.code === "ENOENT") throw new HostedError(404, "route", "Unknown file.");
        throw error;
      }
      if (!info.isFile() || !mime[path.extname(target)]) throw new HostedError(404, "route", "Unknown file.");
      res.setHeader("Content-Type", mime[path.extname(target)]);
      res.end(req.method === "HEAD" ? undefined : await readFile(target));
    } catch (error) {
      const status = error instanceof HostedError ? error.status : error?.name === "TimeoutError" ? 504 : 502;
      const message = error instanceof HostedError ? error.message
        : error instanceof ArmReadError && ["http-401", "http-403"].includes(error.code)
          ? "Azure denied the backend managed identity. The app owner must check its Reader role on the configured subscription."
          : error instanceof ArmReadError ? error.message : "The backend could not complete this read. Retry or contact the app owner.";
      log.error("Planner request failed.", status, error instanceof ArmReadError || error instanceof HostedError ? error.code : "backend");
      if (!res.headersSent) json(status, { error: message });
      else res.end();
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = hostedConfig(process.env);
  const server = createPlannerServer({ config, getToken: managedIdentityToken(process.env) });
  server.requestTimeout = 190000;
  server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () => console.log("Planner backend ready; App Service authentication and explicit identity allowlist required."));
}
