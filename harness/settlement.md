---
title: Region Settlement Brief
description: Lossless region settlement requirements distilled from SPEC.md section 11
---

## Contract

Create `src/settlement/settle.ts`. Import `priceTicket` and `CartLine` from
`../pricing/engine`, and use loaders from `../data`. Export:

```ts
export interface SettleRegionInput {
  regionId: string
  date: string
  tickets: Array<{
    storeId: string
    memberId: string | null
    lines: CartLine[]
  }>
}
export interface RegionSettlement {
  regionId: string
  date: string
  grossTotal: number
  lineDiscountTotal: number
  orderDiscountTotal: number
  discountTotal: number
  netTotal: number
  perCategory: Record<string, number>
  offerUsage: Record<string, number>
  bonus: number
  storesVisited: string[]
  storesMissed: string[]
}
export function settleRegion(input: SettleRegionInput): RegionSettlement
```

## Validation and pricing

* Resolve the region through `getRegions` or `getRegion`. Unknown region throws
  exactly `Error("Unknown region: <regionId>")`.
* Every ticket store must occur among the region's stops. Otherwise throw exactly
  `Error("Store not in region: <storeId>")`. Multiple tickets per store and an
  empty ticket list are valid.
* Price every ticket by calling the imported `priceTicket` with that ticket's
  `lines`, `memberId`, and the settlement `date`. Propagate pricing errors unchanged.

## Aggregates

Use decimal-safe two-decimal half-up rounding for all money:

* `grossTotal`: rounded sum of every priced line gross.
* `lineDiscountTotal`: rounded sum of every priced line discount.
* `orderDiscountTotal`: rounded sum of every ticket order-level discount.
* `discountTotal`: rounded line plus order discount totals.
* `netTotal`: rounded sum of every priced ticket total.
* `perCategory`: sum priced line nets by category obtained via menu loaders. Do not
  allocate order discounts. Omit unused categories, round each value, and construct
  keys in ascending lexical order.
* `offerUsage`: count each priced line with a non-null offer once and each ticket
  with a non-null order offer once. Omit unused offers and construct keys in
  ascending lexical order.

Compute marginal bonus on `netTotal`, rounding only the final result: 3% of the
first 250, plus 6% of the portion over 250 through 750 (maximum 500 in this tier),
plus 10% of the portion over 750. This is not a flat rate.

Deduplicate region stop IDs while preserving first occurrence order.
`storesVisited` contains those with at least one input ticket; `storesMissed`
contains the rest. Preserve deduplicated region order in both arrays.

Return the input `regionId` and `date`. For no tickets, all totals and bonus are
zero, maps are empty, visited is empty, and missed contains all deduplicated stops.