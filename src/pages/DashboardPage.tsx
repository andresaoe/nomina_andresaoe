import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, onSupabaseConfigChange } from '../lib/supabaseClient'
import { useOnline } from '../hooks/useOnline'
import { useSession } from '../hooks/useSession'
import DashboardShell from '../components/layout/DashboardShell'
import KpiCard from '../components/dashboard/KpiCard'
import SimpleBarChart from '../components/dashboard/SimpleBarChart'
import { enqueueEntry, getPendingEntries, removePendingEntries } from '../lib/offlineQueue'
import {
  calculateShifts,
  calculateShiftsMerged,
  enumerateDates,
  formatCop,
  hourlyRateFromBaseSalaryCop,
  roundCop,
  summarizeMonth,
} from '../lib/payroll/payrollCalculator'
import type { NoveltyType, ShiftCalcBreakdown, ShiftCalculation, ShiftType } from '../lib/payroll/types'
import type { DeductionItem, EarningItem } from '../lib/payroll/payrollCalculator'

type SavedRow = {
  id: string
  work_date: string
  shift: ShiftType
  novelty: NoveltyType
  total_pay_cop: number
  breakdown?: ShiftCalcBreakdown
  created_at: string
}

type MonthRow = {
  work_date: string
  novelty: NoveltyType
  total_pay_cop: number
  breakdown: ShiftCalcBreakdown
}

function todayISO() {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function toISODate(date: Date) {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function weekStartIsoFromDateISO(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`)
  const day = d.getDay()
  const diffToMonday = (day + 6) % 7
  d.setDate(d.getDate() - diffToMonday)
  return toISODate(d)
}

function weekEndIsoFromDateISO(dateISO: string) {
  const d = new Date(`${dateISO}T00:00:00`)
  const day = d.getDay()
  const diffToSunday = (7 - day) % 7
  d.setDate(d.getDate() + diffToSunday)
  return toISODate(d)
}

function monthBounds(prefixYYYYMM: string) {
  const [yStr, mStr] = prefixYYYYMM.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  const start = `${prefixYYYYMM}-01`
  const lastDay = new Date(y, m, 0).getDate()
  const end = `${prefixYYYYMM}-${String(lastDay).padStart(2, '0')}`
  return { start, end }
}

const noveltyOptions: { value: NoveltyType; label: string; tint?: string }[] = [
  { value: 'normal', label: 'Turno normal' },
  { value: 'incapacidad_eps', label: 'Incapacidad por EPS (66.67%)', tint: '#4aa3ff' },
  { value: 'incapacidad_arl', label: 'Incapacidad por ARL (100%)', tint: '#4aa3ff' },
  { value: 'vacaciones', label: 'Vacaciones (100%)', tint: '#f7d24a' },
  { value: 'licencia_remunerada', label: 'Licencia remunerada (100%)', tint: '#f7d24a' },
  { value: 'licencia_no_remunerada', label: 'Licencia no remunerada (0%)', tint: '#ff7a7a' },
  { value: 'dia_familia', label: 'Día de la familia (100%)', tint: '#b8f7c1' },
  { value: 'cumpleanos', label: 'Día de cumpleaños (100%)', tint: '#b8f7c1' },
  { value: 'ausencia', label: 'Ausencia no justificada (0%)', tint: '#ff7a7a' },
]

const shiftOptions: { value: ShiftType; label: string }[] = [
  { value: 'manana', label: 'Mañana (5am–1pm)' },
  { value: 'tarde', label: 'Tarde (1pm–9pm)' },
  { value: 'noche', label: 'Noche (9pm–5am)' },
]

const rangeNovelties: NoveltyType[] = [
  'vacaciones',
  'licencia_remunerada',
  'licencia_no_remunerada',
  'incapacidad_eps',
  'incapacidad_arl',
]

function noveltyRequiresRange(novelty: NoveltyType) {
  return rangeNovelties.includes(novelty)
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const session = useSession()
  const online = useOnline()
  const [, setSupabaseVersion] = useState(0)
  const supabase = getSupabase()

  const [baseSalaryCop, setBaseSalaryCop] = useState<number | null>(null)
  const [smmlvCop, setSmmlvCop] = useState<number | null>(null)
  const [transportAllowanceCop, setTransportAllowanceCop] = useState<number | null>(null)
  const [transportCapSmmlv, setTransportCapSmmlv] = useState<number>(2)
  const [earningsItems, setEarningsItems] = useState<EarningItem[]>([])
  const [deductionItems, setDeductionItems] = useState<DeductionItem[]>([])
  const [applyStandardDeductions, setApplyStandardDeductions] = useState(true)
  const [healthPct, setHealthPct] = useState<number>(4)
  const [pensionPct, setPensionPct] = useState<number>(4)
  const [applySolidarityFund, setApplySolidarityFund] = useState(true)
  const [ibcMinSmmlv, setIbcMinSmmlv] = useState<number>(1)
  const [ibcMaxSmmlv, setIbcMaxSmmlv] = useState<number>(25)

  const [savingConfig, setSavingConfig] = useState(false)

  const [startISO, setStartISO] = useState(todayISO())
  const [endISO, setEndISO] = useState(todayISO())
  const [shift, setShift] = useState<ShiftType>('manana')
  const [novelty, setNovelty] = useState<NoveltyType>('normal')

  const [preview, setPreview] = useState<ShiftCalculation[] | null>(null)
  const [saved, setSaved] = useState<SavedRow[] | null>(null)
  const [monthRows, setMonthRows] = useState<MonthRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loadingRows, setLoadingRows] = useState(false)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [savingRows, setSavingRows] = useState(false)
  const [rowsLoadError, setRowsLoadError] = useState<string | null>(null)
  const [monthLoadError, setMonthLoadError] = useState<string | null>(null)

  const [pendingCount, setPendingCount] = useState(() => getPendingEntries().length)
  const [pendingEntries, setPendingEntries] = useState(() => getPendingEntries())
  const [activeNavId, setActiveNavId] = useState<'resumen' | 'turnos' | 'config' | 'datos'>('resumen')

  const requiresRange = noveltyRequiresRange(novelty)
  const currentUserEmail = session.status === 'signed_in' ? (session.session.user.email ?? '') : ''
  const isAdmin = currentUserEmail.toLowerCase() === 'andresaoe@gmail.com'

  useEffect(() => {
    if (!isAdmin && activeNavId === 'datos') setActiveNavId('resumen')
  }, [activeNavId, isAdmin])

  useEffect(() => {
    if (!requiresRange && endISO !== startISO) setEndISO(startISO)
  }, [endISO, requiresRange, startISO])

  useEffect(() => {
    if (requiresRange) setPreview(null)
  }, [requiresRange])

  useEffect(() => {
    setPendingCount(getPendingEntries().length)
  }, [online])

  useEffect(() => {
    setPendingEntries(getPendingEntries())
  }, [pendingCount])

  useEffect(() => {
    return onSupabaseConfigChange(() => setSupabaseVersion((v) => v + 1))
  }, [])

  const selectedMonthPrefix = useMemo(() => startISO.slice(0, 7), [startISO])

  const supabaseSetupSql = useMemo(
    () => `create extension if not exists pgcrypto;

create table if not exists public.shift_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  shift text not null,
  novelty text not null,
  hourly_rate_cop integer not null,
  total_pay_cop integer not null,
  breakdown jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.shift_entries enable row level security;

create policy "shift_entries_select_own"
on public.shift_entries for select
using (auth.uid() = user_id);

create policy "shift_entries_insert_own"
on public.shift_entries for insert
with check (auth.uid() = user_id);

create policy "shift_entries_update_own"
on public.shift_entries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "shift_entries_delete_own"
on public.shift_entries for delete
using (auth.uid() = user_id);`,
    [],
  )

  useEffect(() => {
    if (session.status !== 'signed_in') return
    const meta = session.session.user.user_metadata ?? {}
    const salary = meta.base_salary_cop
    if (typeof salary === 'number') setBaseSalaryCop(salary)
    if (typeof meta.smmlv_cop === 'number') setSmmlvCop(meta.smmlv_cop)
    if (typeof meta.transport_allowance_cop === 'number') setTransportAllowanceCop(meta.transport_allowance_cop)
    if (typeof meta.transport_salary_cap_smmlv === 'number') setTransportCapSmmlv(meta.transport_salary_cap_smmlv)
    if (typeof meta.apply_solidarity_fund === 'boolean') setApplySolidarityFund(meta.apply_solidarity_fund)
    if (typeof meta.ibc_min_smmlv === 'number') setIbcMinSmmlv(meta.ibc_min_smmlv)
    if (typeof meta.ibc_max_smmlv === 'number') setIbcMaxSmmlv(meta.ibc_max_smmlv)
    if (typeof meta.apply_standard_deductions === 'boolean')
      setApplyStandardDeductions(meta.apply_standard_deductions)
    if (typeof meta.health_pct === 'number') setHealthPct(meta.health_pct * 100)
    if (typeof meta.pension_pct === 'number') setPensionPct(meta.pension_pct * 100)

    const metaEarnings = Array.isArray(meta.earnings_items) ? (meta.earnings_items as EarningItem[]) : null
    const metaDeductions = Array.isArray(meta.deduction_items) ? (meta.deduction_items as DeductionItem[]) : null
    if (metaEarnings) setEarningsItems(metaEarnings)
    if (metaDeductions) setDeductionItems(metaDeductions)

    if (!metaEarnings && typeof meta.other_earnings_cop === 'number' && meta.other_earnings_cop > 0) {
      setEarningsItems([
        { id: crypto.randomUUID(), label: 'Otros devengos', amountCop: meta.other_earnings_cop, isSalary: true },
      ])
    }
    if (!metaDeductions && typeof meta.other_deductions_cop === 'number' && meta.other_deductions_cop > 0) {
      setDeductionItems([{ id: crypto.randomUUID(), label: 'Otras deducciones', amountCop: meta.other_deductions_cop }])
    }
  }, [session])

  const hourlyRate = useMemo(() => {
    if (!baseSalaryCop || baseSalaryCop <= 0) return null
    return hourlyRateFromBaseSalaryCop(baseSalaryCop)
  }, [baseSalaryCop])

  useEffect(() => {
    async function load() {
      if (!supabase || session.status !== 'signed_in') return
      setLoadingRows(true)
      setError(null)
      setRowsLoadError(null)
      try {
        const { data, error: selectError } = await supabase
          .from('shift_entries')
          .select('id, work_date, shift, novelty, total_pay_cop, created_at')
          .order('work_date', { ascending: false })
          .limit(60)
        if (selectError) {
          setSaved(null)
          setRowsLoadError(selectError.message)
          return
        }
        setSaved((data ?? []) as SavedRow[])
      } finally {
        setLoadingRows(false)
      }
    }
    load()
  }, [session.status, supabase])

  useEffect(() => {
    async function loadMonth() {
      if (!supabase || session.status !== 'signed_in') return
      const { start, end } = monthBounds(selectedMonthPrefix)
      setLoadingMonth(true)
      setMonthLoadError(null)
      try {
        const { data, error: selectError } = await supabase
          .from('shift_entries')
          .select('work_date, novelty, total_pay_cop, breakdown')
          .gte('work_date', start)
          .lte('work_date', end)
          .order('work_date', { ascending: true })
          .limit(1000)
        if (selectError) {
          setMonthRows(null)
          setMonthLoadError(selectError.message)
          return
        }
        setMonthRows((data ?? []) as MonthRow[])
      } finally {
        setLoadingMonth(false)
      }
    }
    loadMonth()
  }, [selectedMonthPrefix, session.status, supabase])

  useEffect(() => {
    async function syncPending() {
      if (!supabase || session.status !== 'signed_in') return
      if (!online) return
      const pending = getPendingEntries()
      if (!pending.length) return

      const { error: insertError } = await supabase.from('shift_entries').insert(pending.map((p) => p.payload))
      if (insertError) return
      removePendingEntries(pending.map((p) => p.id))
      setPendingCount(getPendingEntries().length)
      setInfo('Se sincronizaron turnos guardados sin conexión.')
    }
    syncPending()
  }, [online, session.status, supabase])

  const monthEntries = useMemo(() => {
    const pending = pendingEntries
      .map((p) => p.payload as Record<string, unknown>)
      .filter((p) => typeof p.work_date === 'string' && (p.work_date as string).startsWith(selectedMonthPrefix))
      .map((p) => ({
        work_date: p.work_date as string,
        novelty: p.novelty as NoveltyType,
        total_pay_cop: (p.total_pay_cop as number) ?? 0,
        breakdown: (p.breakdown as ShiftCalcBreakdown) ?? ({} as ShiftCalcBreakdown),
      }))

    const rows = (monthRows ?? []).concat(pending)
    rows.sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
    return rows.map((r) => ({
      workDateISO: r.work_date,
      novelty: r.novelty,
      totalPayCop: r.total_pay_cop,
      breakdown: r.breakdown,
    }))
  }, [monthRows, pendingEntries, selectedMonthPrefix])

  const monthTotal = useMemo(() => {
    const total = monthEntries.reduce((acc, e) => acc + (e.totalPayCop || 0), 0)
    return total > 0 ? total : null
  }, [monthEntries])

  const dailyPayPoints = useMemo(() => {
    if (!monthEntries.length) return []
    const { start, end } = monthBounds(selectedMonthPrefix)
    const days = enumerateDates(start, end)
    const totals = new Map<string, number>()
    for (const e of monthEntries) totals.set(e.workDateISO, (totals.get(e.workDateISO) ?? 0) + (e.totalPayCop || 0))
    return days.map((d) => ({ label: d.slice(8, 10), value: totals.get(d) ?? 0 }))
  }, [monthEntries, selectedMonthPrefix])

  const monthSummary = useMemo(() => {
    if (!hourlyRate) return null
    if (!monthEntries.length) return null

    const config = {
      monthISO: selectedMonthPrefix,
      baseSalaryCop: baseSalaryCop ?? 0,
      smmlvCop: smmlvCop ?? 0,
      transportAllowanceCop: transportAllowanceCop ?? 0,
      transportSalaryCapSmmlv: transportCapSmmlv,
      earningsItems,
      deductionItems,
      applyStandardDeductions,
      healthPct: healthPct / 100,
      pensionPct: pensionPct / 100,
      applySolidarityFund,
      ibcMinSmmlv,
      ibcMaxSmmlv,
    }

    return summarizeMonth(monthEntries, config)
  }, [
    applyStandardDeductions,
    applySolidarityFund,
    baseSalaryCop,
    deductionItems,
    earningsItems,
    healthPct,
    hourlyRate,
    ibcMaxSmmlv,
    ibcMinSmmlv,
    monthEntries,
    pensionPct,
    selectedMonthPrefix,
    smmlvCop,
    transportAllowanceCop,
    transportCapSmmlv,
  ])

  const calculateForRange = useCallback(
    async (dates: string[]) => {
      if (!hourlyRate) return []
      if (!supabase || session.status !== 'signed_in' || !online) {
        return calculateShifts(dates, shift, novelty, hourlyRate)
      }

      const fetchFrom = weekStartIsoFromDateISO(dates[0] ?? startISO)
      const fetchTo = weekEndIsoFromDateISO(dates[dates.length - 1] ?? endISO)

      const { data, error: selectError } = await supabase
        .from('shift_entries')
        .select('work_date, shift, novelty')
        .gte('work_date', fetchFrom)
        .lte('work_date', fetchTo)

      if (selectError || !data) {
        return calculateShifts(dates, shift, novelty, hourlyRate)
      }

      const existing = (data as { work_date: string; shift: ShiftType; novelty: NoveltyType }[])
        .filter((r) => r.work_date)
        .map((r) => ({ dateISO: r.work_date, shift: r.shift, novelty: r.novelty, tag: 'existing' as const }))

      const current = dates.map((d) => ({ dateISO: d, shift, novelty, tag: 'new' as const }))

      const merged = calculateShiftsMerged([...existing, ...current], hourlyRate)
      return merged.slice(existing.length)
    },
    [endISO, hourlyRate, novelty, online, session.status, shift, startISO, supabase],
  )

  useEffect(() => {
    if (session.status !== 'signed_in') return
    if (!hourlyRate) return
    if (requiresRange) return
    const dates = enumerateDates(startISO, startISO)
    calculateForRange(dates).then((result) => setPreview(result))
  }, [calculateForRange, hourlyRate, requiresRange, session.status, startISO])

  async function onSignOut() {
    if (supabase) await supabase.auth.signOut()
    navigate('/auth', { replace: true })
  }

  async function onSavePayrollConfig() {
    setError(null)
    setInfo(null)
    if (!supabase || session.status !== 'signed_in') return
    if (!baseSalaryCop || baseSalaryCop < 1 || baseSalaryCop > 19999999) {
      setError('La base salarial debe estar entre 1 y 19.999.999 COP.')
      return
    }

    if (smmlvCop !== null && smmlvCop < 0) {
      setError('El SMMLV debe ser un entero positivo.')
      return
    }
    if (transportAllowanceCop !== null && transportAllowanceCop < 0) {
      setError('El auxilio de transporte debe ser un entero positivo.')
      return
    }
    if (transportCapSmmlv <= 0) {
      setError('El tope en SMMLV debe ser mayor a 0.')
      return
    }
    if (healthPct < 0 || pensionPct < 0) {
      setError('Los porcentajes no pueden ser negativos.')
      return
    }
    if (ibcMinSmmlv <= 0 || ibcMaxSmmlv <= 0 || ibcMinSmmlv > ibcMaxSmmlv) {
      setError('IBC mínimo/máximo inválido.')
      return
    }

    setSavingConfig(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        data: {
          ...session.session.user.user_metadata,
          base_salary_cop: baseSalaryCop,
          smmlv_cop: smmlvCop ?? 0,
          transport_allowance_cop: transportAllowanceCop ?? 0,
          transport_salary_cap_smmlv: transportCapSmmlv,
          earnings_items: earningsItems,
          deduction_items: deductionItems,
          other_earnings_cop: 0,
          other_deductions_cop: 0,
          apply_standard_deductions: applyStandardDeductions,
          health_pct: healthPct / 100,
          pension_pct: pensionPct / 100,
          apply_solidarity_fund: applySolidarityFund,
          ibc_min_smmlv: ibcMinSmmlv,
          ibc_max_smmlv: ibcMaxSmmlv,
        },
      })
      if (updateError) setError(updateError.message)
      else setInfo('Configuración de nómina actualizada.')
    } finally {
      setSavingConfig(false)
    }
  }

  async function onPreview() {
    setError(null)
    setInfo(null)
    if (!hourlyRate) {
      setError('Configura primero la base salarial.')
      return
    }
    const dates = enumerateDates(startISO, requiresRange ? endISO : startISO)
    setPreview(await calculateForRange(dates))
  }

  async function onSaveTurns() {
    setError(null)
    setInfo(null)
    if (!supabase || session.status !== 'signed_in') {
      setError('No hay sesión activa.')
      return
    }
    if (!hourlyRate) {
      setError('Configura primero la base salarial.')
      return
    }

    const dates = enumerateDates(startISO, requiresRange ? endISO : startISO)
    const calculations = await calculateForRange(dates)

    setSavingRows(true)
    try {
      const payloads = calculations.map((calc) => ({
        user_id: session.session.user.id,
        work_date: calc.dateISO,
        shift: calc.shift,
        novelty: calc.novelty,
        hourly_rate_cop: roundCop(hourlyRate),
        total_pay_cop: calc.breakdown.totalPayCop,
        breakdown: calc.breakdown,
      }))

      if (!online) {
        for (const payload of payloads) {
          enqueueEntry({ id: crypto.randomUUID(), payload, createdAt: new Date().toISOString() })
        }
        setPendingCount(getPendingEntries().length)
        setInfo('Sin conexión: turnos guardados en el dispositivo para sincronizar luego.')
        setPreview(calculations)
        return
      }

      const { error: insertError } = await supabase.from('shift_entries').insert(payloads)
      if (insertError) {
        const message = insertError.message || 'No se pudieron guardar los turnos.'
        for (const payload of payloads) {
          enqueueEntry({ id: crypto.randomUUID(), payload, createdAt: new Date().toISOString() })
        }
        setPendingCount(getPendingEntries().length)
        setInfo('No se pudo guardar en la nube. Se guardó localmente para sincronizar luego.')
        setError(message)
        setPreview(calculations)
        return
      }

      setPreview(calculations)
      setInfo('Turnos guardados en la nube.')

      const { data } = await supabase
        .from('shift_entries')
        .select('id, work_date, shift, novelty, total_pay_cop, created_at')
        .order('work_date', { ascending: false })
        .limit(60)
      setSaved((data ?? []) as SavedRow[])
    } finally {
      setSavingRows(false)
    }
  }

  const earningsDetail = useMemo(() => {
    const items = (earningsItems ?? []).filter((i) => i.amountCop !== 0)
    return {
      salary: items.filter((i) => i.isSalary),
      nonSalary: items.filter((i) => !i.isSalary),
    }
  }, [earningsItems])

  const deductionDetail = useMemo(() => {
    return (deductionItems ?? []).filter((i) => i.amountCop !== 0)
  }, [deductionItems])

  if (session.status !== 'signed_in') return null

  const noveltyTint = (value: NoveltyType) =>
    noveltyOptions.find((n) => n.value === value)?.tint ?? 'rgba(15, 23, 42, 0.18)'

  const navItems = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'turnos', label: 'Turnos' },
    { id: 'config', label: 'Configuración' },
    ...(isAdmin ? [{ id: 'datos', label: 'Datos y SQL' }] : []),
  ]

  const inputClass =
    'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/20'
  const selectClass =
    'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950/20'
  const cardClass = 'rounded-2xl bg-white p-5 ring-1 ring-slate-200'
  const btnBase =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-950/20 disabled:cursor-not-allowed disabled:opacity-50'
  const btnPrimary = `${btnBase} bg-slate-950 text-white hover:bg-slate-900`
  const btnNeutral = `${btnBase} bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50`

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={session.session.user.email ?? undefined}
      navItems={navItems}
      activeNavId={activeNavId}
      onSelectNav={(id) => {
        if (!isAdmin && id === 'datos') return
        setActiveNavId(id as 'resumen' | 'turnos' | 'config' | 'datos')
      }}
      rightSlot={
        <>
          <span
            className={
              online
                ? 'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm text-emerald-700'
                : 'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-sm text-amber-800'
            }
          >
            {online ? 'Online' : 'Offline'}
          </span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-sm text-slate-700">
            Pendientes: {pendingCount}
          </span>
          <button type="button" className={btnNeutral} onClick={onSignOut}>
            Cerrar sesión
          </button>
        </>
      }
    >
      <div className="grid gap-6">
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            {info}
          </div>
        ) : null}

        {activeNavId === 'resumen' ? (
          <div className="grid gap-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <KpiCard
                label={`Resumen mensual (${selectedMonthPrefix})`}
                value={monthSummary ? formatCop(monthSummary.netPayCop) : '—'}
                helper="Neto a pagar"
                tone="good"
              />
              <KpiCard
                label="Total devengado"
                value={monthSummary ? formatCop(monthSummary.grossPayCop) : '—'}
                helper="Bruto"
              />
              <KpiCard
                label="Total deducciones"
                value={monthSummary ? formatCop(monthSummary.totalDeductionsCop) : '—'}
                helper="Salud, pensión y otras"
                tone={monthSummary && monthSummary.totalDeductionsCop > 0 ? 'warn' : 'default'}
              />
              <KpiCard label="IBC" value={monthSummary ? formatCop(monthSummary.ibcCop) : '—'} helper="Base aportes" />
              <KpiCard
                label="Auxilio transporte"
                value={monthSummary ? formatCop(monthSummary.transportAllowanceCop) : '—'}
                helper={
                  monthSummary
                    ? monthSummary.transportEligible
                      ? `${monthSummary.transportProrationDays.toFixed(2)} / 30`
                      : 'No aplica'
                    : undefined
                }
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
                  {!dailyPayPoints.length ? (
                    <div className="text-sm text-slate-600">Aún no hay datos del mes.</div>
                  ) : (
                    <SimpleBarChart points={dailyPayPoints} />
                  )}
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
                      Horas: Diurnas {monthSummary.hoursDay} · Nocturnas {monthSummary.hoursNight} · Dom/Fest diurnas{' '}
                      {monthSummary.hoursSundayOrHolidayDay} · Dom/Fest nocturnas {monthSummary.hoursSundayOrHolidayNight}{' '}
                      · Extra {monthSummary.overtimeHoursTotal}
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
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Devengos adicionales
                            </div>
                            {earningsDetail.salary.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-700">
                                  {item.label} <span className="text-slate-500">(Salarial)</span>
                                </span>
                                <span className="text-slate-950">{formatCop(item.amountCop)}</span>
                              </div>
                            ))}
                            {earningsDetail.nonSalary.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-700">
                                  {item.label} <span className="text-slate-500">(No salarial)</span>
                                </span>
                                <span className="text-slate-950">{formatCop(item.amountCop)}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}

                        {deductionDetail.length ? (
                          <div className="grid gap-2">
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Deducciones adicionales
                            </div>
                            {deductionDetail.map((item) => (
                              <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                                <span className="text-slate-700">{item.label}</span>
                                <span className="text-slate-950">{formatCop(item.amountCop)}</span>
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
        ) : null}

        {activeNavId === 'turnos' ? (
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

              {!supabase ? (
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
                <div className="text-xs text-slate-600">
                  Hora estimada: {hourlyRate ? formatCop(hourlyRate) : '—'} (44h/semana)
                </div>
              </div>
            </div>

            <div className="grid gap-6">
              {preview ? (
                <div className={cardClass}>
                  <div className="flex items-center justify-between gap-4">
                    <div className="text-base font-semibold text-slate-950">Previsualización</div>
                    <div className="text-sm text-slate-600">
                      Total: {formatCop(preview.reduce((acc, p) => acc + p.breakdown.totalPayCop, 0))}
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2">
                    {preview.slice(0, 20).map((p) => (
                      <div key={`${p.dateISO}-${p.shift}-${p.novelty}`} className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2 text-sm">
                        <span className="text-slate-700">
                          {p.dateISO} · {shiftOptions.find((s) => s.value === p.shift)?.label}
                        </span>
                        <span
                          className="rounded-full border px-3 py-1 text-xs text-slate-900"
                          style={{ borderColor: noveltyTint(p.novelty) }}
                        >
                          {formatCop(p.breakdown.totalPayCop)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {preview.length > 20 ? <div className="mt-2 text-xs text-slate-600">Mostrando 20 de {preview.length}</div> : null}
                </div>
              ) : null}

              <div className={cardClass}>
                <div className="text-base font-semibold text-slate-950">Últimos turnos guardados</div>
                {loadingRows ? (
                  <div className="mt-3 text-sm text-slate-600">Cargando…</div>
                ) : !saved ? (
                  <div className="mt-3 text-sm text-slate-700">
                    No se pudieron leer turnos desde Supabase{rowsLoadError ? `: ${rowsLoadError}` : ''}.
                    <div className="mt-3">
                      <button
                        type="button"
                        className={btnNeutral}
                        onClick={() => {
                          navigator.clipboard?.writeText(supabaseSetupSql)
                          setInfo('SQL copiado. Pégalo en Supabase → SQL Editor.')
                        }}
                        disabled={!navigator.clipboard}
                      >
                        Copiar SQL de la tabla
                      </button>
                    </div>
                  </div>
                ) : saved.length === 0 ? (
                  <div className="mt-3 text-sm text-slate-600">Aún no hay turnos guardados.</div>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {saved.map((row) => (
                      <div key={row.id} className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2 text-sm">
                        <span className="text-slate-700">
                          {row.work_date} · {shiftOptions.find((s) => s.value === row.shift)?.label}
                        </span>
                        <span className="rounded-full border px-3 py-1 text-xs text-slate-900" style={{ borderColor: noveltyTint(row.novelty) }}>
                          {formatCop(row.total_pay_cop)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeNavId === 'config' ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="text-base font-semibold text-slate-950">Configuración de nómina</div>
              <div className="mt-4 grid gap-3">
                <label className="text-sm text-slate-700">
                  Base salarial mensual (COP)
                  <input
                    className={inputClass}
                    value={baseSalaryCop ?? ''}
                    onChange={(e) => setBaseSalaryCop(Number(e.target.value.replace(/[^\d]/g, '')) || null)}
                    inputMode="numeric"
                    placeholder="Ej: 1300000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  SMMLV (COP)
                  <input
                    className={inputClass}
                    value={smmlvCop ?? ''}
                    onChange={(e) => setSmmlvCop(Number(e.target.value.replace(/[^\d]/g, '')) || null)}
                    inputMode="numeric"
                    placeholder="Ej: 1300000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Auxilio de transporte mensual (COP)
                  <input
                    className={inputClass}
                    value={transportAllowanceCop ?? ''}
                    onChange={(e) => setTransportAllowanceCop(Number(e.target.value.replace(/[^\d]/g, '')) || null)}
                    inputMode="numeric"
                    placeholder="Ej: 162000"
                  />
                </label>
                <label className="text-sm text-slate-700">
                  Tope auxilio (SMMLV)
                  <input
                    className={inputClass}
                    value={transportCapSmmlv}
                    onChange={(e) => setTransportCapSmmlv(Number(e.target.value) || 2)}
                    inputMode="numeric"
                    placeholder="2"
                  />
                </label>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">Devengos adicionales</div>
                    <button
                      type="button"
                      className={btnNeutral}
                      onClick={() =>
                        setEarningsItems((prev) => [
                          ...prev,
                          { id: crypto.randomUUID(), label: 'Nuevo devengo', amountCop: 0, isSalary: true },
                        ])
                      }
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {earningsItems.length === 0 ? (
                      <div className="text-sm text-slate-600">Sin devengos adicionales.</div>
                    ) : (
                      earningsItems.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-12 sm:items-center">
                          <input
                            className={`${inputClass} sm:col-span-5 sm:mt-0`}
                            value={item.label}
                            onChange={(e) =>
                              setEarningsItems((prev) =>
                                prev.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x)),
                              )
                            }
                          />
                          <input
                            className={`${inputClass} sm:col-span-3 sm:mt-0`}
                            value={item.amountCop}
                            onChange={(e) =>
                              setEarningsItems((prev) =>
                                prev.map((x) =>
                                  x.id === item.id
                                    ? { ...x, amountCop: Number(e.target.value.replace(/[^\d]/g, '')) || 0 }
                                    : x,
                                ),
                              )
                            }
                            inputMode="numeric"
                          />
                          <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                            <input
                              type="checkbox"
                              checked={item.isSalary}
                              onChange={(e) =>
                                setEarningsItems((prev) =>
                                  prev.map((x) => (x.id === item.id ? { ...x, isSalary: e.target.checked } : x)),
                                )
                              }
                            />
                            Salarial
                          </label>
                          <div className="sm:col-span-2 sm:text-right">
                            <button type="button" className={btnNeutral} onClick={() => setEarningsItems((prev) => prev.filter((x) => x.id !== item.id))}>
                              Quitar
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-medium text-slate-900">Deducciones adicionales</div>
                    <button
                      type="button"
                      className={btnNeutral}
                      onClick={() =>
                        setDeductionItems((prev) => [
                          ...prev,
                          { id: crypto.randomUUID(), label: 'Nueva deducción', amountCop: 0 },
                        ])
                      }
                    >
                      Agregar
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2">
                    {deductionItems.length === 0 ? (
                      <div className="text-sm text-slate-600">Sin deducciones adicionales.</div>
                    ) : (
                      deductionItems.map((item) => (
                        <div key={item.id} className="grid gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-200 sm:grid-cols-12 sm:items-center">
                          <input
                            className={`${inputClass} sm:col-span-7 sm:mt-0`}
                            value={item.label}
                            onChange={(e) =>
                              setDeductionItems((prev) =>
                                prev.map((x) => (x.id === item.id ? { ...x, label: e.target.value } : x)),
                              )
                            }
                          />
                          <input
                            className={`${inputClass} sm:col-span-3 sm:mt-0`}
                            value={item.amountCop}
                            onChange={(e) =>
                              setDeductionItems((prev) =>
                                prev.map((x) =>
                                  x.id === item.id
                                    ? { ...x, amountCop: Number(e.target.value.replace(/[^\d]/g, '')) || 0 }
                                    : x,
                                ),
                              )
                            }
                            inputMode="numeric"
                          />
                          <div className="sm:col-span-2 sm:text-right">
                            <button type="button" className={btnNeutral} onClick={() => setDeductionItems((prev) => prev.filter((x) => x.id !== item.id))}>
                              Quitar
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={applyStandardDeductions} onChange={(e) => setApplyStandardDeductions(e.target.checked)} />
                  Aplicar deducciones estándar (salud y pensión)
                </label>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input type="checkbox" checked={applySolidarityFund} onChange={(e) => setApplySolidarityFund(e.target.checked)} />
                  Aplicar Fondo de Solidaridad Pensional (≥ 4 SMMLV)
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    Salud (%)
                    <input className={inputClass} value={healthPct} onChange={(e) => setHealthPct(Number(e.target.value) || 0)} inputMode="numeric" placeholder="4" />
                  </label>
                  <label className="text-sm text-slate-700">
                    Pensión (%)
                    <input className={inputClass} value={pensionPct} onChange={(e) => setPensionPct(Number(e.target.value) || 0)} inputMode="numeric" placeholder="4" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm text-slate-700">
                    IBC mínimo (SMMLV)
                    <input className={inputClass} value={ibcMinSmmlv} onChange={(e) => setIbcMinSmmlv(Number(e.target.value) || 1)} inputMode="numeric" placeholder="1" />
                  </label>
                  <label className="text-sm text-slate-700">
                    IBC máximo (SMMLV)
                    <input className={inputClass} value={ibcMaxSmmlv} onChange={(e) => setIbcMaxSmmlv(Number(e.target.value) || 25)} inputMode="numeric" placeholder="25" />
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button type="button" className={btnPrimary} onClick={onSavePayrollConfig} disabled={savingConfig || !baseSalaryCop}>
                    {savingConfig ? 'Guardando…' : 'Guardar configuración'}
                  </button>
                  <div className="text-xs text-slate-600">Hora estimada: {hourlyRate ? formatCop(hourlyRate) : '—'} (44h/semana)</div>
                </div>
              </div>
            </div>

            <div className={cardClass}>
              <div className="text-base font-semibold text-slate-950">Vista previa del mes</div>
              <div className="mt-2 text-sm text-slate-600">Datos usados: nube + pendientes del navegador</div>
              <div className="mt-4">
                {!dailyPayPoints.length ? <div className="text-sm text-slate-600">Aún no hay datos.</div> : <SimpleBarChart points={dailyPayPoints} />}
              </div>
            </div>
          </div>
        ) : null}

        {activeNavId === 'datos' && isAdmin ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="text-base font-semibold text-slate-950">SQL para crear tabla</div>
              <div className="mt-2 text-sm text-slate-600">Pégalo en Supabase → SQL Editor</div>
              <textarea
                className="mt-4 h-72 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-950/20"
                value={supabaseSetupSql}
                readOnly
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={btnNeutral}
                  onClick={() => {
                    navigator.clipboard?.writeText(supabaseSetupSql)
                    setInfo('SQL copiado. Pégalo en Supabase → SQL Editor.')
                  }}
                  disabled={!navigator.clipboard}
                >
                  Copiar SQL
                </button>
              </div>
            </div>

            <div className={cardClass}>
              <div className="text-base font-semibold text-slate-950">Estado</div>
              <div className="mt-4 grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">Mes</span>
                  <span className="text-slate-950">{selectedMonthPrefix}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">Registros cargados</span>
                  <span className="text-slate-950">{monthRows?.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-slate-700">Pendientes offline</span>
                  <span className="text-slate-950">{pendingCount}</span>
                </div>
                <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-200">
                  Si cambias de navegador, debes volver a configurar Supabase para sincronizar.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
