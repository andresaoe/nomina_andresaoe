import type { ShiftCalcBreakdown, ShiftCalculation, ShiftType, NoveltyType } from '../../lib/payroll/types'
import { formatCop } from '../../lib/payroll/payrollCalculator'

type BadgeTone = 'normal' | 'sunday' | 'holiday' | 'extra'

type Props = {
  cardClass: string
  inputClass: string
  selectClass: string
  btnPrimary: string
  btnNeutral: string
  badgeTone: Record<BadgeTone, string>
  supabaseAvailable: boolean
  requiresRange: boolean
  startISO: string
  setStartISO: (v: string) => void
  endISO: string
  setEndISO: (v: string) => void
  shift: ShiftType
  setShift: (v: ShiftType) => void
  additionalStartTimeHHmm: string
  setAdditionalStartTimeHHmm: (v: string) => void
  additionalEndTimeHHmm: string
  setAdditionalEndTimeHHmm: (v: string) => void
  novelty: NoveltyType
  setNovelty: (v: NoveltyType) => void
  shiftOptions: { value: ShiftType; label: string }[]
  noveltyOptions: { value: NoveltyType; label: string }[]
  hourlyRate: number | null
  onPreview: () => Promise<void> | void
  onSaveTurns: () => Promise<void> | void
  savingRows: boolean
  preview: ShiftCalculation[] | null
  dayBadge: (dateISO: string, breakdown?: ShiftCalcBreakdown) => { label: string; tone: BadgeTone }
  hasOvertime: (breakdown?: ShiftCalcBreakdown) => boolean
}

export default function TurnosPanel(props: Props) {
  const {
    cardClass,
    inputClass,
    selectClass,
    btnPrimary,
    btnNeutral,
    badgeTone,
    supabaseAvailable,
    requiresRange,
    startISO,
    setStartISO,
    endISO,
    setEndISO,
    shift,
    setShift,
    additionalStartTimeHHmm,
    setAdditionalStartTimeHHmm,
    additionalEndTimeHHmm,
    setAdditionalEndTimeHHmm,
    novelty,
    setNovelty,
    shiftOptions,
    noveltyOptions,
    hourlyRate,
    onPreview,
    onSaveTurns,
    savingRows,
    preview,
    dayBadge,
    hasOvertime,
  } = props

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className={cardClass}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-base font-semibold text-slate-950">Registrar turnos</div>
            <div className="mt-1 text-sm text-slate-600">
              Para turnos trabajados selecciona día y turno. El rango se usa solo para vacaciones, licencias e incapacidades.
            </div>
          </div>
        </div>

        {!supabaseAvailable ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            Servicio no disponible. Contacta al administrador.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3">
          <div className={requiresRange ? 'grid gap-3 sm:grid-cols-2' : 'grid gap-3'}>
            <label className="text-sm text-slate-700">
              {requiresRange ? 'Inicio' : 'Día'}
              <input className={inputClass} value={startISO} onChange={(e) => setStartISO(e.target.value)} type="date" />
            </label>
            {requiresRange ? (
              <label className="text-sm text-slate-700">
                Fin
                <input className={inputClass} value={endISO} onChange={(e) => setEndISO(e.target.value)} type="date" />
              </label>
            ) : null}
          </div>
          <label className="text-sm text-slate-700">
            Turno
            <select className={selectClass} value={shift} onChange={(e) => setShift(e.target.value as ShiftType)}>
              {shiftOptions.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          {shift === 'adicional' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                Hora inicio (adicional)
                <input
                  className={inputClass}
                  type="time"
                  value={additionalStartTimeHHmm}
                  onChange={(e) => setAdditionalStartTimeHHmm(e.target.value)}
                />
              </label>
              <label className="text-sm text-slate-700">
                Hora fin (adicional)
                <input className={inputClass} type="time" value={additionalEndTimeHHmm} onChange={(e) => setAdditionalEndTimeHHmm(e.target.value)} />
              </label>
            </div>
          ) : null}
          <label className="text-sm text-slate-700">
            Novedad
            <select className={selectClass} value={novelty} onChange={(e) => setNovelty(e.target.value as NoveltyType)}>
              {noveltyOptions.map((n) => (
                <option key={n.value} value={n.value}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2 pt-1">
            {requiresRange ? (
              <button type="button" onClick={onPreview} disabled={!hourlyRate} className={btnNeutral}>
                Previsualizar
              </button>
            ) : null}
            <button type="button" onClick={onSaveTurns} disabled={!hourlyRate || savingRows} className={btnPrimary}>
              {savingRows ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
          {!requiresRange ? <div className="text-xs text-slate-600">Previsualización automática al cambiar día/turno.</div> : null}
          <div className="text-xs text-slate-600">Hora estimada: {hourlyRate ? formatCop(hourlyRate) : '—'} (44h/semana)</div>
        </div>
      </div>

      <div className="grid gap-6">
        {preview ? (
          <div className={cardClass}>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <div className="text-base font-semibold text-slate-950">Previsualización</div>
              <div className="text-sm text-slate-600">
                Total: {formatCop(preview.reduce((acc, p) => acc + p.breakdown.totalPayCop, 0))}
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              {preview.slice(0, 20).map((p) => (
                <div
                  key={`${p.dateISO}-${p.shift}-${p.novelty}`}
                  className="flex flex-col gap-2 border-t border-slate-200 pt-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2 text-slate-700">
                    <span className="wrap-break-word">
                      {p.dateISO} · {shiftOptions.find((s) => s.value === p.shift)?.label}
                    </span>
                    {(() => {
                      const badge = dayBadge(p.dateISO, p.breakdown)
                      return <span className={badgeTone[badge.tone]}>{badge.label}</span>
                    })()}
                    {p.shift === 'adicional' || hasOvertime(p.breakdown) ? (
                      <span className={badgeTone.extra}>{p.shift === 'adicional' ? 'Adicional' : 'Horas extra'}</span>
                    ) : null}
                  </div>
                  <span
                    className="w-fit rounded-full border px-3 py-1 text-xs text-slate-900 sm:shrink-0 sm:self-center"
                    style={{ borderColor: 'rgba(15, 23, 42, 0.18)' }}
                  >
                    {formatCop(p.breakdown.totalPayCop)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}
