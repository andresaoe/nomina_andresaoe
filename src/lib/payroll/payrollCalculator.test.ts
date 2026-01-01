import { describe, expect, it } from 'vitest'
import { calculateShifts } from './payrollCalculator'

describe('payrollCalculator', () => {
  it('aplica recargo nocturno en turno de noche (lunes)', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-01-07'], 'noche', 'normal', hourlyRate)
    expect(calc?.breakdown.hoursNight).toBe(8)
    expect(calc?.breakdown.overtimeHoursTotal).toBe(0)
    expect(calc?.breakdown.basePayCop).toBe(8000)
    expect(calc?.breakdown.surchargePayCop).toBe(2800)
    expect(calc?.breakdown.totalPayCop).toBe(10800)
  })

  it('mueve el inicio de nocturna a 19:00 desde 2025-12-25', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-12-26'], 'tarde', 'normal', hourlyRate)
    expect(calc?.breakdown.hoursDay).toBe(6)
    expect(calc?.breakdown.hoursNight).toBe(2)
    expect(calc?.breakdown.surchargePayCop).toBe(700)
    expect(calc?.breakdown.totalPayCop).toBe(8700)
  })

  it('calcula horas extra después de 44h semanales', () => {
    const hourlyRate = 1000
    const dates = ['2025-01-06', '2025-01-07', '2025-01-08', '2025-01-09', '2025-01-10', '2025-01-11']
    const calcs = calculateShifts(dates, 'manana', 'normal', hourlyRate, 44)
    const saturday = calcs[5]
    expect(saturday?.breakdown.overtimeDay).toBe(4)
    expect(saturday?.breakdown.overtimeHoursTotal).toBe(4)
    expect(saturday?.breakdown.surchargePayCop).toBe(1350)
    expect(saturday?.breakdown.totalPayCop).toBe(9350)
  })

  it('aplica multiplicador de incapacidad EPS (66.67%)', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-01-06'], 'manana', 'incapacidad_eps', hourlyRate)
    expect(calc?.breakdown.basePayCop).toBe(5333)
    expect(calc?.breakdown.totalPayCop).toBe(5333)
  })

  it('calcula turno adicional con rango de horas', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-01-06'], 'adicional', 'normal', hourlyRate, 44, {
      startTimeHHmm: '18:00',
      endTimeHHmm: '20:00',
    })
    console.log('adicional-breakdown-1800-2000', calc?.breakdown)
    expect(calc?.breakdown.hoursSundayOrHolidayDay).toBe(2)
    expect(calc?.breakdown.overtimeHoursTotal).toBe(0)
    expect(calc?.breakdown.basePayCop).toBe(2000)
    expect(calc?.breakdown.surchargePayCop).toBe(1500)
    expect(calc?.breakdown.totalPayCop).toBe(3500)
  })

  it('marca horas dominicales en turno adicional', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-01-05'], 'adicional', 'normal', hourlyRate, 44, {
      startTimeHHmm: '10:00',
      endTimeHHmm: '12:00',
    })
    expect(calc?.breakdown.hoursSundayOrHolidayDay).toBe(2)
    expect(calc?.breakdown.overtimeHoursTotal).toBe(0)
  })

  it('marca horas festivas (Ascensión trasladada a lunes) en turno adicional', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-06-02'], 'adicional', 'normal', hourlyRate, 44, {
      startTimeHHmm: '10:00',
      endTimeHHmm: '12:00',
    })
    expect(calc?.breakdown.hoursSundayOrHolidayDay).toBe(2)
    expect(calc?.breakdown.overtimeHoursTotal).toBe(0)
  })

  it('separa horas diurnas/nocturnas en turno adicional según el rango', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-12-26'], 'adicional', 'normal', hourlyRate, 44, {
      startTimeHHmm: '18:00',
      endTimeHHmm: '20:00',
    })
    expect(calc?.breakdown.hoursDay).toBe(1)
    expect(calc?.breakdown.hoursNight).toBe(1)
    expect(calc?.breakdown.overtimeHoursTotal).toBe(0)
  })

  it('aplica recargo dom/fest 75% antes de 2025-07-01', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-06-02'], 'tarde', 'normal', hourlyRate)
    expect(calc?.breakdown.hoursSundayOrHolidayDay).toBe(8)
    expect(calc?.breakdown.basePayCop).toBe(8000)
    expect(calc?.breakdown.surchargePayCop).toBe(6000)
    expect(calc?.breakdown.totalPayCop).toBe(14000)
  })

  it('aplica recargo dom/fest 80% desde 2025-07-01', () => {
    const hourlyRate = 1000
    const [calc] = calculateShifts(['2025-07-20'], 'tarde', 'normal', hourlyRate)
    expect(calc?.breakdown.hoursSundayOrHolidayDay).toBe(8)
    expect(calc?.breakdown.basePayCop).toBe(8000)
    expect(calc?.breakdown.surchargePayCop).toBe(6400)
    expect(calc?.breakdown.totalPayCop).toBe(14400)
  })

  it('aplica recargo dom/fest 90% desde 2026-07-01 y 100% desde 2027-07-01', () => {
    const hourlyRate = 1000
    const [calc90] = calculateShifts(['2026-07-20'], 'tarde', 'normal', hourlyRate)
    expect(calc90?.breakdown.hoursSundayOrHolidayDay).toBe(6)
    expect(calc90?.breakdown.hoursSundayOrHolidayNight).toBe(2)
    expect(calc90?.breakdown.surchargePayCop).toBe(7900)
    expect(calc90?.breakdown.totalPayCop).toBe(15900)

    const [calc100] = calculateShifts(['2027-07-20'], 'tarde', 'normal', hourlyRate)
    expect(calc100?.breakdown.hoursSundayOrHolidayDay).toBe(6)
    expect(calc100?.breakdown.hoursSundayOrHolidayNight).toBe(2)
    expect(calc100?.breakdown.surchargePayCop).toBe(8700)
    expect(calc100?.breakdown.totalPayCop).toBe(16700)
  })
})
