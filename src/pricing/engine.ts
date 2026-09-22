import { getMenuItem, getMember, getOffers } from '../data'
import type { Member } from '../data'

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

// Helper: two-decimal half-up rounding (decimal-safe)
function roundTwoHalfUp(value: number): number {
  if (!isFinite(value)) return value
  const sign = value < 0 ? -1 : 1
  const abs = Math.abs(value)
  // Use fixed with enough precision to capture third decimal
  const fixed = abs.toFixed(12) // 12 decimals should be safe for input ranges
  const [intPart, fracPart = ''] = fixed.split('.')
  const frac = (fracPart + '000').slice(0, 12)
  const firstTwo = frac.slice(0, 2) || '00'
  const third = frac[2] || '0'
  // Build cents as BigInt to avoid float errors
  const intBig = BigInt(intPart)
  let cents = intBig * 100n + BigInt(firstTwo)
  if (third >= '5') {
    cents += 1n
  }
  const result = Number(cents) / 100
  return sign * result
}

function isPositiveInteger(n: number): boolean {
  return Number.isInteger(n) && n > 0
}

function parseDateUTC(dateStr: string): Date {
  // dateStr expected in ISO date (YYYY-MM-DD). Force UTC midnight
  return new Date(dateStr + 'T00:00:00Z')
}

const dayAbbr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function priceTicket(input: PriceTicketInput): PricedTicket {
  const { lines: inputLines, memberId, date } = input

  // Validate member if non-null; explicitly typed as Member | null to satisfy strict inference
  let member: Member | null = null
  if (memberId !== null) {
    member = getMember(memberId) ?? null
    if (!member) throw new Error(`Unknown member: ${memberId}`)
  }

  // Early return for empty cart: still must validate member above
  if (!inputLines || inputLines.length === 0) {
    return {
      lines: [],
      orderLevel: { appliedOfferId: null, discount: 0 },
      subtotal: 0,
      total: 0,
    }
  }

  // Validate lines and build initial structures
  // Preserve input order
  for (const ln of inputLines) {
    const menu = getMenuItem(ln.productId)
    if (!menu) throw new Error(`Unknown product: ${ln.productId}`)
    if (!isPositiveInteger(ln.qty)) throw new Error(`Invalid qty for ${ln.productId}`)
  }

  // Precompute totals per product for bundle logic
  const totalQtyByProduct: Record<string, number> = {}
  for (const ln of inputLines) {
    totalQtyByProduct[ln.productId] = (totalQtyByProduct[ln.productId] || 0) + ln.qty
  }

  // Determine active and eligible offers
  const allOffers = getOffers()
  const evalDate = parseDateUTC(date)
  const evalDay = dayAbbr[evalDate.getUTCDay()]

  function offerIsActiveAndEligible(offer: any): boolean {
    const from = parseDateUTC(offer.validFrom)
    const to = parseDateUTC(offer.validTo)
    if (evalDate < from || evalDate > to) return false
    if (offer.dayOfWeek && Array.isArray(offer.dayOfWeek)) {
      if (!offer.dayOfWeek.includes(evalDay)) return false
    }
    if (offer.eligibleTiers && Array.isArray(offer.eligibleTiers)) {
      // walk-ins ineligible
      if (!member) return false
          if (!offer.eligibleTiers.includes(member.tier)) return false
    }
    return true
  }

  const activeOffers = allOffers.filter(offerIsActiveAndEligible)

  // For tie-breaking we need offer.validFrom (Date) and id
  type Candidate = { offer: any; discount: number }

  const pricedLines: PricedLine[] = []

  for (const ln of inputLines) {
    const menu = getMenuItem(ln.productId)!
    const unitPrice = menu.basePrice
    const grossRaw = unitPrice * ln.qty
    const gross = roundTwoHalfUp(grossRaw)

    // Evaluate line offers (percent_off and bundle)
    const candidates: Candidate[] = []

    for (const offer of activeOffers) {
      if (offer.type === 'percent_off') {
        const scope = offer.scope || {}
        let applies = false
        if (scope.category) {
          if (menu.category === scope.category) applies = true
        }
        if (scope.productIds) {
          if (scope.productIds.includes(ln.productId)) applies = true
        }
        if (!applies) continue
        const raw = (gross * offer.percent) / 100
        const rounded = roundTwoHalfUp(raw)
        const clamped = Math.min(rounded, gross)
        if (clamped > 0) candidates.push({ offer, discount: clamped })
      } else if (offer.type === 'bundle') {
        const [buyId, getId] = offer.products
        if (buyId !== ln.productId) continue
        // total buy qty and total get qty across cart
        const totalBuy = totalQtyByProduct[buyId] || 0
        const totalGet = totalQtyByProduct[getId] || 0
        const pairs = Math.min(totalBuy, totalGet)
        if (pairs <= 0) continue
        const raw = pairs * offer.amountOff
        const rounded = roundTwoHalfUp(raw)
        const clamped = Math.min(rounded, gross)
        if (clamped > 0) candidates.push({ offer, discount: clamped })
      }
    }

    // Choose best candidate per rules
    let appliedOfferId: string | null = null
    let chosenDiscount = 0
    if (candidates.length > 0) {
      // sort by discount desc, then validFrom asc, then id lexicographic asc
      candidates.sort((a, b) => {
        if (a.discount !== b.discount) return b.discount - a.discount
        const aFrom = parseDateUTC(a.offer.validFrom)
        const bFrom = parseDateUTC(b.offer.validFrom)
        if (aFrom.getTime() !== bFrom.getTime()) return aFrom.getTime() - bFrom.getTime()
        return a.offer.id.localeCompare(b.offer.id)
      })
      const chosen = candidates[0]
      appliedOfferId = chosen.offer.id
      chosenDiscount = chosen.discount
    }

    const netRaw = gross - chosenDiscount
    const net = Math.max(0, roundTwoHalfUp(netRaw))

    pricedLines.push({
      productId: ln.productId,
      qty: ln.qty,
      unitPrice,
      gross,
      appliedOfferId,
      discount: chosenDiscount,
      net,
    })
  }

  // Subtotal: rounded sum of line nets
  const subtotalRaw = pricedLines.reduce((s, l) => s + l.net, 0)
  const subtotal = roundTwoHalfUp(subtotalRaw)

  // Evaluate order-level spend_threshold offers
  const orderCandidates: { offer: any; discount: number }[] = []
  for (const offer of activeOffers) {
    if (offer.type !== 'spend_threshold') continue
    // eligibility tiers already checked above
    // compute qualification amount
    let qualificationAmount = 0
    if (!offer.category) {
      qualificationAmount = subtotal
    } else {
      // sum post-discount line nets for items in that category
      let sum = 0
      for (const pl of pricedLines) {
        const mi = getMenuItem(pl.productId)!
        if (mi.category === offer.category) sum += pl.net
      }
      qualificationAmount = roundTwoHalfUp(sum)
    }
    if (qualificationAmount + 1e-12 < offer.minSubtotal) continue // needs >=

    const raw = offer.amountOff
    const rounded = roundTwoHalfUp(raw)
    const clamped = Math.min(rounded, subtotal)
    if (clamped <= 0) continue
    orderCandidates.push({ offer, discount: clamped })
  }

  let orderAppliedId: string | null = null
  let orderDiscount = 0
  if (orderCandidates.length > 0) {
    orderCandidates.sort((a, b) => {
      if (a.discount !== b.discount) return b.discount - a.discount
      const aFrom = parseDateUTC(a.offer.validFrom)
      const bFrom = parseDateUTC(b.offer.validFrom)
      if (aFrom.getTime() !== bFrom.getTime()) return aFrom.getTime() - bFrom.getTime()
      return a.offer.id.localeCompare(b.offer.id)
    })
    const chosen = orderCandidates[0]
    orderAppliedId = chosen.offer.id
    orderDiscount = chosen.discount
  }

  const totalRaw = subtotal - orderDiscount
  const total = Math.max(0, roundTwoHalfUp(totalRaw))

  return {
    lines: pricedLines,
    orderLevel: { appliedOfferId: orderAppliedId, discount: orderDiscount },
    subtotal,
    total,
  }
}
