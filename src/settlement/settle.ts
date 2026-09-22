import { priceTicket } from '../pricing/engine'
import type { CartLine } from '../pricing/engine'
import { getRegion, getMenuItem } from '../data'

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

// Decimal-safe two-decimal half-up rounding (kept consistent with pricing engine)
function roundTwoHalfUp(value: number): number {
  if (!isFinite(value)) return value
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  const fixed = abs.toFixed(12)
  const [intPart, fracPart = ''] = fixed.split('.')
  const frac = (fracPart + '000').slice(0, 12)
  const firstTwo = frac.slice(0, 2) || '00'
  const third = frac[2] || '0'
  const intBig = BigInt(intPart)
  let cents = intBig * 100n + BigInt(firstTwo)
  if (third >= '5') {
    cents += 1n
  }
  const result = Number(cents) / 100
  return sign * result
}

export function settleRegion(input: SettleRegionInput): RegionSettlement {
  const { regionId, date, tickets } = input
  const region = getRegion(regionId)
  if (!region) throw new Error(`Unknown region: ${regionId}`)

  // Build deduplicated region stops preserving first occurrence
  const stops: string[] = []
  for (const rs of region.stores) {
    const sid = rs.storeId
    if (!stops.includes(sid)) stops.push(sid)
  }

  // Validate tickets' stores are in region stops
  for (const t of tickets) {
    if (!stops.includes(t.storeId)) throw new Error(`Store not in region: ${t.storeId}`)
  }

  // Price each ticket by calling priceTicket; collect aggregates
  let grossSum = 0
  let lineDiscountSum = 0
  let orderDiscountSum = 0
  let netSum = 0

  const categoryNets: Map<string, number> = new Map()
  const offerCounts: Map<string, number> = new Map()

  // Map storeId -> whether visited (has at least one ticket)
  const visitedSet: Set<string> = new Set()

  for (const t of tickets) {
    const priced = priceTicket({ lines: t.lines, memberId: t.memberId, date })

    // Mark store visited
    visitedSet.add(t.storeId)

    for (const pl of priced.lines) {
      grossSum += pl.gross
      lineDiscountSum += pl.discount

      // per-category nets
      const mi = getMenuItem(pl.productId)
      const category = mi ? mi.category : 'unknown'
      const prev = categoryNets.get(category) || 0
      categoryNets.set(category, prev + pl.net)

      // offer usage per line
      if (pl.appliedOfferId) {
        offerCounts.set(pl.appliedOfferId, (offerCounts.get(pl.appliedOfferId) || 0) + 1)
      }
    }

    // order-level
    if (priced.orderLevel && priced.orderLevel.appliedOfferId) {
      offerCounts.set(priced.orderLevel.appliedOfferId, (offerCounts.get(priced.orderLevel.appliedOfferId) || 0) + 1)
    }

    orderDiscountSum += priced.orderLevel ? priced.orderLevel.discount : 0
    netSum += priced.total
  }

  const grossTotal = roundTwoHalfUp(grossSum)
  const lineDiscountTotal = roundTwoHalfUp(lineDiscountSum)
  const orderDiscountTotal = roundTwoHalfUp(orderDiscountSum)
  const discountTotal = roundTwoHalfUp(lineDiscountTotal + orderDiscountTotal)
  const netTotal = roundTwoHalfUp(netSum)

  // perCategory: sort keys ascending and round values; omit zero/absent
  const perCategoryEntries = Array.from(categoryNets.entries())
    .map(([k, v]) => [k, roundTwoHalfUp(v)] as [string, number])
    .filter(([, v]) => v !== 0)
    .sort((a, b) => a[0].localeCompare(b[0]))

  const perCategory: Record<string, number> = {}
  for (const [k, v] of perCategoryEntries) perCategory[k] = v

  // offerUsage: sort keys ascending
  const offerUsageEntries = Array.from(offerCounts.entries())
    .filter(([, v]) => v > 0)
    .sort((a, b) => a[0].localeCompare(b[0]))
  const offerUsage: Record<string, number> = {}
  for (const [k, v] of offerUsageEntries) offerUsage[k] = v

  // Bonus: marginal tiers on netTotal; compute on netTotal value
  let remaining = netTotal
  let bonusRaw = 0
  if (remaining > 0) {
    const tier1 = Math.min(remaining, 250)
    bonusRaw += tier1 * 0.03
    remaining -= tier1
  }
  if (remaining > 0) {
    const tier2 = Math.min(remaining, 500) // up to 750 total means 500 here
    bonusRaw += tier2 * 0.06
    remaining -= tier2
  }
  if (remaining > 0) {
    bonusRaw += remaining * 0.10
    remaining = 0
  }
  const bonus = roundTwoHalfUp(bonusRaw)

  // storesVisited and storesMissed: deduplicated region order
  const storesVisited: string[] = []
  const storesMissed: string[] = []
  for (const sid of stops) {
    if (visitedSet.has(sid)) storesVisited.push(sid)
    else storesMissed.push(sid)
  }

  return {
    regionId,
    date,
    grossTotal,
    lineDiscountTotal,
    orderDiscountTotal,
    discountTotal,
    netTotal,
    perCategory,
    offerUsage,
    bonus,
    storesVisited,
    storesMissed,
  }
}
