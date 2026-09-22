---
title: Store Audit Brief
description: Lossless store audit requirements distilled from SPEC.md section 10
---

## Contract

Create `src/audit/storeAudit.ts`, use `getStores` and `getTickets` from `../data`,
and export:

```ts
export interface StoreAudit {
  storeId: string
  weightedScore: number | null
  trend: 'up' | 'down' | 'flat' | null
  daysSinceLastTicket: number | null
  dormant: boolean
  status: 'thriving' | 'attention' | 'critical' | 'inactive'
}
export function auditStores(asOf: string): StoreAudit[]
```

## Rules

* Require `asOf` to match `YYYY-MM-DD`; otherwise throw exactly
  `Error("Invalid date: <asOf>")`.
* Return one entry per store, sorted by `storeId` ascending.
* For each store, count only tickets whose `date <= asOf`. Sort counted tickets by
  date descending, then `id` descending for equal dates.
* Use at most four newest tickets. Apply weights 4, 3, 2, 1 in that order.
  `weightedScore` is decimal-safe two-decimal half-up rounding of weighted sum
  divided by weights used: divisors are 4, 7, 9, and 10 for one through four
  tickets. With none, it is null.
* Trend requires at least two tickets. Compare latest CSAT with the decimal-safe
  half-up rounded arithmetic mean of the next up to three CSAT values. Return `up`,
  `down`, or `flat`; with fewer than two return null.
* `daysSinceLastTicket` is whole UTC calendar days from newest counted ticket date
  to `asOf`; same day is zero. With none it is null.
* `dormant` is true when days are null or strictly greater than 21. Exactly 21 is
  false.
* Status uses rounded weighted score: no tickets is `inactive`; below 3 is
  `critical`; at least 3 but below 4 is `attention`; at least 4 is `thriving`.
  Dormancy does not alter status.
* Use decimal-safe half-up rounding, not banker's or naive binary rounding.