const text = "text";
const number = "number";
const capabilities = new Set(["vCPUs", "vCPUsAvailable", "GPUs", "MemoryGB"]);
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
  const selected = kind === "skus" ? items.filter((item) => item?.resourceType === "virtualMachines") : items;
  return selected.map((item) => {
    const result = project(item, projections[kind]);
    if (kind === "skus" && result?.capabilities) result.capabilities = result.capabilities.filter((capability) => capabilities.has(capability.name));
    return result;
  }).filter((item) => item !== undefined);
}
