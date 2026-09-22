---
title: Pricing Engine Brief
description: Lossless pricing requirements distilled from SPEC.md sections 2 through 7
---

## Contract

Create `src/pricing/engine.ts` exporting these public interfaces and function:

```ts
export interface CartLine { productId: string; qty: number }
export interface PriceTicketInput {
  lines: CartLine[]
  memberId: string | null
  date: string
}
export interface PricedLine {
  productId: string
  qty: number
  unitPrice: number
  gross: number
  appliedOfferId: string | null
  discount: number
  net: number
}
export interface PricedTicket {
  lines: PricedLine[]
  orderLevel: { appliedOfferId: string | null; discount: number }
  subtotal: number
  total: number
}
export function priceTicket(input: PriceTicketInput): PricedTicket
```

Use `getMenuItem`, `getMember`, and `getOffers` from `../data`. Preserve input line
order in output.

## Validation

* Validate a non-null member even for an empty cart. Unknown member throws exactly
  `Error("Unknown member: <id>")`; `null` is a valid walk-in.
* For each line, unknown product throws exactly `Error("Unknown product: <id>")`.
* Quantity must be a positive integer; otherwise throw exactly
  `Error("Invalid qty for <productId>")`.
* Empty lines are valid and return empty lines, null offers, and zero subtotal and
  total.

## Active and eligible offers

An offer is active when `validFrom <= date <= validTo`, endpoints inclusive. If
`dayOfWeek` exists, derive the weekday in UTC using numeric ISO date parts and
require its `Sun` through `Sat` abbreviation. If `eligibleTiers` exists, require a
known member whose tier occurs in it; walk-ins are ineligible. Without
`eligibleTiers`, all tiers and walk-ins qualify. Tier grants no automatic discount.

## Line offers

Evaluate active and eligible `percent_off` and `bundle` offers independently for
each line. Apply at most one offer to each line.

* `percent_off`: scope has either `category` or `productIds`; match the menu item.
  Candidate discount is `gross * percent / 100`.
* `bundle`: `products` is `[buyProductId, getProductId]`. It applies only to the buy
  line. Pairs equal `min(total buy quantity in the cart, total get quantity in the
  cart)`. Candidate discount is `pairs * amountOff`. The get line is not
  discounted. A missing get line produces zero and is not applicable. Aggregate
  quantities across duplicate product lines in the cart.
* Round and clamp every candidate discount to the current line's rounded gross
  before comparing candidates. Ignore zero candidates.
* Choose the largest clamped discount. Equal discounts choose earlier `validFrom`;
  if still equal, choose lexicographically smaller `id`.
* The same percent offer can win on multiple lines. Never stack line offers.

For each output line, `unitPrice` is `menu.basePrice`, `gross` is rounded
`unitPrice * qty`, `discount` is the selected rounded/clamped discount or zero, and
`net` is rounded `gross - discount`, clamped at zero.

## Order offers

After line pricing, set `subtotal` to the rounded sum of line nets. Evaluate active
and eligible `spend_threshold` offers:

* Without `category`, qualification amount is subtotal.
* With `category`, it is the rounded sum of post-discount line nets for menu items
  in that category.
* Qualification is inclusive: amount `>= minSubtotal`.
* Candidate discount is fixed `amountOff`, rounded and clamped to subtotal so total
  cannot become negative.
* Choose the qualifying offer with greatest `amountOff`; ties choose earlier
  `validFrom`, then lexicographically smaller `id`.
* Apply at most one order offer. It stacks with line offers.

Return the selected order offer and rounded discount, then `total` as rounded
`subtotal - order discount`, clamped at zero.

## Money

Every output money value is two-decimal, decimal-safe half-up: `1.005 -> 1.01` and
`2.175 -> 2.18`. Banker's rounding and naive binary `Math.round(x * 100) / 100` are
wrong. Round gross and discount independently, then round net. Round subtotal and
total. Normalize zero rather than returning negative zero.