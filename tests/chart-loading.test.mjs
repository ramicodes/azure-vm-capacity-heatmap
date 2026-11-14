import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { Window } from "happy-dom";

test("chart generation and background refresh have accessible feedback without discarding results", async (t) => {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const window = new Window({ url: "http://localhost:5173" });
  const saved = new Map(["window", "document", "navigator"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries({ window, document: window.document, navigator: window.navigator })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  t.after(() => {
    window.happyDOM.abort();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const vite = await createServer({
    configFile: false, root,
    resolve: { alias: { "@": path.join(root, "src") } },
    ssr: { noExternal: ["@microsoft/managed-apps"] },
    esbuild: { jsx: "automatic" }, server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  t.after(() => vite.close());
  const { ChartLoadingState } = await vite.ssrLoadModule("/src/components/states.tsx");
  const { OfferSummaryChart } = await vite.ssrLoadModule("/src/components/offer-summary-chart.tsx");
  const { RefreshControl } = await vite.ssrLoadModule("/src/components/scope-controls.tsx");
  const container = window.document.createElement("div");
  const render = (component, props) => {
    container.innerHTML = renderToStaticMarkup(createElement(component, props));
    return container;
  };
  await t.test("initial generation names the operation for screen readers", () => {
    render(ChartLoadingState, { label: "Generating workload fit charts..." });
    const status = container.querySelector('[role="status"]');
    assert.match(status.textContent, /Generating workload fit charts/);
    assert.equal(status.getAttribute("aria-live"), "polite");
  });
  const offers = [
    { key: "Standard_NC6|eastus", region: "eastus", status: "available" },
    { key: "Standard_NC12|eastus", region: "eastus", status: "restricted" },
  ];
  const scope = {
    view: "availability", refreshing: true, regionOffers: offers, seriesOffers: offers,
    regions: { data: new Map([["eastus", { name: "eastus", displayName: "East US" }]]) },
    capacity: { isFetching: false, data: { cached: false, fetchedAt: new Date("2026-01-01T00:00:00Z") } },
    subId: "subscription", refetchAll() {},
  };
  await t.test("a background refresh preserves the chart and announces the pending update", () => {
    render(OfferSummaryChart, { scope });
    assert.match(container.textContent, /Subscription eligibility by region/);
    assert.match(container.textContent, /All 1/);
    assert.match(container.querySelector('[role="status"]').textContent, /previous chart stays visible/);
    assert.equal(container.querySelector('[data-slot="chart"]').getAttribute("aria-busy"), "true");
    render(OfferSummaryChart, { scope: { ...scope, refreshing: false } });
    assert.equal(container.querySelector('[data-slot="chart"]').getAttribute("aria-busy"), "false");
    assert.match(container.querySelector('[role="status"]').textContent, /1 of 1 regions displayed/);
    assert.doesNotMatch(container.textContent, /Refreshing Azure data/);
  });
  await t.test("refresh stays disabled when scope reads continue after the catalog completes", () => {
    render(RefreshControl, { scope });
    assert.equal(container.querySelector("button").disabled, true);
    assert.match(container.querySelector("button").textContent, /Refreshing data/);
    render(RefreshControl, { scope: { ...scope, refreshing: false } });
    assert.equal(container.querySelector("button").disabled, false);
    assert.match(container.querySelector("button").textContent, /Refresh data/);
  });
});
