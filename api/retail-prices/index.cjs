const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const FILTER = /^serviceName eq 'Virtual Machines' and armSkuName eq '[A-Za-z0-9._-]{1,120}' and armRegionName eq '[a-z0-9-]{1,64}' and priceType eq 'Consumption'$/;

module.exports = async function retailPrices(context, req) {
  function reply(status, body, headers = {}) {
    context.res = {
      status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
      body: JSON.stringify(body),
    };
  }
  if (req.method !== "GET") {
    reply(405, { error: "Only GET is supported." }, { Allow: "GET" });
    return;
  }
  const request = new URL(req.url);
  const params = request.searchParams;
  const allowed = new Set(["api-version", "$filter", "$top", "$skip"]);
  const keys = [...params.keys()];
  if (req.url.length > 2500 || keys.some((key) => !allowed.has(key)) ||
    new Set(keys).size !== keys.length ||
    params.get("api-version") !== "2023-01-01-preview" ||
    !FILTER.test(params.get("$filter") ?? "") ||
    (params.has("$top") && params.get("$top") !== "1000") ||
    (params.has("$skip") && !/^(?:0|1000|2000|3000|4000)$/.test(params.get("$skip")))) {
    reply(400, { error: "Provide an exact VM size and region retail-price query." });
    return;
  }
  const upstream = new URL("https://prices.azure.com/api/retail/prices");
  upstream.search = params.toString();
  const signal = AbortSignal.timeout(20_000);
  try {
    const response = await fetch(upstream, {
      signal,
      redirect: "error",
      credentials: "omit",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      context.warn("Azure Retail Prices returned HTTP", response.status);
      reply(response.status === 429 ? 429 : 502, { error: "Azure Retail Prices is unavailable. Try again." });
      return;
    }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Retail response exceeded its size limit.");
      chunks.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || !Array.isArray(body.Items) || body.Items.length > 1000 ||
      (body.NextPageLink != null && typeof body.NextPageLink !== "string")) {
      throw new Error("Unexpected retail-price response.");
    }
    reply(200, body, { "Cache-Control": "public, max-age=300, s-maxage=900" });
  } catch (error) {
    context.error("Azure Retail Prices proxy failed.", error.name);
    reply(signal.aborted ? 504 : 502, { error: "Azure Retail Prices could not return complete data. Try again." });
  }
};
