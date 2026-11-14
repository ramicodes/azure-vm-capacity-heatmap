# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Users
Azure administrators comparing VM options across regions and subscriptions while planning workloads.

## Product Purpose
Azure VM Capacity Planner helps administrators inspect subscription-specific VM offerings, compare workload fit and quota readiness, and estimate compute costs before deployment. Success means making regional and SKU trade-offs easier to evaluate without implying that listed availability guarantees allocation.

## Positioning
The planner combines live Azure Resource Manager SKU eligibility and quota reads with workload filters, alongside public Azure retail-price estimates; these signals stay distinct rather than being presented as a capacity guarantee.

## Operating Context
Administrators select an Azure subscription and VM series, refine requirements and regions, compare eligible sizes, and optionally save reusable workload scenarios in their own browser.

## Capabilities and Constraints
- Existing views cover VM availability and workload fit, including subscription restrictions, regional/family vCPU quota checks, readiness classification, and CSV export.
- Cost estimates use public Azure pay-as-you-go retail rates in USD with explicit runtime and OS assumptions; negotiated discounts, reservations, Spot, and ancillary charges are outside the initial estimate.
- Saved scenarios are private to the browser and contain workload/region settings only. They never persist subscription or account identity and apply to the currently selected subscription.
- Azure reads are read-only; offered SKUs and sufficient quota do not guarantee deployment allocation.
- A protected Azure App Service deployment serves the Fluent 2 application and same-origin Node backend. App Service authentication is tenant-pinned and user-allowlisted; its backend uses a system-assigned managed identity for read-only access to one configured subscription.
- Azure Static Web Apps deployment scripts remain available as a separate hosting path; they do not replace the protected App Service deployment.

## Brand Commitments
The product name is Azure VM Capacity Planner. Use direct, precise language that distinguishes published availability, quota, cost estimates, and actual allocation.

## Evidence on Hand
The repository contains the application, focused regression tests, App Service infrastructure and deployment automation, and current illustrative screenshots for the separate availability and workload-fit views.

## Product Principles
- Make the data source and scope of each signal clear.
- Keep restrictions, quota, pricing, and allocation distinct.
- Prefer bounded, read-only Azure access and explicit user actions.
- Keep saved planning inputs private and independent of subscription identity.
