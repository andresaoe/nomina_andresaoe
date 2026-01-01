import KpiCard from './KpiCard'
import SimpleBarChart from './SimpleBarChart'
import type { DeductionItem, EarningItem, MonthSummary } from '../../lib/payroll/payrollCalculator'
import { formatCop } from '../../lib/payroll/payrollCalculator'

type Props = {
  selectedMonthPrefix: string
  monthSummary: MonthSummary | null
  monthTotal: number | null
  dailyPayPoints: { label: string; value: number }[]
  earningsDetail: { salary: EarningItem[]; nonSalary: EarningItem[] }
  deductionDetail: DeductionItem[]
  loadingMonth: boolean
  monthLoadError: string | null
  cardClass: string
}

export default function MonthlySummary({
  selectedMonthPrefix,
  monthSummary,
  monthTotal,
  dailyPayPoints,
  earningsDetail,
  deductionDetail,
  loadingMonth,
  monthLoadError,
  cardClass,
}: Props) {
  return (
    <div className="grid gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard label={`Resumen mensual (${selectedMonthPrefix})`} value={monthSummary ? formatCop(monthSummary.netPayCop) : '—'} helper="Neto a pagar" tone="good" />
        <KpiCard label="Total devengado" value={monthSummary ? formatCop(monthSummary.grossPayCop) : '—'} helper="Bruto" />
        <KpiCard label="Total deducciones" value={monthSummary ? formatCop(monthSummary.totalDeductionsCop) : '—'} helper="Salud, pensión y otras" tone={monthSummary && monthSummary.totalDeductionsCop > 0 ? 'warn' : 'default'} />
        <KpiCard label="IBC" value={monthSummary ? formatCop(monthSummary.ibcCop) : '—'} helper="Base aportes" />
        <KpiCard
          label="Auxilio transporte"
          value={monthSummary ? formatCop(monthSummary.transportAllowanceCop) : '—'}
          helper={monthSummary ? (monthSummary.transportEligible ? `${monthSummary.transportProrationDays.toFixed(2)} / 30` : 'No aplica') : undefined}
        />
        <KpiCard label="Total por turnos" value={monthSummary ? formatCop(monthSummary.shiftPayCop) : '—'} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardClass}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-900">Pago diario</div>
              <div className="mt-1 text-xs text-slate-600">Suma por día (turnos + novedades)</div>
            </div>
            <div className="text-sm text-slate-600">{monthTotal !== null ? formatCop(monthTotal) : '—'}</div>
          </div>
          <div className="mt-4">
            {!dailyPayPoints.length ? <div className="text-sm text-slate-600">Aún no hay datos del mes.</div> : <SimpleBarChart points={dailyPayPoints} />}
          </div>
        </div>

        <div className={cardClass}>
          <div className="text-sm font-medium text-slate-900">Detalle</div>
          {loadingMonth ? (
            <div className="mt-3 text-sm text-slate-600">Cargando…</div>
          ) : monthLoadError ? (
            <div className="mt-3 text-sm text-rose-700">No se pudo cargar el mes desde Supabase: {monthLoadError}</div>
          ) : !monthSummary ? (
            <div className="mt-3 text-sm text-slate-600">Aún no hay datos del mes para resumir.</div>
          ) : (
            <div className="mt-4 grid gap-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-700">Salud</span>
                <span className="text-slate-950">{formatCop(monthSummary.healthCop)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-700">Pensión</span>
                <span className="text-slate-950">{formatCop(monthSummary.pensionCop)}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-slate-700">Fondo de solidaridad</span>
                <span className="text-slate-950">{formatCop(monthSummary.solidarityFundCop)}</span>
              </div>
              <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                Horas: Diurnas {monthSummary.hoursDay} · Nocturnas {monthSummary.hoursNight} · Dom/Fest diurnas {monthSummary.hoursSundayOrHolidayDay} · Dom/Fest nocturnas {monthSummary.hoursSundayOrHolidayNight} · Extra {monthSummary.overtimeHoursTotal}
              </div>
              {(() => {
                const hDay = monthSummary.hoursDay
                const hNight = monthSummary.hoursNight
                const hSunDay = monthSummary.hoursSundayOrHolidayDay
                const hSunNight = monthSummary.hoursSundayOrHolidayNight
                const total = hDay + hNight + hSunDay + hSunNight
                if (!total) return null
                return (
                  <div className="mt-3">
                    <div className="flex h-3 overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                      <div className="bg-sky-400/60" style={{ width: `${(hDay / total) * 100}%` }} />
                      <div className="bg-indigo-400/60" style={{ width: `${(hNight / total) * 100}%` }} />
                      <div className="bg-emerald-400/60" style={{ width: `${(hSunDay / total) * 100}%` }} />
                      <div className="bg-rose-400/60" style={{ width: `${(hSunNight / total) * 100}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-sky-400/70" />
                        <span>Diurnas</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-indigo-400/70" />
                        <span>Nocturnas</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-emerald-400/70" />
                        <span>Dom/Fest diurnas</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-rose-400/70" />
                        <span>Dom/Fest nocturnas</span>
                      </div>
                    </div>
                  </div>
                )
              })()}

              {earningsDetail.salary.length || earningsDetail.nonSalary.length || deductionDetail.length ? (
                <div className="mt-3 grid gap-4 border-t border-slate-200 pt-3">
                  {earningsDetail.salary.length || earningsDetail.nonSalary.length ? (
                    <div className="grid gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Devengos adicionales</div>
                      {earningsDetail.salary.map((item) => (
                        <div key={item.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <span className="min-w-0 wrap-break-word text-slate-700">
                            {item.label} <span className="text-slate-500">(Salarial)</span>
                          </span>
                          <span className="shrink-0 text-slate-950">{formatCop(item.amountCop)}</span>
                        </div>
                      ))}
                      {earningsDetail.nonSalary.map((item) => (
                        <div key={item.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <span className="min-w-0 wrap-break-word text-slate-700">
                            {item.label} <span className="text-slate-500">(No salarial)</span>
                          </span>
                          <span className="shrink-0 text-slate-950">{formatCop(item.amountCop)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {deductionDetail.length ? (
                    <div className="grid gap-2">
                      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Deducciones adicionales</div>
                      {deductionDetail.map((item) => (
                        <div key={item.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <span className="min-w-0 wrap-break-word text-slate-700">{item.label}</span>
                          <span className="shrink-0 text-slate-950">{formatCop(item.amountCop)}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
