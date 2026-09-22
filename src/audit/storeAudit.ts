import { getStores, getTickets } from "../data"

export interface StoreAudit {
  storeId: string
  weightedScore: number | null
  trend: "up" | "down" | "flat" | null
  daysSinceLastTicket: number | null
  dormant: boolean
  status: "thriving" | "attention" | "critical" | "inactive"
}

function ensureDateFormat(asOf: string) {
  // YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error(`Invalid date: ${asOf}`)
  }
  // further check valid date
  const [y, m, d] = asOf.split("-").map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${asOf}`)
  }
}

// Decimal-safe half-up rounding to 2 decimals using integer arithmetic (BigInt)
function roundHalfUpToTwoDecimals(numerator: bigint, divisor: bigint): number {
  // compute value = numerator / divisor
  // we want value rounded to 2 decimals half-up
  // scaled = floor((numerator * 1000) / divisor)
  const scaledTimes10 = (numerator * 1000n) / divisor // integer floor of value*1000
  const lastDigit = scaledTimes10 % 10n
  let scaled = scaledTimes10 / 10n
  if (lastDigit >= 5n) scaled += 1n
  // scaled is cents as integer
  const asNumber = Number(scaled) / 100
  return asNumber
}

export function auditStores(asOf: string): StoreAudit[] {
  ensureDateFormat(asOf)
  const stores = getStores()
  const tickets = getTickets()

  // parse asOf date in UTC
  const [ay, am, ad] = asOf.split("-").map(Number)
  const asOfUTC = Date.UTC(ay, am - 1, ad)

  const audits: StoreAudit[] = stores.map((s) => {
    // select tickets with date <= asOf
    const counted = tickets
      .filter((t) => t.storeId === s.id && t.date <= asOf)
      .slice() // copy
      .sort((a, b) => {
        // date descending
        if (a.date > b.date) return -1
        if (a.date < b.date) return 1
        // id descending for equal dates
        if (a.id > b.id) return -1
        if (a.id < b.id) return 1
        return 0
      })

    const top = counted.slice(0, 4)

    let weightedScore: number | null = null
    if (top.length > 0) {
      const weights = [4, 3, 2, 1]
      let numerator = 0n
      for (let i = 0; i < top.length; i++) {
        const csat = BigInt(Math.round(top[i].csat))
        numerator += csat * BigInt(weights[i])
      }
      const divisor = BigInt([4, 7, 9, 10][top.length - 1])
      weightedScore = roundHalfUpToTwoDecimals(numerator, divisor)
    }

    // trend
    let trend: StoreAudit["trend"] = null
    if (top.length >= 2) {
      const latest = top[0].csat
      const others = top.slice(1, 4)
      const sumOthers = others.reduce((acc, t) => acc + t.csat, 0)
      const countOthers = others.length
      // rounded mean of others (decimal-safe half-up)
      const numeratorMean = BigInt(sumOthers)
      const divisorMean = BigInt(countOthers)
      const meanRounded = roundHalfUpToTwoDecimals(numeratorMean, divisorMean)
      if (Number(latest) > meanRounded) trend = "up"
      else if (Number(latest) < meanRounded) trend = "down"
      else trend = "flat"
    }

    // daysSinceLastTicket
    let daysSinceLastTicket: number | null = null
    if (top.length > 0) {
      const newest = top[0].date // ISO date
      const [y, m, d] = newest.split("-").map(Number)
      const newestUTC = Date.UTC(y, m - 1, d)
      const diffMs = asOfUTC - newestUTC
      const diffDays = Math.floor(diffMs / 86400000)
      daysSinceLastTicket = diffDays >= 0 ? diffDays : 0
    }

    const dormant = daysSinceLastTicket === null || daysSinceLastTicket > 21

    let status: StoreAudit["status"]
    if (weightedScore === null) status = "inactive"
    else {
      const rounded = Math.round(weightedScore * 100) / 100
      if (rounded < 3) status = "critical"
      else if (rounded < 4) status = "attention"
      else status = "thriving"
    }

    return {
      storeId: s.id,
      weightedScore,
      trend,
      daysSinceLastTicket,
      dormant,
      status,
    }
  })

  return audits.sort((a, b) => (a.storeId < b.storeId ? -1 : a.storeId > b.storeId ? 1 : 0))
}
