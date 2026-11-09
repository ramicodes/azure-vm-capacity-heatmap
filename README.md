# Azure VM Capacity Heatmap

> [!WARNING]
> **This is not a production app.** It is a prototype / proof of concept built for exploration and
> internal discussion. It has not been security-reviewed, load-tested, or validated for accuracy, and it
> comes with no support or SLA. Do **not** use it as the sole basis for capacity planning, customer
> commitments, or deployment decisions — always confirm in the Azure portal, with a real deployment, or
> through official Microsoft capacity channels.

A small web app that shows **where Azure VM sizes are available to a given subscription**, so you can
quickly spot which regions offer a VM series (for example the **NC** GPU series) and which families are
restricted.

- **Heatmap page** — regions × VM families for the selected series. Each cell shows how many sizes of
  that family are available to the subscription in that region; locked cells are offered but restricted
  for the subscription; dots mean not offered. Click a region or cell for per-size details
  (vCPU, GPU, memory, zones, restriction reason).
- **Charts page** — regions ranked by available sizes, family reach across regions, and
  availability-zone coverage, each with a data table.

## Where the availability values come from

All values are read **live** from the **Azure Resource Manager (ARM) REST API**, using the signed-in
user's own Azure permissions (no data is stored by the app). Three read-only calls are made:

| Data | ARM API | API version |
|------|---------|-------------|
| Subscriptions the user can see | `GET /subscriptions` | `2022-12-01` |
| Region names and geography | `GET /subscriptions/{id}/locations` | `2022-12-01` |
| VM sizes per region, zones and restrictions | `GET /subscriptions/{id}/providers/Microsoft.Compute/skus` ([Resource SKUs – List](https://learn.microsoft.com/rest/api/compute/resource-skus/list)) | `2021-07-01` |

How the app derives "availability" from the Resource SKUs response (only `resourceType = virtualMachines`):

- **Offered in a region** — the SKU lists the region in `locationInfo` / `locations`.
- **Restricted** — the SKU has a `restrictions` entry of type `Location` for that region
  (typically `reasonCode: NotAvailableForSubscription`). Shown as locked / amber.
- **Some zones restricted** — a `restrictions` entry of type `Zone` removes specific zones in that region.
- **Available** — offered and not restricted for the subscription. The zone count is the zones in
  `locationInfo[].zones` minus any restricted zones.
- **Series** is the leading letters of the size name (`NC24ads_A100_v4` → `NC`); **family** is the SKU's
  `family` field (e.g. `standardNCADSA100v4Family`); vCPU, GPU and memory come from the SKU `capabilities`.

### What these values do **not** tell you

- They are **not real-time free capacity**. Azure does not publish how many machines are free in a
  region. "Available" means the size is *offered and not blocked for this subscription* — a deployment
  can still fail with an allocation / capacity error.
- They do **not** include your **vCPU quota**. A size can be available but still blocked by the
  subscription's per-family quota (see `Microsoft.Compute/locations/{region}/usages`).
- Results are **per subscription**; another subscription (or offer type) can see different restrictions.
- Data is cached in the browser for about 5 minutes; use **Refresh** to re-read.

## How it runs

The app was built with Microsoft Copilot App Builder as a Power Apps managed (code) app. ARM calls go
through the Power Platform **Azure Resource Manager connector** (`shared_arm`) via the
`@microsoft/managed-apps` runtime; the typed client lives in `generated/`.

Because of that, **running it outside Power Apps (for example `npm run dev` from this repo) will open the
UI but will not load any Azure data**. To run it standalone you would need to replace the calls in
`src/lib/azure-capacity.ts` with direct ARM requests using your own sign-in (e.g. MSAL + an Entra app
registration).

### Code map

| Path | Purpose |
|------|---------|
| `src/lib/azure-capacity.ts` | ARM reads, parsing of Resource SKUs into per-region offers, shared filter hook |
| `src/pages/home.tsx` | Heatmap page |
| `src/pages/charts.tsx` | Charts page |
| `src/components/scope-controls.tsx` | Subscription / series pickers and refresh |
| `generated/` | Auto-generated ARM connector client (do not edit) |

### Stack

React 19 · TypeScript · Vite 7 · Tailwind CSS v4 · shadcn/ui · TanStack Query · recharts · zustand.

```bash
npm install        # or: bun install
npm run dev        # UI only — see note above about data
npm run typecheck
```

## Disclaimer

Provided **as is**, without warranty of any kind. This is a personal prototype, not an official Microsoft
product or tool, and availability information shown may be incomplete or out of date.
