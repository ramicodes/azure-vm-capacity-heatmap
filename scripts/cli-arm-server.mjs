import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { ArmReadError, fetchArmList, fetchArmSubscription } from "../src/lib/arm-http.ts";
import { subscriptionScope } from "../src/lib/subscription-scope.ts";

export const CLI_HOST = "127.0.0.1:5174";
export const DASHBOARD_ORIGIN = "http://127.0.0.1:5173";
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const csrfHeader = "x-dashboard-csrf";
const sessionHeader = "x-dashboard-session";
const sessionLifetime = 30 * 60_000;

const text = "text";
const number = "number";
const projections = {
  subscriptions: { subscriptionId: text, displayName: text, state: text },
  regions: { name: text, displayName: text, metadata: { geographyGroup: text } },
  skus: {
    name: text, size: text, family: text, resourceType: text, locations: [text],
    capabilities: [{ name: text, value: text }],
    locationInfo: [{ location: text, zones: [text] }],
    restrictions: [{ type: text, reasonCode: text, values: [text], restrictionInfo: { locations: [text], zones: [text] } }],
  },
  quota: { name: { value: text, localizedValue: text }, unit: text, currentValue: number, limit: number },
};

function project(value, schema) {
  if (schema === text) return typeof value === "string" ? value : undefined;
  if (schema === number) return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  if (Array.isArray(schema)) return Array.isArray(value) ? value.map((item) => project(item, schema[0])).filter((item) => item !== undefined) : undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return Object.fromEntries(Object.entries(schema).map(([key, child]) => [key, project(value[key], child)]).filter(([, child]) => child !== undefined));
}

export function dashboardItems(kind, items) {
  return items.map((item) => project(item, projections[kind])).filter((item) => item !== undefined);
}

export class CliBridgeError extends ArmReadError {
  constructor(code, message, status = 400) {
    super(code, message);
    this.status = status;
  }
}

export function cliFailure(error) {
  if (error?.name === "AbortError") return new CliBridgeError("cancelled", "The local CLI read was cancelled.", 499);
  if (error?.code === "ENOENT") return new CliBridgeError("cli-missing", "Azure CLI was not found. Install the official CLI, then restart the bridge.", 503);
  if (error?.killed || error?.code === "ETIMEDOUT") return new CliBridgeError("cli-timeout", "Azure CLI timed out. Check its current login and try again.", 504);
  // Classify locally; never return CLI stderr, which may contain identity or credential details.
  const text = String(error?.stderr ?? "").toLowerCase();
  if (/az login|please run|expired|interaction_required|aadsts|consent/.test(text)) {
    return new CliBridgeError("cli-login", "Azure CLI needs an authorized login or policy approval. Review it in your own terminal; this dashboard never runs az login.", 401);
  }
  return new CliBridgeError("cli-failed", "Azure CLI could not read its authorized context. Check az account show and organizational policy in your terminal.", 503);
}

export function cliInvocation(platform = process.platform, env = process.env) {
  if (platform !== "win32") return { file: "az", prefix: [] };
  const root = env.ProgramFiles || "C:\\Program Files";
  const python = path.win32.join(root, "Microsoft SDKs", "Azure", "CLI2", "python.exe");
  if (!existsSync(python)) throw new CliBridgeError("cli-missing", "The official Azure CLI MSI Python executable was not found. Install the official CLI and restart the bridge.", 503);
  return { file: python, prefix: ["-IBm", "azure.cli"] };
}

export function createCliRunner(invocation, execute = execFile) {
  return (args, signal) => new Promise((resolve, reject) => {
    execute(invocation.file, [...invocation.prefix, ...args, "--output", "json", "--only-show-errors"], {
      shell: false, windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024, signal,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(cliFailure({ ...error, name: error.name, stderr }));
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch {
        reject(new CliBridgeError("cli-shape", "Azure CLI returned unexpected metadata. No credentials or partial results were returned.", 502));
      }
    });
  });
}

export function cliContext(raw) {
  if (!raw || raw.environmentName !== "AzureCloud" || !guid.test(raw.tenantId) || !guid.test(raw.id) ||
      raw.user?.type !== "user" || typeof raw.user.name !== "string" || !raw.user.name) {
    throw new CliBridgeError("cli-context", "Use an authorized Azure public-cloud user context in Azure CLI. Other clouds and credential types are not supported.", 409);
  }
  return { tenant: raw.tenantId.toLowerCase(), subscription: raw.id.toLowerCase(), user: raw.user.name };
}

export function cliReadRequest(url) {
  const keys = [...url.searchParams.keys()];
  if (keys.some((key) => !["kind", "subscriptionId", "region"].includes(key)) ||
      new Set(keys).size !== keys.length) throw new CliBridgeError("request", "Only dashboard read parameters are accepted.");
  const kind = url.searchParams.get("kind");
  const subscriptionId = url.searchParams.get("subscriptionId");
  const region = url.searchParams.get("region");
  if (kind === "subscriptions" && keys.length === 1) return { kind };
  if (!["regions", "skus", "quota"].includes(kind) || !guid.test(subscriptionId ?? "")) {
    throw new CliBridgeError("request", "Choose a valid dashboard endpoint and subscription GUID.");
  }
  if (kind === "quota") {
    if (keys.length !== 3 || !/^[a-z][a-z0-9]{0,62}$/.test(region ?? "")) throw new CliBridgeError("request", "Choose a valid Azure region identifier.");
    return { kind, subscriptionId, region };
  }
  if (keys.length !== 2) throw new CliBridgeError("request", "Unexpected dashboard read parameters.");
  return { kind, subscriptionId };
}

export function checkBoundary(req, host = CLI_HOST) {
  if (req.headers.host !== host || req.headers.origin !== DASHBOARD_ORIGIN ||
      !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
    throw new CliBridgeError("boundary", "Only the configured loopback dashboard origin may use this bridge.", 403);
  }
  if (req.method !== "OPTIONS" && req.headers["x-dashboard-cli"] !== "1") {
    throw new CliBridgeError("boundary", "The dashboard request header is required.", 403);
  }
  if (req.headers["content-length"] && req.headers["content-length"] !== "0" || req.headers["transfer-encoding"]) {
    throw new CliBridgeError("request", "Request bodies are not accepted.");
  }
}

function matches(left, right) {
  return typeof left === "string" && /^[a-f0-9]{64}$/.test(left) &&
    timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

export function createCliBridge({ runCli, fetcher = fetch, now = Date.now, host = CLI_HOST, deadlineMs = 120_000, subscriptionId } = {}) {
  const scope = subscriptionScope(subscriptionId);
  const csrf = randomBytes(32).toString("hex");
  const salt = randomBytes(32).toString("hex");
  const sessions = new Map();
  let inFlight = 0;
  const waiting = [];
  const acquire = (signal) => {
    signal.throwIfAborted();
    if (inFlight < 4) {
      inFlight++;
      return;
    }
    if (waiting.length >= 8) throw new CliBridgeError("busy", "The local CLI request queue is full. Wait for active reads to finish, then retry.", 429);
    return new Promise((resolve, reject) => {
      const grant = () => {
        signal.removeEventListener("abort", cancel);
        resolve();
      };
      const cancel = () => {
        const index = waiting.indexOf(grant);
        if (index !== -1) waiting.splice(index, 1);
        reject(signal.reason);
      };
      waiting.push(grant);
      signal.addEventListener("abort", cancel, { once: true });
    });
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  };
  const fingerprint = (context) => createHash("sha256").update(salt + JSON.stringify(context)).digest("hex");
  const context = async (signal) => {
    const current = cliContext(await runCli(["account", "show"], signal));
    if (!scope) return current;
    let target;
    try { target = cliContext(await runCli(["account", "show", "--subscription", scope], signal)); } catch (error) {
      if (signal?.aborted || (error instanceof CliBridgeError && ["cli-timeout", "cli-missing", "cli-context"].includes(error.code))) throw error;
      throw new CliBridgeError("subscription-unavailable", "The configured subscription is unavailable in the authorized CLI profiles. Check its access in your terminal; no other subscription was used.", 403);
    }
    if (target.subscription.toLowerCase() !== scope) throw new CliBridgeError("subscription-scope", "Azure CLI did not resolve the exact configured subscription.", 409);
    return { ...target, subscription: scope, current };
  };
  const checkSession = async (id, signal) => {
    const saved = sessions.get(id);
    if (!saved || saved.expires <= now()) {
      sessions.delete(id);
      throw new CliBridgeError("session", "The local CLI session expired or disconnected. Connect again.", 401);
    }
    let active;
    try { active = await context(signal); } catch (error) {
      if (!signal.aborted) sessions.delete(id);
      throw error;
    }
    if (fingerprint(active) !== saved.fingerprint) {
      sessions.delete(id);
      throw new CliBridgeError("context-changed", "Azure CLI account, tenant or default subscription changed. Dashboard data was discarded; connect again.", 409);
    }
    return active;
  };
  const server = createServer(async (req, res) => {
    let admitted = false;
    let timedOut = false;
    const controller = new AbortController();
    req.once("aborted", () => controller.abort());
    res.once("close", () => { if (!res.writableEnded) controller.abort(); });
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, deadlineMs);
    const send = (status, data) => {
      if (res.destroyed) return;
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-site",
        "Access-Control-Allow-Origin": DASHBOARD_ORIGIN, "Vary": "Origin" });
      res.end(JSON.stringify(data));
    };
    try {
      checkBoundary(req, host);
      if (req.method === "OPTIONS") {
        const headers = String(req.headers["access-control-request-headers"] ?? "").toLowerCase().split(",").map((h) => h.trim()).filter(Boolean);
        if (!["GET", "POST"].includes(req.headers["access-control-request-method"]) ||
            headers.some((h) => !["x-dashboard-cli", csrfHeader, sessionHeader].includes(h))) {
          throw new CliBridgeError("boundary", "Preflight request is not permitted.", 403);
        }
        res.writeHead(204, { "Access-Control-Allow-Origin": DASHBOARD_ORIGIN, "Vary": "Origin",
          "Access-Control-Allow-Methods": "GET, POST",
          "Access-Control-Allow-Headers": "X-Dashboard-Cli, X-Dashboard-Csrf, X-Dashboard-Session",
          "Cache-Control": "no-store" });
        res.end();
        return;
      }
      const url = new URL(req.url, `http://${host}`);
      if (url.origin !== `http://${host}` || url.hash) throw new CliBridgeError("request", "Invalid local route.");
      await acquire(controller.signal);
      admitted = true;
      const { signal } = controller;
      signal.throwIfAborted();
      if (req.method === "GET" && url.pathname === "/status" && !url.search) {
        const id = req.headers[sessionHeader];
        if (id) await checkSession(id, signal);
        send(200, { csrf, connected: !!id, subscriptionScope: scope });
        return;
      }
      if (req.method === "POST") {
        if (!matches(req.headers[csrfHeader], csrf)) throw new CliBridgeError("csrf", "Refresh the dashboard's local bridge session and retry.", 403);
        if (url.pathname === "/connect" && !url.search) {
          const active = await context(signal);
          for (const [id, saved] of sessions) if (saved.expires <= now()) sessions.delete(id);
          sessions.delete(req.headers[sessionHeader]);
          if (sessions.size >= 8) throw new CliBridgeError("sessions", "Too many local sessions. Disconnect unused dashboards or restart the bridge.", 429);
          const id = randomBytes(32).toString("hex");
          sessions.set(id, { fingerprint: fingerprint(active), expires: now() + sessionLifetime });
          send(200, { session: id, tenant: active.tenant, subscriptionScope: scope,
            ...(!scope ? { defaultSubscription: active.subscription } : {}) });
          return;
        }
        if (url.pathname === "/disconnect" && !url.search) {
          sessions.delete(req.headers[sessionHeader]);
          send(200, { disconnected: true });
          return;
        }
        throw new CliBridgeError("method", "Only local session connect/disconnect actions accept POST.", 405);
      }
      if (req.method !== "GET" || url.pathname !== "/read") throw new CliBridgeError("method", "Only allowlisted dashboard GET reads are supported.", 405);
      const request = cliReadRequest(url);
      if (scope && request.kind !== "subscriptions" && request.subscriptionId.toLowerCase() !== scope) {
        throw new CliBridgeError("subscription-scope", "This local bridge is restricted to its configured subscription. Other subscription reads are not permitted.", 403);
      }
      const id = req.headers[sessionHeader];
      const active = await checkSession(id, signal);
      const token = await runCli(["account", "get-access-token", "--resource", "https://management.azure.com/",
        "--subscription", active.subscription], signal);
      if (typeof token?.accessToken !== "string" || !token.accessToken ||
          typeof token.tenant !== "string" || token.tenant.toLowerCase() !== active.tenant ||
          typeof token.subscription !== "string" || token.subscription.toLowerCase() !== active.subscription) {
        sessions.delete(id);
        throw new CliBridgeError("cli-token", "Azure CLI returned credentials for a different or invalid context. Connect again.", 409);
      }
      const guardedFetch = async (...args) => {
        const page = new URL(args[0]);
        const keys = [...page.searchParams.keys()];
        if (page.href.length > 20000 || new Set(keys).size !== keys.length ||
            keys.some((key) => !["api-version", "$skiptoken", "$skipToken", "skiptoken", "skipToken"].includes(key))) {
          throw new CliBridgeError("pagination", "ARM pagination contained unsupported parameters. No partial results were returned.", 502);
        }
        await checkSession(id, signal);
        return fetcher(...args);
      };
      let items;
      try {
        items = scope && request.kind === "subscriptions"
          ? [await fetchArmSubscription(scope, async () => token.accessToken, signal, guardedFetch)]
          : await fetchArmList(request, async () => token.accessToken, signal, guardedFetch);
      } catch (error) {
        if (scope && request.kind === "subscriptions" && error instanceof ArmReadError && ["http-403", "http-404"].includes(error.code)) {
          throw new CliBridgeError("subscription-unavailable", "ARM could not read the configured subscription. Verify its ID and Azure RBAC access; no other subscription was used.", 403);
        }
        throw error;
      }
      await checkSession(id, signal);
      send(200, { value: dashboardItems(request.kind, items) });
    } catch (error) {
      const known = error instanceof CliBridgeError || error instanceof ArmReadError;
      const safe = timedOut ? new CliBridgeError("read-timeout", "The local ARM read exceeded its two-minute deadline. Retry the read; no partial results were returned.", 504)
        : known ? error : new CliBridgeError("bridge", "The local CLI bridge could not complete this read. No partial results were returned.", 502);
      if (["cli-login", "cli-context", "cli-failed", "cli-missing", "cli-timeout", "http-401"].includes(safe.code)) sessions.delete(req.headers[sessionHeader]);
      send(safe.status ?? (safe.code.startsWith("http-") ? Number(safe.code.slice(5)) : 502),
        { code: safe.code, message: safe.message });
    } finally { if (admitted) release(); clearTimeout(timeout); }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Resolve only the installed official CLI; never accept an executable or command from a request.
  let invocation;
  let scope;
  try {
    if (existsSync(".env.local")) loadEnvFile(".env.local");
    scope = subscriptionScope(process.env.ARM_SUBSCRIPTION_ID);
    invocation = cliInvocation();
  } catch (error) {
    console.error(error instanceof ArmReadError ? error.message : "Azure CLI configuration could not be loaded.");
    process.exitCode = 1;
  }
  if (invocation) {
    const server = createCliBridge({ runCli: createCliRunner(invocation), subscriptionId: scope });
    server.on("error", () => { console.error("The CLI bridge could not bind 127.0.0.1:5174. Check whether it is already running."); process.exitCode = 1; });
    server.listen(5174, "127.0.0.1", () => console.log(`Read-only CLI bridge: http://${CLI_HOST}; allowed dashboard: ${DASHBOARD_ORIGIN}`));
  }
}
