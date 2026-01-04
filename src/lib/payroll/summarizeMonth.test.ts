import { describe, expect, it } from 'vitest'
import { summarizeMonth, type MonthSummaryConfig, type MonthSummaryInput } from './payrollCalculator'

function baseConfig(monthISO: string, smmlvCop = 1000000): MonthSummaryConfig {
  return {
    monthISO,
    baseSalaryCop: 0,
    smmlvCop,
    transportAllowanceCop: 0,
    transportSalaryCapSmmlv: 2,
    earningsItems: [],
    deductionItems: [],
    applyStandardDeductions: true,
    healthPct: 0,
    pensionPct: 0,
    applySolidarityFund: true,
    ibcMinSmmlv: 0,
    ibcMaxSmmlv: 999,
    retentionPct: 0,
    applyConnectivityAllowance: false,
    connectivityAllowanceCop: 0,
  }
}

function makeEntries(monthISO: string, days = 30): MonthSummaryInput[] {
  const out: MonthSummaryInput[] = []
  const month = Number(monthISO.split('-')[1])
  for (let d = 1; d <= days; d++) {
    const dayISO = `${monthISO}-${String(d).padStart(2, '0')}`
    out.push({
      workDateISO: dayISO,
      novelty: 'normal',
      totalPayCop: 0,
      breakdown: {
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
        basePayCop: 0,
        surchargePayCop: 0,
        totalPayCop: 0,
      },
    })
  }
  return out
}

describe('summarizeMonth · Fondo de Solidaridad', () => {
  it('usa tarifas anteriores a 2025-07-01', () => {
    const cfg = baseConfig('2025-06')
    const entries: MonthSummaryInput[] = makeEntries('2025-06')
    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 3_900_000, isSalary: true }]
    const res0 = summarizeMonth(entries, cfg)
    expect(res0.solidarityFundCop).toBe(0)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 4_000_000, isSalary: true }]
    const res1 = summarizeMonth(entries, cfg)
    expect(res1.solidarityFundCop).toBe(40_000)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 20_000_000, isSalary: true }]
    const res2 = summarizeMonth(entries, cfg)
    expect(res2.solidarityFundCop).toBe(400_000)
  })

  it('aplica nuevas tarifas desde 2025-07-01', () => {
    const cfg = baseConfig('2025-07')
    const entries: MonthSummaryInput[] = makeEntries('2025-07')

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 4_000_000, isSalary: true }]
    const r15 = summarizeMonth(entries, cfg)
    expect(r15.solidarityFundCop).toBe(60_000)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 7_000_000, isSalary: true }]
    const r18 = summarizeMonth(entries, cfg)
    expect(r18.solidarityFundCop).toBe(126_000)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 11_000_000, isSalary: true }]
    const r25 = summarizeMonth(entries, cfg)
    expect(r25.solidarityFundCop).toBe(275_000)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 19_500_000, isSalary: true }]
    const r28 = summarizeMonth(entries, cfg)
    expect(r28.solidarityFundCop).toBe(546_000)

    cfg.earningsItems = [{ id: 's', label: 'Salario', amountCop: 21_000_000, isSalary: true }]
    const r30 = summarizeMonth(entries, cfg)
    expect(r30.solidarityFundCop).toBe(630_000)
  })
})
