import { addDays, addHours, format, parseISO, startOfDay } from 'date-fns'
import { isColombiaHoliday } from './colombiaHolidays'
import type { NoveltyType, ShiftCalcBreakdown, ShiftCalculation, ShiftType } from './types'

const NOCTURNAL_19_START_MS = parseISO('2025-12-25').getTime()
const SUNDAY_HOLIDAY_80_START_MS = parseISO('2025-07-01').getTime()
const SUNDAY_HOLIDAY_90_START_MS = parseISO('2026-07-01').getTime()
const SUNDAY_HOLIDAY_100_START_MS = parseISO('2027-07-01').getTime()

export function formatCop(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(Math.round(value))
}

export function roundCop(value: number) {
  return Math.round(value)
}

export function monthlyOrdinaryHours(weeklyHours = 44) {
  return (weeklyHours * 52) / 12
}

export function hourlyRateFromBaseSalaryCop(baseSalaryCop: number, weeklyHours = 44) {
  return baseSalaryCop / monthlyOrdinaryHours(weeklyHours)
}

function isSundayOrHoliday(date: Date) {
  const d = startOfDay(date)
  return d.getDay() === 0 || isColombiaHoliday(d)
}

function nocturnalStartHour(date: Date) {
  return startOfDay(date).getTime() >= NOCTURNAL_19_START_MS ? 19 : 21
}

function isNight(instant: Date) {
  const hour = instant.getHours()
  const start = nocturnalStartHour(instant)
  return hour >= start || hour < 6
}

function shiftRange(dateISO: string, shift: ShiftType) {
  const base = parseISO(dateISO)
  const start = new Date(base)
  const end = new Date(base)

  if (shift === 'manana') {
    start.setHours(5, 0, 0, 0)
    end.setHours(13, 0, 0, 0)
  } else if (shift === 'tarde') {
    start.setHours(13, 0, 0, 0)
    end.setHours(21, 0, 0, 0)
  } else if (shift === 'noche') {
    start.setHours(21, 0, 0, 0)
    end.setHours(5, 0, 0, 0)
    end.setDate(end.getDate() + 1)
  } else {
    start.setHours(0, 0, 0, 0)
    end.setHours(0, 0, 0, 0)
  }

  return { start, end }
}

type AdditionalTimeRange = {
  startTimeHHmm: string
  endTimeHHmm: string
}

function parseTimeHHmmToMinutes(value: string) {
  const [hh, mm] = value.split(':')
  const h = Number(hh)
  const m = Number(mm)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}

function additionalRange(dateISO: string, range: AdditionalTimeRange | null | undefined) {
  const base = parseISO(dateISO)
  const start = new Date(base)
  const end = new Date(base)

  const startMinutes = parseTimeHHmmToMinutes(range?.startTimeHHmm ?? '')
  const endMinutes = parseTimeHHmmToMinutes(range?.endTimeHHmm ?? '')
  if (startMinutes === null || endMinutes === null) return null

  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0)
  end.setHours(Math.floor(endMinutes / 60), endMinutes % 60, 0, 0)
  if (end.getTime() <= start.getTime()) end.setDate(end.getDate() + 1)
  return { start, end }
}

function noveltyMultiplier(novelty: NoveltyType) {
  if (novelty === 'licencia_no_remunerada' || novelty === 'ausencia') return 0
  if (novelty === 'incapacidad_eps') return 2 / 3
  return 1
}

function weekStartISO(date: Date) {
  const d = startOfDay(date)
  const day = d.getDay()
  const diffToMonday = (day + 6) % 7
  return format(addDays(d, -diffToMonday), 'yyyy-MM-dd')
}

function sundayOrHolidaySurchargePct(date: Date) {
  const t = startOfDay(date).getTime()
  if (t >= SUNDAY_HOLIDAY_100_START_MS) return 1.0
  if (t >= SUNDAY_HOLIDAY_90_START_MS) return 0.9
  if (t >= SUNDAY_HOLIDAY_80_START_MS) return 0.8
  return 0.75
}

function premiumPercentage(at: Date, isOvertime: boolean, isNightHour: boolean, isSundayHolidayHour: boolean) {
  if (isOvertime) {
    if (isSundayHolidayHour && isNightHour) return 1.5
    if (isSundayHolidayHour) return 1.0
    if (isNightHour) return 0.75
    return 0.25
  }

  if (isSundayHolidayHour && isNightHour) return sundayOrHolidaySurchargePct(at) + 0.35
  if (isSundayHolidayHour) return sundayOrHolidaySurchargePct(at)
  if (isNightHour) return 0.35
  return 0
}

export function calculateShifts(
  dateISOs: string[],
  shift: ShiftType,
  novelty: NoveltyType,
  hourlyRateCop: number,
  weeklyOrdinaryLimit = 44,
  additionalTimeRange?: AdditionalTimeRange | null,
): ShiftCalculation[] {
  const weekOrdinaryUsed = new Map<string, number>()

  return dateISOs.map((dateISO) => {
    const noveltyMult = noveltyMultiplier(novelty)

    if (shift === 'adicional') {
      if (novelty !== 'normal') {
        const breakdown: ShiftCalcBreakdown = {
          hoursTotal: 0,
          hoursDay: 0,
          hoursNight: 0,
          hoursSundayOrHolidayDay: 0,
          hoursSundayOrHolidayNight: 0,
          overtimeHoursTotal: 0,
          overtimeDay: 0,
          overtimeNight: 0,
          overtimeSundayOrHolidayDay: 0,
          overtimeSundayOrHolidayNight: 0,
          additionalStartTimeHHmm: additionalTimeRange?.startTimeHHmm,
          additionalEndTimeHHmm: additionalTimeRange?.endTimeHHmm,
          basePayCop: 0,
          surchargePayCop: 0,
          totalPayCop: 0,
        }
        return { dateISO, shift, novelty, breakdown }
      }

      const range = additionalRange(dateISO, additionalTimeRange)
      if (!range) {
        const breakdown: ShiftCalcBreakdown = {
          hoursTotal: 0,
          hoursDay: 0,
          hoursNight: 0,
          hoursSundayOrHolidayDay: 0,
          hoursSundayOrHolidayNight: 0,
          overtimeHoursTotal: 0,
          overtimeDay: 0,
          overtimeNight: 0,
          overtimeSundayOrHolidayDay: 0,
          overtimeSundayOrHolidayNight: 0,
          additionalStartTimeHHmm: additionalTimeRange?.startTimeHHmm,
          additionalEndTimeHHmm: additionalTimeRange?.endTimeHHmm,
          basePayCop: 0,
          surchargePayCop: 0,
          totalPayCop: 0,
        }
        return { dateISO, shift, novelty, breakdown }
      }

      let overtimeDay = 0
      let overtimeNight = 0
      let overtimeSundayOrHolidayDay = 0
      let overtimeSundayOrHolidayNight = 0

      let baseSum = 0
      let premiumSum = 0

      const stepMinutes = 15
      for (let t = new Date(range.start); t < range.end; t = addDays(t, 0)) {
        const next = new Date(t.getTime() + stepMinutes * 60 * 1000)
        const sliceEnd = next.getTime() > range.end.getTime() ? range.end : next
        const sliceHours = (sliceEnd.getTime() - t.getTime()) / (60 * 60 * 1000)

        const night = isNight(t)
        const sundayOrHoliday = isSundayOrHoliday(t)
        const premium = premiumPercentage(t, true, night, sundayOrHoliday)

        baseSum += hourlyRateCop * sliceHours
        premiumSum += hourlyRateCop * premium * sliceHours

        if (sundayOrHoliday && night) overtimeSundayOrHolidayNight += sliceHours
        else if (sundayOrHoliday) overtimeSundayOrHolidayDay += sliceHours
        else if (night) overtimeNight += sliceHours
        else overtimeDay += sliceHours

        if (sliceEnd.getTime() >= range.end.getTime()) break
        t = sliceEnd
      }

      const overtimeHoursTotal =
        overtimeDay + overtimeNight + overtimeSundayOrHolidayDay + overtimeSundayOrHolidayNight

      const basePayCop = roundCop(baseSum)
      const surchargePayCop = roundCop(premiumSum)
      const totalPayCop = roundCop(baseSum + premiumSum)

      const breakdown: ShiftCalcBreakdown = {
        hoursTotal: overtimeHoursTotal,
        hoursDay: 0,
        hoursNight: 0,
        hoursSundayOrHolidayDay: 0,
        hoursSundayOrHolidayNight: 0,
        overtimeHoursTotal,
        overtimeDay,
        overtimeNight,
        overtimeSundayOrHolidayDay,
        overtimeSundayOrHolidayNight,
        additionalStartTimeHHmm: additionalTimeRange?.startTimeHHmm,
        additionalEndTimeHHmm: additionalTimeRange?.endTimeHHmm,
        basePayCop,
        surchargePayCop,
        totalPayCop,
      }

      return { dateISO, shift, novelty, breakdown }
    }

    if (novelty !== 'normal') {
      const hoursTotal = 8
      const basePayCop = roundCop(hourlyRateCop * hoursTotal * noveltyMult)
      const breakdown: ShiftCalcBreakdown = {
        hoursTotal,
        hoursDay: 0,
        hoursNight: 0,
        hoursSundayOrHolidayDay: 0,
        hoursSundayOrHolidayNight: 0,
        overtimeHoursTotal: 0,
        overtimeDay: 0,
        overtimeNight: 0,
        overtimeSundayOrHolidayDay: 0,
        overtimeSundayOrHolidayNight: 0,
        basePayCop,
        surchargePayCop: 0,
        totalPayCop: basePayCop,
      }
      return { dateISO, shift, novelty, breakdown }
    }

    const hoursTotal = 8
    const { start, end } = shiftRange(dateISO, shift)

    let hoursDay = 0
    let hoursNight = 0
    let hoursSundayOrHolidayDay = 0
    let hoursSundayOrHolidayNight = 0
    let overtimeDay = 0
    let overtimeNight = 0
    let overtimeSundayOrHolidayDay = 0
    let overtimeSundayOrHolidayNight = 0

    let baseSum = 0
    let premiumSum = 0

    for (let t = new Date(start); t < end; t = addHours(t, 1)) {
      const weekKey = weekStartISO(t)
      const weekUsed = weekOrdinaryUsed.get(weekKey) ?? 0
      const night = isNight(t)
      const sundayOrHoliday = isSundayOrHoliday(t)
      const isOvertime = weekUsed >= weeklyOrdinaryLimit

      const premium = premiumPercentage(t, isOvertime, night, sundayOrHoliday)
      baseSum += hourlyRateCop
      premiumSum += hourlyRateCop * premium

      if (isOvertime) {
        if (sundayOrHoliday && night) overtimeSundayOrHolidayNight += 1
        else if (sundayOrHoliday) overtimeSundayOrHolidayDay += 1
        else if (night) overtimeNight += 1
        else overtimeDay += 1
      } else {
        if (sundayOrHoliday && night) hoursSundayOrHolidayNight += 1
        else if (sundayOrHoliday) hoursSundayOrHolidayDay += 1
        else if (night) hoursNight += 1
        else hoursDay += 1
        weekOrdinaryUsed.set(weekKey, weekUsed + 1)
      }
    }

    const overtimeHoursTotal =
      overtimeDay + overtimeNight + overtimeSundayOrHolidayDay + overtimeSundayOrHolidayNight

    const basePayCop = roundCop(baseSum)
    const surchargePayCop = roundCop(premiumSum)
    const totalPayCop = roundCop(baseSum + premiumSum)

    const breakdown: ShiftCalcBreakdown = {
      hoursTotal,
      hoursDay,
      hoursNight,
      hoursSundayOrHolidayDay,
      hoursSundayOrHolidayNight,
      overtimeHoursTotal,
      overtimeDay,
      overtimeNight,
      overtimeSundayOrHolidayDay,
      overtimeSundayOrHolidayNight,
      basePayCop,
      surchargePayCop,
      totalPayCop,
    }

    return { dateISO, shift, novelty, breakdown }
  })
}

export type ShiftInput = {
  dateISO: string
  shift: ShiftType
  novelty: NoveltyType
  tag: 'existing' | 'new'
}

export function calculateShiftsMerged(
  inputs: ShiftInput[],
  hourlyRateCop: number,
  weeklyOrdinaryLimit = 44,
): ShiftCalculation[] {
  const items = inputs.map((input, index) => ({ ...input, id: String(index) }))

  const hourEvents: {
    time: Date
    itemId: string
    night: boolean
    sundayOrHoliday: boolean
  }[] = []

  for (const item of items) {
    if (item.novelty !== 'normal') continue
    if (item.shift === 'adicional') continue
    const { start, end } = shiftRange(item.dateISO, item.shift)
    for (let t = new Date(start); t < end; t = addHours(t, 1)) {
      hourEvents.push({
        time: new Date(t),
        itemId: item.id,
        night: isNight(t),
        sundayOrHoliday: isSundayOrHoliday(t),
      })
    }
  }

  hourEvents.sort((a, b) => a.time.getTime() - b.time.getTime())

  const accum = new Map<
    string,
    {
      hoursDay: number
      hoursNight: number
      hoursSundayOrHolidayDay: number
      hoursSundayOrHolidayNight: number
      overtimeDay: number
      overtimeNight: number
      overtimeSundayOrHolidayDay: number
      overtimeSundayOrHolidayNight: number
      baseSum: number
      premiumSum: number
    }
  >()

  const weekOrdinaryUsed = new Map<string, number>()

  for (const e of hourEvents) {
    const weekKey = weekStartISO(e.time)
    const weekUsed = weekOrdinaryUsed.get(weekKey) ?? 0
    const overtime = weekUsed >= weeklyOrdinaryLimit
    if (!overtime) weekOrdinaryUsed.set(weekKey, weekUsed + 1)

    const premium = premiumPercentage(e.time, overtime, e.night, e.sundayOrHoliday)
    const a =
      accum.get(e.itemId) ??
      (() => {
        const init = {
          hoursDay: 0,
          hoursNight: 0,
          hoursSundayOrHolidayDay: 0,
          hoursSundayOrHolidayNight: 0,
          overtimeDay: 0,
          overtimeNight: 0,
          overtimeSundayOrHolidayDay: 0,
          overtimeSundayOrHolidayNight: 0,
          baseSum: 0,
          premiumSum: 0,
        }
        accum.set(e.itemId, init)
        return init
      })()

    a.baseSum += hourlyRateCop
    a.premiumSum += hourlyRateCop * premium

    if (overtime) {
      if (e.sundayOrHoliday && e.night) a.overtimeSundayOrHolidayNight += 1
      else if (e.sundayOrHoliday) a.overtimeSundayOrHolidayDay += 1
      else if (e.night) a.overtimeNight += 1
      else a.overtimeDay += 1
    } else {
      if (e.sundayOrHoliday && e.night) a.hoursSundayOrHolidayNight += 1
      else if (e.sundayOrHoliday) a.hoursSundayOrHolidayDay += 1
      else if (e.night) a.hoursNight += 1
      else a.hoursDay += 1
    }
  }

  return items.map((item) => {
    const hoursTotal = 8
    const noveltyMult = noveltyMultiplier(item.novelty)

    if (item.novelty !== 'normal') {
      const basePayCop = roundCop(hourlyRateCop * hoursTotal * noveltyMult)
      const breakdown: ShiftCalcBreakdown = {
        hoursTotal,
        hoursDay: 0,
        hoursNight: 0,
        hoursSundayOrHolidayDay: 0,
        hoursSundayOrHolidayNight: 0,
        overtimeHoursTotal: 0,
        overtimeDay: 0,
        overtimeNight: 0,
        overtimeSundayOrHolidayDay: 0,
        overtimeSundayOrHolidayNight: 0,
        basePayCop,
        surchargePayCop: 0,
        totalPayCop: basePayCop,
      }
      return { dateISO: item.dateISO, shift: item.shift, novelty: item.novelty, breakdown }
    }

    const a = accum.get(item.id)
    const hoursDay = a?.hoursDay ?? 0
    const hoursNight = a?.hoursNight ?? 0
    const hoursSundayOrHolidayDay = a?.hoursSundayOrHolidayDay ?? 0
    const hoursSundayOrHolidayNight = a?.hoursSundayOrHolidayNight ?? 0
    const overtimeDay = a?.overtimeDay ?? 0
    const overtimeNight = a?.overtimeNight ?? 0
    const overtimeSundayOrHolidayDay = a?.overtimeSundayOrHolidayDay ?? 0
    const overtimeSundayOrHolidayNight = a?.overtimeSundayOrHolidayNight ?? 0

    const overtimeHoursTotal =
      overtimeDay + overtimeNight + overtimeSundayOrHolidayDay + overtimeSundayOrHolidayNight

    const basePayCop = roundCop(a?.baseSum ?? 0)
    const surchargePayCop = roundCop(a?.premiumSum ?? 0)
    const totalPayCop = roundCop((a?.baseSum ?? 0) + (a?.premiumSum ?? 0))

    const breakdown: ShiftCalcBreakdown = {
      hoursTotal,
      hoursDay,
      hoursNight,
      hoursSundayOrHolidayDay,
      hoursSundayOrHolidayNight,
      overtimeHoursTotal,
      overtimeDay,
      overtimeNight,
      overtimeSundayOrHolidayDay,
      overtimeSundayOrHolidayNight,
      basePayCop,
      surchargePayCop,
      totalPayCop,
    }

    return { dateISO: item.dateISO, shift: item.shift, novelty: item.novelty, breakdown }
  })
}

export function enumerateDates(startISO: string, endISO: string) {
  const start = startOfDay(parseISO(startISO))
  const end = startOfDay(parseISO(endISO))
  const dates: string[] = []
  for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    dates.push(format(d, 'yyyy-MM-dd'))
  }
  return dates
}

export type MonthSummaryInput = {
  workDateISO: string
  novelty: NoveltyType
  totalPayCop: number
  breakdown: ShiftCalcBreakdown
}

export type EarningItem = {
  id: string
  label: string
  amountCop: number
  isSalary: boolean
}

export type DeductionItem = {
  id: string
  label: string
  amountCop: number
}

export type MonthSummaryConfig = {
  monthISO: string
  baseSalaryCop: number
  smmlvCop: number
  transportAllowanceCop: number
  transportSalaryCapSmmlv: number
  earningsItems: EarningItem[]
  deductionItems: DeductionItem[]
  applyStandardDeductions: boolean
  healthPct: number
  pensionPct: number
  applySolidarityFund: boolean
  ibcMinSmmlv: number
  ibcMaxSmmlv: number
}

export type MonthSummary = {
  monthISO: string
  shiftsCount: number
  uniqueDays: number
  shiftPayCop: number
  basePayCop: number
  surchargePayCop: number
  transportEligible: boolean
  transportProrationDays: number
  transportAllowanceCop: number
  salaryEarningsCop: number
  nonSalaryEarningsCop: number
  grossPayCop: number
  ibcCop: number
  healthCop: number
  pensionCop: number
  solidarityFundCop: number
  otherDeductionsCop: number
  totalDeductionsCop: number
  netPayCop: number
  hoursDay: number
  hoursNight: number
  hoursSundayOrHolidayDay: number
  hoursSundayOrHolidayNight: number
  overtimeHoursTotal: number
  overtimeDay: number
  overtimeNight: number
  overtimeSundayOrHolidayDay: number
  overtimeSundayOrHolidayNight: number
}

function auxilioDayMultiplier(novelty: NoveltyType) {
  if (novelty === 'normal') return 1
  if (novelty === 'licencia_remunerada') return 1
  if (novelty === 'dia_familia') return 1
  if (novelty === 'cumpleanos') return 1
  return 0
}

function cotizationDayMultiplier(novelty: NoveltyType) {
  if (novelty === 'licencia_no_remunerada' || novelty === 'ausencia') return 0
  return 1
}

function clamp(value: number, min: number, max: number) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function solidarityFundRate(ibcSmmlv: number) {
  if (ibcSmmlv < 4) return 0
  if (ibcSmmlv < 16) return 0.01
  if (ibcSmmlv < 17) return 0.012
  if (ibcSmmlv < 18) return 0.014
  if (ibcSmmlv < 19) return 0.016
  if (ibcSmmlv < 20) return 0.018
  return 0.02
}

export function summarizeMonth(
  entries: MonthSummaryInput[],
  config: MonthSummaryConfig,
): MonthSummary {
  const dayWeight = new Map<string, number>()
  const auxilioDay = new Map<string, number>()
  const cotizationDay = new Map<string, number>()

  let shiftPayCop = 0
  let basePayCop = 0
  let surchargePayCop = 0

  let hoursDay = 0
  let hoursNight = 0
  let hoursSundayOrHolidayDay = 0
  let hoursSundayOrHolidayNight = 0
  let overtimeHoursTotal = 0
  let overtimeDay = 0
  let overtimeNight = 0
  let overtimeSundayOrHolidayDay = 0
  let overtimeSundayOrHolidayNight = 0

  for (const e of entries) {
    shiftPayCop += e.totalPayCop || 0
    basePayCop += e.breakdown.basePayCop || 0
    surchargePayCop += e.breakdown.surchargePayCop || 0

    hoursDay += e.breakdown.hoursDay || 0
    hoursNight += e.breakdown.hoursNight || 0
    hoursSundayOrHolidayDay += e.breakdown.hoursSundayOrHolidayDay || 0
    hoursSundayOrHolidayNight += e.breakdown.hoursSundayOrHolidayNight || 0
    overtimeHoursTotal += e.breakdown.overtimeHoursTotal || 0
    overtimeDay += e.breakdown.overtimeDay || 0
    overtimeNight += e.breakdown.overtimeNight || 0
    overtimeSundayOrHolidayDay += e.breakdown.overtimeSundayOrHolidayDay || 0
    overtimeSundayOrHolidayNight += e.breakdown.overtimeSundayOrHolidayNight || 0

    const mult = noveltyMultiplier(e.novelty)
    const prev = dayWeight.get(e.workDateISO) ?? 0
    if (mult > prev) dayWeight.set(e.workDateISO, mult)

    const auxMult = auxilioDayMultiplier(e.novelty)
    const auxPrev = auxilioDay.get(e.workDateISO) ?? 0
    if (auxMult > auxPrev) auxilioDay.set(e.workDateISO, auxMult)

    const cotMult = cotizationDayMultiplier(e.novelty)
    const cotPrev = cotizationDay.get(e.workDateISO) ?? 0
    if (cotMult > cotPrev) cotizationDay.set(e.workDateISO, cotMult)
  }

  const transportEligible =
    config.smmlvCop > 0 &&
    config.transportAllowanceCop > 0 &&
    config.baseSalaryCop > 0 &&
    config.baseSalaryCop <= config.smmlvCop * config.transportSalaryCapSmmlv

  const transportProrationDays = Math.min(30, Array.from(auxilioDay.values()).reduce((acc, v) => acc + v, 0))
  const transportAllowanceCop = transportEligible
    ? roundCop(config.transportAllowanceCop * (transportProrationDays / 30))
    : 0

  const salaryEarningsCop = roundCop(
    (config.earningsItems ?? []).reduce((acc, item) => acc + (item.isSalary ? item.amountCop : 0), 0),
  )
  const nonSalaryEarningsCop = roundCop(
    (config.earningsItems ?? []).reduce((acc, item) => acc + (!item.isSalary ? item.amountCop : 0), 0),
  )

  const grossPayCop = roundCop(shiftPayCop + transportAllowanceCop + salaryEarningsCop + nonSalaryEarningsCop)

  const cotizationDays = Math.min(30, Array.from(cotizationDay.values()).reduce((acc, v) => acc + v, 0))
  const cotizationProration = cotizationDays / 30

  const salaryBaseForIbc = Math.max(0, roundCop(shiftPayCop + salaryEarningsCop))
  const minIbcCop =
    config.smmlvCop > 0 ? roundCop(config.smmlvCop * config.ibcMinSmmlv * cotizationProration) : 0
  const maxIbcCop =
    config.smmlvCop > 0 ? roundCop(config.smmlvCop * config.ibcMaxSmmlv * cotizationProration) : Number.POSITIVE_INFINITY

  const ibcCop = roundCop(clamp(salaryBaseForIbc, minIbcCop, maxIbcCop))

  const healthCop = config.applyStandardDeductions ? roundCop(ibcCop * config.healthPct) : 0
  const pensionCop = config.applyStandardDeductions ? roundCop(ibcCop * config.pensionPct) : 0

  const solidarityFundCop =
    config.applyStandardDeductions && config.applySolidarityFund && config.smmlvCop > 0
      ? roundCop(ibcCop * solidarityFundRate(ibcCop / config.smmlvCop))
      : 0

  const otherDeductionsCop = roundCop((config.deductionItems ?? []).reduce((acc, item) => acc + item.amountCop, 0))
  const totalDeductionsCop = roundCop(healthCop + pensionCop + solidarityFundCop + otherDeductionsCop)
  const netPayCop = roundCop(grossPayCop - totalDeductionsCop)

  return {
    monthISO: config.monthISO,
    shiftsCount: entries.length,
    uniqueDays: dayWeight.size,
    shiftPayCop: roundCop(shiftPayCop),
    basePayCop: roundCop(basePayCop),
    surchargePayCop: roundCop(surchargePayCop),
    transportEligible,
    transportProrationDays,
    transportAllowanceCop,
    salaryEarningsCop,
    nonSalaryEarningsCop,
    grossPayCop,
    ibcCop,
    healthCop,
    pensionCop,
    solidarityFundCop,
    otherDeductionsCop,
    totalDeductionsCop,
    netPayCop,
    hoursDay,
    hoursNight,
    hoursSundayOrHolidayDay,
    hoursSundayOrHolidayNight,
    overtimeHoursTotal,
    overtimeDay,
    overtimeNight,
    overtimeSundayOrHolidayDay,
    overtimeSundayOrHolidayNight,
  }
}
