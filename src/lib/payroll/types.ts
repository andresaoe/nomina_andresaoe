export type ShiftType = 'manana' | 'tarde' | 'noche'

export type NoveltyType =
  | 'normal'
  | 'incapacidad_eps'
  | 'incapacidad_arl'
  | 'vacaciones'
  | 'licencia_remunerada'
  | 'licencia_no_remunerada'
  | 'dia_familia'
  | 'cumpleanos'
  | 'ausencia'

export type ShiftCalcBreakdown = {
  hoursTotal: number
  hoursDay: number
  hoursNight: number
  hoursSundayOrHolidayDay: number
  hoursSundayOrHolidayNight: number
  overtimeHoursTotal: number
  overtimeDay: number
  overtimeNight: number
  overtimeSundayOrHolidayDay: number
  overtimeSundayOrHolidayNight: number
  basePayCop: number
  surchargePayCop: number
  totalPayCop: number
}

export type ShiftCalculation = {
  dateISO: string
  shift: ShiftType
  novelty: NoveltyType
  breakdown: ShiftCalcBreakdown
}
