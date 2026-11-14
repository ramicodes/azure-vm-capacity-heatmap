import type { VmOffer } from "./azure-capacity";

export const MAX_PRICING_SKUS = 50;
export const PRICING_CONCURRENCY = 3;
const MAX_PRICE_PAGES = 5;
const MAX_PRICE_ITEMS = 10_000;
const RETAIL_API = "https://prices.azure.com/api/retail/prices";
const RETAIL_API_VERSION = "2023-01-01-preview";
const APP_BASE_URL = typeof window === "undefined" ? "/" : import.meta.env.BASE_URL;

export function retailPriceProxyUrl(apiUrl: string, basePath = APP_BASE_URL): string {
  const base = basePath.endsWith("/") ? basePath : `${basePath}/`;
  return `${base}api/retail-prices${new URL(apiUrl).search}`;
}

export interface RetailPriceRecord {
  armSkuName: string;
  armRegionName: string;
  currencyCode: string;
  retailPrice: number;
  effectiveStartDate: string;
  meterName: string;
  productName: string;
  serviceName: string;
  type: string;
  unitOfMeasure: string;
}

export class RetailPriceError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeIdentifier(value: string, pattern: RegExp, label: string) {
  if (!pattern.test(value)) throw new RetailPriceError(`The ${label} is invalid.`);
}

export function buildRetailPriceUrl(sku: string, region: string): string {
  safeIdentifier(sku, /^[A-Za-z0-9._-]{1,120}$/, "VM size");
  safeIdentifier(region, /^[a-z0-9-]{1,64}$/, "region");
  const url = new URL(RETAIL_API);
  url.searchParams.set("api-version", RETAIL_API_VERSION);
  url.searchParams.set(
    "$filter",
    `serviceName eq 'Virtual Machines' and armSkuName eq '${sku}' and armRegionName eq '${region}' and priceType eq 'Consumption'`,
  );
  url.searchParams.set("$top", "1000");
  return url.toString();
}

function parseRetailPricePage(value: unknown): { items: RetailPriceRecord[]; nextPageLink: string | null } {
  if (!isRecord(value) || !Array.isArray(value.Items)) {
    throw new RetailPriceError("Azure Retail Prices returned an unexpected response.");
  }
  const items = value.Items.flatMap((item): RetailPriceRecord[] => {
    if (!isRecord(item)) return [];
    const {
      armSkuName, armRegionName, currencyCode, retailPrice, effectiveStartDate,
      meterName, productName, serviceName, type, unitOfMeasure,
    } = item;
    if (
      typeof armSkuName !== "string" || typeof armRegionName !== "string" ||
      typeof currencyCode !== "string" || typeof retailPrice !== "number" ||
      !Number.isFinite(retailPrice) || retailPrice < 0 ||
      typeof effectiveStartDate !== "string" || typeof meterName !== "string" ||
      typeof productName !== "string" || typeof serviceName !== "string" ||
      typeof type !== "string" || typeof unitOfMeasure !== "string"
    ) return [];
    return [{
      armSkuName, armRegionName, currencyCode, retailPrice, effectiveStartDate,
      meterName, productName, serviceName, type, unitOfMeasure,
    }];
  });
  if (items.length > MAX_PRICE_ITEMS) {
    throw new RetailPriceError("Azure Retail Prices returned too many records.");
  }
  const nextPageLink = value.NextPageLink;
  if (nextPageLink !== null && nextPageLink !== undefined && typeof nextPageLink !== "string") {
    throw new RetailPriceError("Azure Retail Prices returned an invalid continuation link.");
  }
  return { items, nextPageLink: typeof nextPageLink === "string" ? nextPageLink : null };
}

function validateNextPageLink(link: string, currentUrl: string): string {
  let next: URL;
  try {
    next = new URL(link, currentUrl);
  } catch {
    throw new RetailPriceError("Azure Retail Prices returned an invalid continuation link.");
  }
  if (
    next.origin !== new URL(RETAIL_API).origin || next.pathname !== new URL(RETAIL_API).pathname ||
    next.username || next.password || next.hash ||
    next.searchParams.get("api-version") !== RETAIL_API_VERSION
  ) {
    throw new RetailPriceError("Azure Retail Prices returned an unsupported continuation link.");
  }
  return next.toString();
}

async function fetchRetailPriceRecords(
  sku: string,
  region: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<RetailPriceRecord[]> {
  let nextUrl: string | null = buildRetailPriceUrl(sku, region);
  const visited = new Set<string>();
  const records: RetailPriceRecord[] = [];
  let pageCount = 0;
  while (nextUrl) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (visited.has(nextUrl) || pageCount >= MAX_PRICE_PAGES) {
      throw new RetailPriceError("Azure Retail Prices pagination exceeded its safety limit.");
    }
    visited.add(nextUrl);
    pageCount++;
    let response: Response;
    try {
      response = await fetcher(retailPriceProxyUrl(nextUrl), {
        signal,
        headers: { Accept: "application/json" },
        credentials: "omit",
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      throw error;
    }
    if (!response.ok) throw new RetailPriceError("Azure Retail Prices is unavailable. Retry the comparison.");
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RetailPriceError("Azure Retail Prices returned invalid JSON.");
    }
    const page = parseRetailPricePage(body);
    records.push(...page.items);
    if (records.length > MAX_PRICE_ITEMS) {
      throw new RetailPriceError("Azure Retail Prices returned too many records.");
    }
    nextUrl = page.nextPageLink ? validateNextPageLink(page.nextPageLink, nextUrl) : null;
  }
  return records;
}

export async function fetchRetailPricesForOffers(
  offers: readonly Pick<VmOffer, "sku">[],
  region: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, RetailPriceRecord[]>> {
  const skus = [...new Set(offers.map((offer) => offer.sku))].sort();
  if (skus.length > MAX_PRICING_SKUS) {
    throw new RetailPriceError(`Pricing is limited to ${MAX_PRICING_SKUS} VM sizes at a time.`);
  }
  const results = new Map<string, RetailPriceRecord[]>();
  let next = 0;
  let failed = false;
  async function worker() {
    while (!signal.aborted && !failed) {
      const sku = skus[next++];
      if (!sku) return;
      try {
        results.set(sku, await fetchRetailPriceRecords(sku, region, signal, fetcher));
      } catch {
        if (!signal.aborted) failed = true;
        return;
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(PRICING_CONCURRENCY, skus.length) },
    () => worker(),
  ));
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (failed) throw new RetailPriceError("Azure Retail Prices could not return complete data. Retry the comparison.");
  return results;
}

export function selectRetailPrice(
  records: readonly RetailPriceRecord[],
  sku: string,
  region: string,
  operatingSystem: "linux" | "windows",
  now: Date = new Date(),
): RetailPriceRecord | null {
  const currentTime = now.getTime();
  return records
    .filter((record) => {
      const effectiveTime = Date.parse(record.effectiveStartDate);
      const meter = `${record.meterName} ${record.productName}`.toLowerCase();
      const isWindows = record.productName.toLowerCase().includes("windows");
      return record.armSkuName === sku && record.armRegionName === region &&
        record.serviceName === "Virtual Machines" && record.type === "Consumption" &&
        record.unitOfMeasure === "1 Hour" && record.currencyCode === "USD" &&
        Number.isFinite(record.retailPrice) && record.retailPrice >= 0 &&
        Number.isFinite(effectiveTime) && effectiveTime <= currentTime &&
        !/\bspot\b|\blow priority\b/.test(meter) &&
        (operatingSystem === "windows" ? isWindows : !isWindows);
    })
    .sort((a, b) => Date.parse(b.effectiveStartDate) - Date.parse(a.effectiveStartDate))[0] ?? null;
}

export function estimateMonthlyCost(hourlyPrice: number, vmCount: number, hoursPerMonth: number): number | null {
  if (
    !Number.isFinite(hourlyPrice) || hourlyPrice < 0 ||
    !Number.isSafeInteger(vmCount) || vmCount < 1 ||
    !Number.isSafeInteger(hoursPerMonth) || hoursPerMonth < 1 || hoursPerMonth > 744
  ) return null;
  const total = hourlyPrice * vmCount * hoursPerMonth;
  return Number.isFinite(total) ? total : null;
}

export const MAX_MONTHLY_HOURS = 744;
