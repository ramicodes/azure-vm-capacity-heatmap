import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRetailPriceUrl, estimateMonthlyCost, fetchRetailPricesForOffers,
  RetailPriceError, retailPriceProxyUrl, selectRetailPrice,
} from "../src/lib/azure-pricing.ts";

const meter = (overrides = {}) => ({
  armSkuName: "Standard_D2s_v5",
  armRegionName: "eastus",
  currencyCode: "USD",
  retailPrice: 0.096,
  effectiveStartDate: "2025-01-01T00:00:00Z",
  meterName: "D2s v5",
  productName: "Virtual Machines Dsv5 Series",
  serviceName: "Virtual Machines",
  type: "Consumption",
  unitOfMeasure: "1 Hour",
  ...overrides,
});

test("builds a bounded exact SKU and region public price query", () => {
  const url = new URL(buildRetailPriceUrl("Standard_D2s_v5", "eastus"));
  assert.equal(url.origin, "https://prices.azure.com");
  assert.equal(url.pathname, "/api/retail/prices");
  assert.equal(url.searchParams.get("api-version"), "2023-01-01-preview");
  assert.match(url.searchParams.get("$filter"), /armSkuName eq 'Standard_D2s_v5'/);
  assert.match(url.searchParams.get("$filter"), /armRegionName eq 'eastus'/);
  assert.equal(
    new URL(retailPriceProxyUrl(url.toString(), "/v1/dev/session/"), "http://localhost").pathname,
    "/v1/dev/session/api/retail-prices",
  );
  assert.equal(new URL(retailPriceProxyUrl(url.toString(), "/"), "http://localhost").pathname, "/api/retail-prices");
  assert.throws(() => buildRetailPriceUrl("SKU' or true", "eastus"), RetailPriceError);
  assert.throws(() => buildRetailPriceUrl("Standard_D2s_v5", "eastus/evil"), RetailPriceError);
});

test("selects only current matching hourly USD consumption meters", () => {
  const rows = [
    meter(),
    meter({ retailPrice: 0.05, meterName: "Spot D2s v5" }),
    meter({ retailPrice: 0.08, currencyCode: "EUR" }),
    meter({ retailPrice: 0.07, effectiveStartDate: "2027-01-01T00:00:00Z" }),
    meter({ retailPrice: 0.11, effectiveStartDate: "2025-06-01T00:00:00Z" }),
    meter({ productName: "Virtual Machines Dsv5 Series Windows", retailPrice: 0.2 }),
  ];
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(selectRetailPrice(rows, "Standard_D2s_v5", "eastus", "linux", now)?.retailPrice, 0.11);
  assert.equal(selectRetailPrice(rows, "Standard_D2s_v5", "eastus", "windows", now)?.retailPrice, 0.2);
  assert.equal(selectRetailPrice(rows, "Standard_D2s_v5", "westus", "linux", now), null);
});

test("calculates safe requested-count monthly compute totals", () => {
  assert.equal(estimateMonthlyCost(0.1, 4, 730), 292);
  assert.equal(estimateMonthlyCost(0, 1, 1), 0);
  for (const args of [[-1, 1, 730], [0.1, 0, 730], [0.1, 1.5, 730], [0.1, 1, 745], [Infinity, 1, 730]]) {
    assert.equal(estimateMonthlyCost(...args), null);
  }
});

test("fetches distinct SKU prices with bounded concurrency and omits credentials", async () => {
  let active = 0;
  let maximum = 0;
  const requests = [];
  const fetcher = async (input, init) => {
    requests.push({ input: String(input), init });
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return new Response(JSON.stringify({ Items: [], NextPageLink: null }), { status: 200 });
  };
  const offers = ["A", "B", "A", "C", "D"].map((sku) => ({ sku }));
  const result = await fetchRetailPricesForOffers(offers, "eastus", new AbortController().signal, fetcher);
  assert.deepEqual([...result.keys()].sort(), ["A", "B", "C", "D"]);
  assert.equal(requests.length, 4);
  assert.equal(maximum, 3);
  assert.ok(requests.every(({ init }) => init.credentials === "omit" && init.redirect === "error"));
  assert.ok(requests.every(({ input }) => new URL(input, "http://127.0.0.1").pathname === "/api/retail-prices"));
});

test("rejects oversized pricing requests before making a network call", async () => {
  let called = false;
  const offers = Array.from({ length: 51 }, (_, index) => ({ sku: `SKU${index}` }));
  await assert.rejects(
    fetchRetailPricesForOffers(offers, "eastus", new AbortController().signal, async () => {
      called = true;
      throw new Error("unexpected request");
    }),
    /limited to 50 VM sizes/,
  );
  assert.equal(called, false);
});
