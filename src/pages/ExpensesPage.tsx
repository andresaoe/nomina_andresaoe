import { useMemo, useState } from 'react'
import { format } from 'date-fns'
import { readJson, writeJson } from '../lib/storage'
import { formatCop } from '../lib/payroll/payrollCalculator'

type ExpenseItem = {
  id: string
  dateISO: string
  category: string
  amountCop: number
  note?: string
}

type SavingGoal = {
  id: string
  label: string
  targetCop: number
  targetDateISO?: string
  savedCop: number
}

const EXPENSES_KEY = 'cn_expenses_v1'
const GOALS_KEY = 'cn_saving_goals_v1'

export default function ExpensesPage() {
  const [category, setCategory] = useState('General')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [dateISO, setDateISO] = useState(() => new Date().toISOString().slice(0, 10))

  const [goalLabel, setGoalLabel] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalDateISO, setGoalDateISO] = useState('')

  const [expenses, setExpenses] = useState<ExpenseItem[]>(() => readJson<ExpenseItem[]>(EXPENSES_KEY) ?? [])
  const [goals, setGoals] = useState<SavingGoal[]>(() => readJson<SavingGoal[]>(GOALS_KEY) ?? [])

  const monthPrefix = useMemo(() => dateISO.slice(0, 7), [dateISO])
  const monthExpenses = useMemo(() => expenses.filter((e) => e.dateISO.startsWith(monthPrefix)), [expenses, monthPrefix])
  const monthTotal = useMemo(() => monthExpenses.reduce((acc, e) => acc + (e.amountCop || 0), 0), [monthExpenses])

  const perCategory = useMemo(() => {
    const acc = new Map<string, number>()
    for (const e of monthExpenses) acc.set(e.category, (acc.get(e.category) ?? 0) + (e.amountCop || 0))
    return Array.from(acc.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
  }, [monthExpenses])

  function addExpense() {
    const amt = Number(amount) || 0
    if (amt <= 0) return
    const item: ExpenseItem = {
      id: crypto.randomUUID(),
      dateISO,
      category: category || 'General',
      amountCop: Math.round(amt),
      note: note || undefined,
    }
    const next = [item, ...expenses]
    setExpenses(next)
    writeJson(EXPENSES_KEY, next)
    setAmount('')
    setNote('')
  }

  function addGoal() {
    const target = Number(goalTarget) || 0
    if (!goalLabel || target <= 0) return
    const g: SavingGoal = {
      id: crypto.randomUUID(),
      label: goalLabel,
      targetCop: Math.round(target),
      targetDateISO: goalDateISO || undefined,
      savedCop: 0,
    }
    const next = [g, ...goals]
    setGoals(next)
    writeJson(GOALS_KEY, next)
    setGoalLabel('')
    setGoalTarget('')
    setGoalDateISO('')
  }

  function updateGoal(id: string, saved: number) {
    const next = goals.map((g) => (g.id === id ? { ...g, savedCop: Math.max(0, Math.round(saved)) } : g))
    setGoals(next)
    writeJson(GOALS_KEY, next)
  }

  function removeGoal(id: string) {
    const next = goals.filter((g) => g.id !== id)
    setGoals(next)
    writeJson(GOALS_KEY, next)
  }

  const todayLabel = format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_15%_-10%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(700px_circle_at_85%_0%,rgba(236,72,153,0.10),transparent_55%),radial-gradient(900px_circle_at_50%_110%,rgba(34,197,94,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-35 bg-[radial-gradient(rgba(15,23,42,0.10)_1px,transparent_1px)] bg-size-[22px_22px]" />

      <div className="relative mx-auto max-w-5xl px-4 py-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xl font-semibold text-slate-950">Control de gastos</div>
            <div className="text-sm text-slate-600">Registra tus gastos y metas de ahorro</div>
          </div>
          <div className="text-xs text-slate-500">Hoy: {todayLabel}</div>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
            <div className="text-base font-semibold text-slate-950">Agregar gasto</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                Fecha
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" type="date" value={dateISO} onChange={(e) => setDateISO(e.target.value)} />
              </label>
              <label className="text-sm text-slate-700">
                Categoría
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="General" />
              </label>
              <label className="text-sm text-slate-700">
                Monto (COP)
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="numeric" placeholder="0" />
              </label>
              <label className="text-sm text-slate-700">
                Nota
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opcional" />
              </label>
            </div>
            <div className="mt-3">
              <button type="button" className="inline-flex items-center justify-center rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-400 hover:to-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-white/30" onClick={addExpense}>
                Guardar gasto
              </button>
            </div>

            <div className="mt-6">
              <div className="text-sm font-medium text-slate-700">Gastos del mes</div>
              {!monthExpenses.length ? (
                <div className="mt-2 text-sm text-slate-600">Sin gastos registrados.</div>
              ) : (
                <div className="mt-2 grid gap-2">
                  {monthExpenses.map((e) => (
                    <div key={e.id} className="flex flex-col gap-1 rounded-xl border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                      <span className="min-w-0 wrap-break-word text-slate-700">
                        {e.dateISO} — {e.category} {e.note ? `· ${e.note}` : ''}
                      </span>
                      <span className="shrink-0 text-slate-950">{formatCop(e.amountCop)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-xs text-slate-600">Total del mes</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(monthTotal)}</div>
              </div>

              {!!perCategory.length && (
                <div className="mt-3 grid gap-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Por categoría</div>
                  {perCategory.map((p) => (
                    <div key={p.label} className="flex items-center justify-between text-sm">
                      <span className="text-slate-700">{p.label}</span>
                      <span className="text-slate-950">{formatCop(p.value)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
            <div className="text-base font-semibold text-slate-950">Metas de ahorro</div>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-slate-700">
                Meta
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)} placeholder="Ej. Fondo de emergencia" />
              </label>
              <label className="text-sm text-slate-700">
                Objetivo (COP)
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" value={goalTarget} onChange={(e) => setGoalTarget(e.target.value)} inputMode="numeric" placeholder="0" />
              </label>
              <label className="text-sm text-slate-700">
                Fecha objetivo
                <input className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20" type="date" value={goalDateISO} onChange={(e) => setGoalDateISO(e.target.value)} />
              </label>
            </div>
            <div className="mt-3">
              <button type="button" className="inline-flex items-center justify-center rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 px-3 py-2 text-sm font-medium text-white shadow-sm hover:from-indigo-400 hover:to-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-white/30" onClick={addGoal}>
                Crear meta
              </button>
            </div>

            {!goals.length ? (
              <div className="mt-4 text-sm text-slate-600">Aún no hay metas.</div>
            ) : (
              <div className="mt-4 grid gap-3">
                {goals.map((g) => {
                  const progress = Math.min(100, Math.max(0, Math.round((g.savedCop / Math.max(1, g.targetCop)) * 100)))
                  return (
                    <div key={g.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="min-w-0 wrap-break-word">
                          <div className="text-sm font-medium text-slate-900">{g.label}</div>
                          <div className="text-xs text-slate-600">
                            Objetivo {formatCop(g.targetCop)} {g.targetDateISO ? `· ${g.targetDateISO}` : ''}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-600">Ahorro</div>
                          <div className="text-sm font-semibold text-slate-950">{formatCop(g.savedCop)}</div>
                        </div>
                      </div>
                      <div className="mt-3 h-2 w-full rounded-full bg-slate-200">
                        <div className="h-2 rounded-full bg-emerald-500" style={{ width: `${progress}%` }} />
                      </div>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <label className="text-sm text-slate-700">
                          Actualizar ahorro (COP)
                          <input
                            className="mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
                            inputMode="numeric"
                            value={String(g.savedCop)}
                            onChange={(e) => updateGoal(g.id, Number(e.target.value) || 0)}
                          />
                        </label>
                        <button type="button" className="inline-flex items-center justify-center rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-slate-900 shadow-sm ring-1 ring-slate-200/70 backdrop-blur hover:bg-white/90" onClick={() => removeGoal(g.id)}>
                          Quitar meta
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="text-sm font-medium text-slate-700">Sugerencias</div>
              <div className="mt-2 grid gap-2 text-sm text-slate-700">
                <div>- Define un presupuesto mensual por categoría y compáralo con tus gastos reales.</div>
                <div>- Ahorra al menos el 10% del ingreso neto mensual; aumenta el porcentaje si hay excedente.</div>
                <div>- Usa metas con fecha para mantener la constancia y medir progreso.</div>
                <div>- Revisa gastos altos por categoría y reduce gradual y sostenidamente.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
