import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, onSupabaseConfigChange } from '../lib/supabaseClient'
import { useOnline } from '../hooks/useOnline'
import { useSession } from '../hooks/useSession'
import DashboardShell from '../components/layout/DashboardShell'
import KpiCard from '../components/dashboard/KpiCard'
import SimpleBarChart from '../components/dashboard/SimpleBarChart'
import {
  countUnsyncedLocalShiftEntries,
  deleteLocalShiftEntriesByIds,
  getLocalShiftEntryById,
  listLocalShiftEntriesForRange,
  listRecentLocalShiftEntries,
  listUnsyncedLocalShiftEntries,
  markLocalShiftEntriesSynced,
  upsertLocalShiftEntries,
} from '../lib/localDb'
import {
  calculateShifts,
  calculateShiftsMerged,
  enumerateDates,
  formatCop,
  hourlyRateFromBaseSalaryCop,
  roundCop,
  summarizeMonth,
} from '../lib/payroll/payrollCalculator'
import { isColombiaHoliday } from '../lib/payroll/colombiaHolidays'
import type { NoveltyType, ShiftCalcBreakdown, ShiftCalculation, ShiftType } from '../lib/payroll/types'
import type { DeductionItem, EarningItem, MonthSummary } from '../lib/payroll/payrollCalculator'

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
  { value: 'adicional', label: 'Turno adicional' },
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

function buildMonthPrefix(year: number, month1: number) {
  return `${year}-${String(month1).padStart(2, '0')}`
}

function monthDateFromPrefix(prefixYYYYMM: string) {
  const [yStr, mStr] = prefixYYYYMM.split('-')
  const y = Number(yStr)
  const m = Number(mStr)
  return new Date(y, m - 1, 1)
}

function addMonthsToPrefix(prefixYYYYMM: string, delta: number) {
  const base = monthDateFromPrefix(prefixYYYYMM)
  const d = new Date(base)
  d.setMonth(d.getMonth() + delta)
  return buildMonthPrefix(d.getFullYear(), d.getMonth() + 1)
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
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
  const [additionalStartTimeHHmm, setAdditionalStartTimeHHmm] = useState('18:00')
  const [additionalEndTimeHHmm, setAdditionalEndTimeHHmm] = useState('19:00')

  const [preview, setPreview] = useState<ShiftCalculation[] | null>(null)
  const [saved, setSaved] = useState<SavedRow[] | null>(null)
  const [savedSearch, setSavedSearch] = useState('')
  const [monthRows, setMonthRows] = useState<MonthRow[] | null>(null)
  const [editingRowId, setEditingRowId] = useState<string | null>(null)
  const [editWorkDateISO, setEditWorkDateISO] = useState(todayISO())
  const [editShift, setEditShift] = useState<ShiftType>('manana')
  const [editNovelty, setEditNovelty] = useState<NoveltyType>('normal')
  const [editAdditionalStartTimeHHmm, setEditAdditionalStartTimeHHmm] = useState('18:00')
  const [editAdditionalEndTimeHHmm, setEditAdditionalEndTimeHHmm] = useState('19:00')
  const [savingEdit, setSavingEdit] = useState(false)
  const [deletingRowId, setDeletingRowId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loadingRows, setLoadingRows] = useState(false)
  const [loadingMonth, setLoadingMonth] = useState(false)
  const [savingRows, setSavingRows] = useState(false)
  const [rowsLoadError, setRowsLoadError] = useState<string | null>(null)
  const [monthLoadError, setMonthLoadError] = useState<string | null>(null)

  type NavId = 'resumen' | 'turnos' | 'reportes' | 'config' | 'datos'
  const [activeNavId, setActiveNavId] = useState<NavId>('resumen')
  const [pendingCount, setPendingCount] = useState(0)
  const [reportsLoading, setReportsLoading] = useState(false)
  const [reportsError, setReportsError] = useState<string | null>(null)
  const [sixMonthSummaries, setSixMonthSummaries] = useState<MonthSummary[] | null>(null)
  const [yearSummaries, setYearSummaries] = useState<MonthSummary[] | null>(null)

  const requiresRange = noveltyRequiresRange(novelty)
  const currentUserEmail = session.status === 'signed_in' ? (session.session.user.email ?? '') : ''
  const isAdmin = currentUserEmail.toLowerCase() === 'andresaoe@gmail.com'
  const currentUserId = session.status === 'signed_in' ? session.session.user.id : null

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
    if (shift === 'adicional' && novelty !== 'normal') setNovelty('normal')
  }, [novelty, shift])

  useEffect(() => {
    if (editShift === 'adicional' && editNovelty !== 'normal') setEditNovelty('normal')
  }, [editNovelty, editShift])

  useEffect(() => {
    if (session.status !== 'signed_in') return
    if (!currentUserId) return
    countUnsyncedLocalShiftEntries(currentUserId)
      .then((count) => setPendingCount(count))
      .catch(() => setPendingCount(0))
  }, [currentUserId, online, session.status])

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
  shift text not null check (shift in ('manana','tarde','noche','adicional')),
  novelty text not null check (novelty in ('normal','incapacidad_eps','incapacidad_arl','vacaciones','licencia_remunerada','licencia_no_remunerada','dia_familia','cumpleanos','ausencia')),
  hourly_rate_cop integer not null check (hourly_rate_cop >= 0),
  total_pay_cop integer not null check (total_pay_cop >= 0),
  breakdown jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.shift_entries enable row level security;

drop policy if exists "shift_entries_select_own" on public.shift_entries;
create policy "shift_entries_select_own"
on public.shift_entries for select
using (auth.uid() = user_id);

drop policy if exists "shift_entries_insert_own" on public.shift_entries;
create policy "shift_entries_insert_own"
on public.shift_entries for insert
with check (auth.uid() = user_id);

drop policy if exists "shift_entries_update_own" on public.shift_entries;
create policy "shift_entries_update_own"
on public.shift_entries for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "shift_entries_delete_own" on public.shift_entries;
create policy "shift_entries_delete_own"
on public.shift_entries for delete
using (auth.uid() = user_id);

create index if not exists shift_entries_user_date_idx on public.shift_entries(user_id, work_date);
create index if not exists shift_entries_user_created_idx on public.shift_entries(user_id, created_at);`,
    [],
  )

  const copySupabaseSetupSql = useCallback(() => {
    if (!navigator.clipboard) return
    void navigator.clipboard.writeText(supabaseSetupSql)
    setInfo('SQL copiado. Pégalo en Supabase → SQL Editor.')
  }, [supabaseSetupSql])

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
    async function loadRecent() {
      if (session.status !== 'signed_in') return
      if (!currentUserId) return
      setLoadingRows(true)
      setError(null)
      setRowsLoadError(null)
      try {
        const local = await listRecentLocalShiftEntries(currentUserId, 60)
        setSaved(
          local.map((r) => ({
            id: r.id,
            work_date: r.work_date,
            shift: r.shift,
            novelty: r.novelty,
            total_pay_cop: r.total_pay_cop,
            breakdown: r.breakdown,
            created_at: r.created_at,
          })),
        )

        if (!online) return
        if (!supabase) return

        const { data, error: selectError } = await supabase
          .from('shift_entries')
          .select('id, user_id, work_date, shift, novelty, hourly_rate_cop, total_pay_cop, breakdown, created_at')
          .order('work_date', { ascending: false })
          .limit(200)

        if (selectError) {
          setRowsLoadError(selectError.message)
          return
        }

        const cloud = (data ?? []).filter((r) => r.user_id === currentUserId)
        await upsertLocalShiftEntries(
          cloud.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            work_date: r.work_date,
            shift: r.shift as ShiftType,
            novelty: r.novelty as NoveltyType,
            hourly_rate_cop: r.hourly_rate_cop,
            total_pay_cop: r.total_pay_cop,
            breakdown: r.breakdown as ShiftCalcBreakdown,
            created_at: r.created_at,
            synced: true,
          })),
        )

        const refreshed = await listRecentLocalShiftEntries(currentUserId, 60)
        setSaved(
          refreshed.map((r) => ({
            id: r.id,
            work_date: r.work_date,
            shift: r.shift,
            novelty: r.novelty,
            total_pay_cop: r.total_pay_cop,
            breakdown: r.breakdown,
            created_at: r.created_at,
          })),
        )
      } catch (err) {
        setSaved(null)
        setRowsLoadError(err instanceof Error ? err.message : 'No se pudieron leer turnos desde el dispositivo.')
      } finally {
        setLoadingRows(false)
      }
    }
    loadRecent()
  }, [currentUserId, online, session.status, supabase])

  useEffect(() => {
    async function loadMonth() {
      if (session.status !== 'signed_in') return
      if (!currentUserId) return
      const { start, end } = monthBounds(selectedMonthPrefix)
      setLoadingMonth(true)
      setMonthLoadError(null)
      try {
        const local = await listLocalShiftEntriesForRange(currentUserId, start, end)
        setMonthRows(
          local
            .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
            .map((r) => ({
              work_date: r.work_date,
              novelty: r.novelty,
              total_pay_cop: r.total_pay_cop,
              breakdown: r.breakdown,
            })),
        )

        if (!online) return
        if (!supabase) return

        const { data, error: selectError } = await supabase
          .from('shift_entries')
          .select('id, user_id, work_date, shift, novelty, hourly_rate_cop, total_pay_cop, breakdown, created_at')
          .gte('work_date', start)
          .lte('work_date', end)
          .order('work_date', { ascending: true })
          .limit(2000)

        if (selectError) {
          setMonthLoadError(selectError.message)
          return
        }

        const cloud = (data ?? []).filter((r) => r.user_id === currentUserId)
        await upsertLocalShiftEntries(
          cloud.map((r) => ({
            id: r.id,
            user_id: r.user_id,
            work_date: r.work_date,
            shift: r.shift as ShiftType,
            novelty: r.novelty as NoveltyType,
            hourly_rate_cop: r.hourly_rate_cop,
            total_pay_cop: r.total_pay_cop,
            breakdown: r.breakdown as ShiftCalcBreakdown,
            created_at: r.created_at,
            synced: true,
          })),
        )

        const refreshed = await listLocalShiftEntriesForRange(currentUserId, start, end)
        setMonthRows(
          refreshed
            .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
            .map((r) => ({
              work_date: r.work_date,
              novelty: r.novelty,
              total_pay_cop: r.total_pay_cop,
              breakdown: r.breakdown,
            })),
        )
      } catch (err) {
        setMonthRows(null)
        setMonthLoadError(err instanceof Error ? err.message : 'No se pudo cargar el mes desde el dispositivo.')
      } finally {
        setLoadingMonth(false)
      }
    }
    loadMonth()
  }, [currentUserId, online, selectedMonthPrefix, session.status, supabase])

  useEffect(() => {
    async function syncPending() {
      if (session.status !== 'signed_in') return
      if (!online) return
      if (!supabase) return
      if (!currentUserId) return
      try {
        const pending = await listUnsyncedLocalShiftEntries(currentUserId, 200)
        if (!pending.length) return

        const deletions = pending.filter((p) => p.deleted)
        const upserts = pending.filter((p) => !p.deleted)

        if (deletions.length) {
          const ids = deletions.map((p) => p.id)
          const { error: deleteError } = await supabase.from('shift_entries').delete().in('id', ids)
          if (deleteError) return
          await deleteLocalShiftEntriesByIds(currentUserId, ids)
        }

        if (upserts.length) {
          const payloads = upserts.map((p) => ({
            id: p.id,
            user_id: p.user_id,
            work_date: p.work_date,
            shift: p.shift,
            novelty: p.novelty,
            hourly_rate_cop: p.hourly_rate_cop,
            total_pay_cop: p.total_pay_cop,
            breakdown: p.breakdown,
            created_at: p.created_at,
          }))

          const { error: upsertError } = await supabase.from('shift_entries').upsert(payloads, { onConflict: 'id' })
          if (upsertError) return

          await markLocalShiftEntriesSynced(
            currentUserId,
            upserts.map((p) => p.id),
          )
        }
        setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
        setInfo('Se sincronizaron turnos guardados en el dispositivo.')
      } catch {
        return
      }
    }
    syncPending()
  }, [currentUserId, online, session.status, supabase])

  const monthEntries = useMemo(() => {
    const rows = (monthRows ?? []).slice()
    rows.sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
    return rows.map((r) => ({
      workDateISO: r.work_date,
      novelty: r.novelty,
      totalPayCop: r.total_pay_cop,
      breakdown: r.breakdown,
    }))
  }, [monthRows])

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

  const reportYear = useMemo(() => Number(selectedMonthPrefix.slice(0, 4)), [selectedMonthPrefix])

  useEffect(() => {
    async function loadReports() {
      if (activeNavId !== 'reportes') return
      if (!currentUserId) return
      if (!hourlyRate) return

      setReportsLoading(true)
      setReportsError(null)
      try {
        const configBase = {
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

        const sixMonths = Array.from({ length: 6 }, (_, i) => addMonthsToPrefix(selectedMonthPrefix, -(5 - i)))
        const six: MonthSummary[] = []
        for (const monthISO of sixMonths) {
          const { start, end } = monthBounds(monthISO)
          const local = await listLocalShiftEntriesForRange(currentUserId, start, end)
          const entries = local.map((r) => ({
            workDateISO: r.work_date,
            novelty: r.novelty,
            totalPayCop: r.total_pay_cop,
            breakdown: r.breakdown,
          }))
          six.push(
            summarizeMonth(entries, {
              ...configBase,
              monthISO,
            }),
          )
        }
        setSixMonthSummaries(six)

        const yearMonths = Array.from({ length: 12 }, (_, i) => buildMonthPrefix(reportYear, i + 1))
        const year: MonthSummary[] = []
        for (const monthISO of yearMonths) {
          const { start, end } = monthBounds(monthISO)
          const local = await listLocalShiftEntriesForRange(currentUserId, start, end)
          const entries = local.map((r) => ({
            workDateISO: r.work_date,
            novelty: r.novelty,
            totalPayCop: r.total_pay_cop,
            breakdown: r.breakdown,
          }))
          year.push(
            summarizeMonth(entries, {
              ...configBase,
              monthISO,
            }),
          )
        }
        setYearSummaries(year)
      } catch (err) {
        setSixMonthSummaries(null)
        setYearSummaries(null)
        setReportsError(err instanceof Error ? err.message : 'No se pudieron generar los reportes.')
      } finally {
        setReportsLoading(false)
      }
    }
    loadReports()
  }, [
    activeNavId,
    applySolidarityFund,
    applyStandardDeductions,
    baseSalaryCop,
    currentUserId,
    deductionItems,
    earningsItems,
    healthPct,
    hourlyRate,
    ibcMaxSmmlv,
    ibcMinSmmlv,
    pensionPct,
    reportYear,
    selectedMonthPrefix,
    smmlvCop,
    transportAllowanceCop,
    transportCapSmmlv,
  ])

  const sixMonthAvg = useMemo(() => {
    const months = sixMonthSummaries ?? []
    if (!months.length) return null
    const sumNet = months.reduce((acc, m) => acc + (m.netPayCop || 0), 0)
    const sumGross = months.reduce((acc, m) => acc + (m.grossPayCop || 0), 0)
    const sumShifts = months.reduce((acc, m) => acc + (m.shiftsCount || 0), 0)
    return {
      avgNetCop: roundCop(sumNet / months.length),
      avgGrossCop: roundCop(sumGross / months.length),
      avgShifts: Number((sumShifts / months.length).toFixed(2)),
    }
  }, [sixMonthSummaries])

  const sixMonthNetPoints = useMemo(() => {
    const months = sixMonthSummaries ?? []
    return months.map((m) => ({ label: m.monthISO.slice(2), value: m.netPayCop || 0 }))
  }, [sixMonthSummaries])

  const yearTotals = useMemo(() => {
    const months = yearSummaries ?? []
    if (!months.length) return null
    return {
      netPayCop: roundCop(months.reduce((acc, m) => acc + (m.netPayCop || 0), 0)),
      grossPayCop: roundCop(months.reduce((acc, m) => acc + (m.grossPayCop || 0), 0)),
      totalDeductionsCop: roundCop(months.reduce((acc, m) => acc + (m.totalDeductionsCop || 0), 0)),
      shiftsCount: months.reduce((acc, m) => acc + (m.shiftsCount || 0), 0),
    }
  }, [yearSummaries])

  const yearNetPoints = useMemo(() => {
    const months = yearSummaries ?? []
    return months.map((m) => ({ label: m.monthISO.slice(5), value: m.netPayCop || 0 }))
  }, [yearSummaries])

  const openPrintWindow = useCallback(
    (title: string, bodyHtml: string) => {
      const w = window.open('', '_blank', 'noopener,noreferrer')
      if (!w) {
        setError('No se pudo abrir la ventana para imprimir. Revisa el bloqueador de popups.')
        return
      }
      w.document.open()
      w.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color: #0f172a; }
      h1 { font-size: 18px; margin: 0 0 6px; }
      .sub { font-size: 12px; color: #475569; margin: 0 0 16px; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 16px 0; }
      .card { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; }
      .row { display: flex; justify-content: space-between; gap: 12px; font-size: 12px; padding: 4px 0; }
      .row b { font-weight: 600; }
      table { width: 100%; border-collapse: collapse; margin-top: 12px; }
      th, td { border-bottom: 1px solid #e2e8f0; text-align: left; padding: 8px 6px; font-size: 12px; vertical-align: top; }
      th { font-size: 11px; text-transform: uppercase; color: #475569; }
      .muted { color: #64748b; }
      .right { text-align: right; }
      @media print { body { margin: 0; } .no-print { display: none; } }
    </style>
  </head>
  <body>
    ${bodyHtml}
    <div class="no-print" style="margin-top:16px; font-size:12px; color:#64748b;">
      Consejo: en el diálogo de impresión selecciona “Guardar como PDF”.
    </div>
  </body>
</html>`)
      w.document.close()
      w.focus()
      w.print()
    },
    [setError],
  )

  const onDownloadMonthlyPdf = useCallback(() => {
    if (!monthSummary) {
      setError('No hay datos del mes para generar la planilla.')
      return
    }
    const rows = monthEntries.slice().sort((a, b) => (a.workDateISO < b.workDateISO ? -1 : a.workDateISO > b.workDateISO ? 1 : 0))
    const detailsRows = rows
      .map((r) => {
        const badge = dayBadge(r.workDateISO, r.breakdown)
        const b = r.breakdown
        const hours =
          (b.hoursDay || 0) +
          (b.hoursNight || 0) +
          (b.hoursSundayOrHolidayDay || 0) +
          (b.hoursSundayOrHolidayNight || 0) +
          (b.overtimeHoursTotal || 0)
        return `<tr>
  <td>${escapeHtml(r.workDateISO)}<div class="muted">${escapeHtml(badge.label)} · ${escapeHtml(noveltyLabel(r.novelty))}</div></td>
  <td class="right">${escapeHtml(String(hours))}</td>
  <td class="right">${escapeHtml(formatCop(r.totalPayCop || 0))}</td>
</tr>`
      })
      .join('')

    const body = `
<h1>Planilla de pago mensual · ${escapeHtml(selectedMonthPrefix)}</h1>
<p class="sub">${escapeHtml(currentUserEmail)}</p>
<div class="grid">
  <div class="card">
    <div class="row"><span>Total turnos</span><b>${escapeHtml(String(monthSummary.shiftsCount))}</b></div>
    <div class="row"><span>Días únicos</span><b>${escapeHtml(String(monthSummary.uniqueDays))}</b></div>
    <div class="row"><span>Devengado (turnos)</span><b>${escapeHtml(formatCop(monthSummary.shiftPayCop))}</b></div>
    <div class="row"><span>Auxilio transporte</span><b>${escapeHtml(formatCop(monthSummary.transportAllowanceCop))}</b></div>
    <div class="row"><span>Bruto</span><b>${escapeHtml(formatCop(monthSummary.grossPayCop))}</b></div>
  </div>
  <div class="card">
    <div class="row"><span>Salud</span><b>${escapeHtml(formatCop(monthSummary.healthCop))}</b></div>
    <div class="row"><span>Pensión</span><b>${escapeHtml(formatCop(monthSummary.pensionCop))}</b></div>
    <div class="row"><span>Solidaridad</span><b>${escapeHtml(formatCop(monthSummary.solidarityFundCop))}</b></div>
    <div class="row"><span>Otras deducciones</span><b>${escapeHtml(formatCop(monthSummary.otherDeductionsCop))}</b></div>
    <div class="row"><span>Deducciones</span><b>${escapeHtml(formatCop(monthSummary.totalDeductionsCop))}</b></div>
    <div class="row"><span>Neto a pagar</span><b>${escapeHtml(formatCop(monthSummary.netPayCop))}</b></div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>Fecha</th>
      <th class="right">Horas</th>
      <th class="right">Total</th>
    </tr>
  </thead>
  <tbody>
    ${detailsRows || '<tr><td colspan="3" class="muted">Sin registros en el mes.</td></tr>'}
  </tbody>
</table>
`
    openPrintWindow(`Planilla ${selectedMonthPrefix}`, body)
  }, [currentUserEmail, monthEntries, monthSummary, openPrintWindow, selectedMonthPrefix])

  const onDownloadAnnualPdf = useCallback(() => {
    const months = yearSummaries ?? []
    if (!months.length || !yearTotals) {
      setError('No hay datos suficientes para el reporte anual.')
      return
    }
    const rows = months
      .map(
        (m) => `<tr>
  <td>${escapeHtml(m.monthISO)}</td>
  <td class="right">${escapeHtml(String(m.shiftsCount || 0))}</td>
  <td class="right">${escapeHtml(formatCop(m.grossPayCop || 0))}</td>
  <td class="right">${escapeHtml(formatCop(m.totalDeductionsCop || 0))}</td>
  <td class="right">${escapeHtml(formatCop(m.netPayCop || 0))}</td>
</tr>`,
      )
      .join('')

    const body = `
<h1>Reporte anual de nómina · ${escapeHtml(String(reportYear))}</h1>
<p class="sub">${escapeHtml(currentUserEmail)}</p>
<div class="grid">
  <div class="card">
    <div class="row"><span>Turnos</span><b>${escapeHtml(String(yearTotals.shiftsCount))}</b></div>
    <div class="row"><span>Bruto</span><b>${escapeHtml(formatCop(yearTotals.grossPayCop))}</b></div>
    <div class="row"><span>Deducciones</span><b>${escapeHtml(formatCop(yearTotals.totalDeductionsCop))}</b></div>
    <div class="row"><span>Neto</span><b>${escapeHtml(formatCop(yearTotals.netPayCop))}</b></div>
  </div>
  <div class="card">
    <div class="row"><span>Periodo</span><b>${escapeHtml(String(reportYear))}-01 a ${escapeHtml(String(reportYear))}-12</b></div>
    <div class="row"><span>Generado</span><b>${escapeHtml(new Date().toISOString().slice(0, 10))}</b></div>
  </div>
</div>
<table>
  <thead>
    <tr>
      <th>Mes</th>
      <th class="right">Turnos</th>
      <th class="right">Bruto</th>
      <th class="right">Deducciones</th>
      <th class="right">Neto</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
  </tbody>
</table>
`
    openPrintWindow(`Reporte anual ${reportYear}`, body)
  }, [currentUserEmail, openPrintWindow, reportYear, yearSummaries, yearTotals])

  const calculateForRange = useCallback(
    async (dates: string[]) => {
      if (!hourlyRate) return []
      const additionalTimeRange =
        shift === 'adicional'
          ? { startTimeHHmm: additionalStartTimeHHmm, endTimeHHmm: additionalEndTimeHHmm }
          : null

      if (shift === 'adicional') {
        return calculateShifts(dates, shift, novelty, hourlyRate, 44, additionalTimeRange)
      }

      if (session.status !== 'signed_in') return calculateShifts(dates, shift, novelty, hourlyRate)
      if (!currentUserId) return calculateShifts(dates, shift, novelty, hourlyRate)

      const fetchFrom = weekStartIsoFromDateISO(dates[0] ?? startISO)
      const fetchTo = weekEndIsoFromDateISO(dates[dates.length - 1] ?? endISO)

      const localExisting = await listLocalShiftEntriesForRange(currentUserId, fetchFrom, fetchTo)
      const existing = localExisting.map((r) => ({
        dateISO: r.work_date,
        shift: r.shift,
        novelty: r.novelty,
        tag: 'existing' as const,
      }))

      const current = dates.map((d) => ({ dateISO: d, shift, novelty, tag: 'new' as const }))

      const merged = calculateShiftsMerged([...existing, ...current], hourlyRate)
      return merged.slice(existing.length)
    },
    [additionalEndTimeHHmm, additionalStartTimeHHmm, currentUserId, endISO, hourlyRate, novelty, session.status, shift, startISO],
  )

  useEffect(() => {
    if (session.status !== 'signed_in') return
    if (!hourlyRate) return
    if (requiresRange) return
    const dates = enumerateDates(startISO, startISO)
    calculateForRange(dates).then((result) => setPreview(result))
  }, [calculateForRange, hourlyRate, requiresRange, session.status, startISO])

  async function onSignOut() {
    setError(null)
    setInfo(null)
    const client = supabase ?? getSupabase()
    try {
      await client?.auth.signOut()
    } catch {
      try {
        await client?.auth.signOut({ scope: 'local' })
      } catch {
        //
      }
    } finally {
      navigate('/auth', { replace: true })
    }
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
    if (session.status !== 'signed_in') {
      setError('No hay sesión activa.')
      return
    }
    if (!currentUserId) {
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
      const nowIso = new Date().toISOString()
      const entries = calculations.map((calc) => ({
        id: crypto.randomUUID(),
        user_id: currentUserId,
        work_date: calc.dateISO,
        shift: calc.shift,
        novelty: calc.novelty,
        hourly_rate_cop: roundCop(hourlyRate),
        total_pay_cop: calc.breakdown.totalPayCop,
        breakdown: calc.breakdown,
        created_at: nowIso,
        synced: false,
      }))

      await upsertLocalShiftEntries(entries)
      setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
      setPreview(calculations)

      {
        const refreshed = await listRecentLocalShiftEntries(currentUserId, 60)
        setSaved(
          refreshed.map((r) => ({
            id: r.id,
            work_date: r.work_date,
            shift: r.shift,
            novelty: r.novelty,
            total_pay_cop: r.total_pay_cop,
            breakdown: r.breakdown,
            created_at: r.created_at,
          })),
        )
      }

      {
        const { start, end } = monthBounds(selectedMonthPrefix)
        const refreshedMonth = await listLocalShiftEntriesForRange(currentUserId, start, end)
        setMonthRows(
          refreshedMonth
            .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
            .map((r) => ({
              work_date: r.work_date,
              novelty: r.novelty,
              total_pay_cop: r.total_pay_cop,
              breakdown: r.breakdown,
            })),
        )
      }

      if (!online || !supabase) {
        setInfo('Sin conexión: turnos guardados en el dispositivo para sincronizar luego.')
        return
      }

      const payloads = entries.map((e) => ({
        id: e.id,
        user_id: e.user_id,
        work_date: e.work_date,
        shift: e.shift,
        novelty: e.novelty,
        hourly_rate_cop: e.hourly_rate_cop,
        total_pay_cop: e.total_pay_cop,
        breakdown: e.breakdown,
        created_at: e.created_at,
      }))

      const { error: upsertError } = await supabase.from('shift_entries').upsert(payloads, { onConflict: 'id' })
      if (upsertError) {
        setInfo('No se pudo guardar en la nube. Se guardó localmente para sincronizar luego.')
        setError(upsertError.message || 'No se pudieron guardar los turnos.')
        return
      }

      await markLocalShiftEntriesSynced(
        currentUserId,
        entries.map((e) => e.id),
      )
      setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
      setInfo('Turnos guardados y sincronizados.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron guardar los turnos.')
    } finally {
      setSavingRows(false)
    }
  }

  const editPreview = useMemo(() => {
    if (!editingRowId) return null
    if (!hourlyRate) return null
    const additionalTimeRange =
      editShift === 'adicional'
        ? { startTimeHHmm: editAdditionalStartTimeHHmm, endTimeHHmm: editAdditionalEndTimeHHmm }
        : null
    const calc = calculateShifts([editWorkDateISO], editShift, editNovelty, hourlyRate, 44, additionalTimeRange)[0]
    return calc ?? null
  }, [editAdditionalEndTimeHHmm, editAdditionalStartTimeHHmm, editNovelty, editShift, editWorkDateISO, editingRowId, hourlyRate])

  async function refreshTurnosData() {
    if (!currentUserId) return
    const refreshed = await listRecentLocalShiftEntries(currentUserId, 60)
    setSaved(
      refreshed.map((r) => ({
        id: r.id,
        work_date: r.work_date,
        shift: r.shift,
        novelty: r.novelty,
        total_pay_cop: r.total_pay_cop,
        breakdown: r.breakdown,
        created_at: r.created_at,
      })),
    )

    const { start, end } = monthBounds(selectedMonthPrefix)
    const refreshedMonth = await listLocalShiftEntriesForRange(currentUserId, start, end)
    setMonthRows(
      refreshedMonth
        .sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0))
        .map((r) => ({
          work_date: r.work_date,
          novelty: r.novelty,
          total_pay_cop: r.total_pay_cop,
          breakdown: r.breakdown,
        })),
    )
  }

  async function onSaveEditRow() {
    setError(null)
    setInfo(null)
    if (!editingRowId) return
    if (!currentUserId) return
    if (!hourlyRate) {
      setError('Configura primero la base salarial.')
      return
    }

    setSavingEdit(true)
    try {
      const existing = await getLocalShiftEntryById(currentUserId, editingRowId)
      if (!existing) {
        setError('No se encontró el turno para editar.')
        return
      }

      const additionalTimeRange =
        editShift === 'adicional'
          ? { startTimeHHmm: editAdditionalStartTimeHHmm, endTimeHHmm: editAdditionalEndTimeHHmm }
          : null
      const calc = calculateShifts([editWorkDateISO], editShift, editNovelty, hourlyRate, 44, additionalTimeRange)[0]
      if (!calc) {
        setError('No se pudo recalcular el turno.')
        return
      }

      const updated = {
        ...existing,
        work_date: editWorkDateISO,
        shift: editShift,
        novelty: editNovelty,
        hourly_rate_cop: roundCop(hourlyRate),
        total_pay_cop: calc.breakdown.totalPayCop,
        breakdown: calc.breakdown,
        synced: false,
        deleted: false,
      }

      await upsertLocalShiftEntries([updated])
      setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))

      if (online && supabase) {
        const payload = {
          id: updated.id,
          user_id: updated.user_id,
          work_date: updated.work_date,
          shift: updated.shift,
          novelty: updated.novelty,
          hourly_rate_cop: updated.hourly_rate_cop,
          total_pay_cop: updated.total_pay_cop,
          breakdown: updated.breakdown,
          created_at: updated.created_at,
        }
        const { error: upsertError } = await supabase.from('shift_entries').upsert([payload], { onConflict: 'id' })
        if (!upsertError) {
          await markLocalShiftEntriesSynced(currentUserId, [updated.id])
          setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
        }
      }

      await refreshTurnosData()
      setEditingRowId(null)
      setInfo('Turno actualizado.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo editar el turno.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function onConfirmDeleteRow() {
    setError(null)
    setInfo(null)
    if (!deletingRowId) return
    if (!currentUserId) return

    setSavingEdit(true)
    try {
      const existing = await getLocalShiftEntryById(currentUserId, deletingRowId)
      if (!existing) {
        setError('No se encontró el turno para eliminar.')
        return
      }

      await upsertLocalShiftEntries([{ ...existing, deleted: true, synced: false }])
      setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
      await refreshTurnosData()
      setDeletingRowId(null)

      if (online && supabase) {
        const { error: deleteError } = await supabase.from('shift_entries').delete().eq('id', existing.id)
        if (!deleteError) {
          await deleteLocalShiftEntriesByIds(currentUserId, [existing.id])
          setPendingCount(await countUnsyncedLocalShiftEntries(currentUserId))
          await refreshTurnosData()
        }
      }

      setInfo('Turno eliminado.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo eliminar el turno.')
    } finally {
      setSavingEdit(false)
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

  const noveltyLabel = (value: NoveltyType) => noveltyOptions.find((n) => n.value === value)?.label ?? value

  const dayBadge = (dateISO: string, breakdown?: ShiftCalcBreakdown) => {
    const d0 = new Date(`${dateISO}T00:00:00`)
    if (Number.isNaN(d0.getTime())) return { label: 'Normal', tone: 'normal' as const }
    const d1 = new Date(d0)
    d1.setDate(d1.getDate() + 1)

    const sunday = d0.getDay() === 0 || d1.getDay() === 0
    const holiday = isColombiaHoliday(d0) || isColombiaHoliday(d1)
    const sundayOrHolidayHours =
      (breakdown?.hoursSundayOrHolidayDay ?? 0) +
      (breakdown?.hoursSundayOrHolidayNight ?? 0) +
      (breakdown?.overtimeSundayOrHolidayDay ?? 0) +
      (breakdown?.overtimeSundayOrHolidayNight ?? 0)

    if (sundayOrHolidayHours > 0) {
      if (sunday) return { label: 'Domingo', tone: 'sunday' as const }
      if (holiday) return { label: 'Festivo', tone: 'holiday' as const }
      return { label: 'Festivo', tone: 'holiday' as const }
    }

    if (d0.getDay() === 0) return { label: 'Domingo', tone: 'sunday' as const }
    if (isColombiaHoliday(d0)) return { label: 'Festivo', tone: 'holiday' as const }
    return { label: 'Normal', tone: 'normal' as const }
  }

  const hasOvertime = (breakdown?: ShiftCalcBreakdown) => (breakdown?.overtimeHoursTotal ?? 0) > 0

  const normalizeSearchText = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')

  const savedRowSearchText = (row: SavedRow) => {
    const badge = dayBadge(row.work_date, row.breakdown)
    const shiftLabel = shiftOptions.find((s) => s.value === row.shift)?.label ?? row.shift
    const novelty = noveltyLabel(row.novelty)

    const b = row.breakdown
    const nightHours =
      (b?.hoursNight ?? 0) +
      (b?.hoursSundayOrHolidayNight ?? 0) +
      (b?.overtimeNight ?? 0) +
      (b?.overtimeSundayOrHolidayNight ?? 0)
    const dayHours =
      (b?.hoursDay ?? 0) +
      (b?.hoursSundayOrHolidayDay ?? 0) +
      (b?.overtimeDay ?? 0) +
      (b?.overtimeSundayOrHolidayDay ?? 0)
    const extra = hasOvertime(b) || row.shift === 'adicional'

    const tags = [
      badge.label === 'Festivo' ? 'festivo festivos' : '',
      badge.label === 'Domingo' ? 'domingo domingos' : '',
      nightHours > 0 ? 'nocturno nocturna nocturnas' : '',
      dayHours > 0 ? 'diurno diurna diurnas' : '',
      extra ? 'extra extras horas extra' : '',
      row.shift === 'adicional' ? 'adicional adicionales' : '',
    ]
      .filter(Boolean)
      .join(' ')

    return normalizeSearchText([row.work_date, shiftLabel, row.shift, novelty, row.novelty, badge.label, tags].join(' '))
  }

  const savedFiltered =
    saved && savedSearch.trim()
      ? saved.filter((row) => {
          const haystack = savedRowSearchText(row)
          const tokens = normalizeSearchText(savedSearch).split(/\s+/).filter(Boolean)
          return tokens.every((t) => haystack.includes(t))
        })
      : saved

  const navItems = [
    { id: 'resumen', label: 'Resumen' },
    { id: 'turnos', label: 'Turnos' },
    { id: 'reportes', label: 'Reportes' },
    { id: 'config', label: 'Configuración' },
    ...(isAdmin ? [{ id: 'datos' as const, label: 'Datos y SQL' }] : []),
  ] satisfies Array<{ id: NavId; label: string }>

  const inputClass =
    'mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 placeholder:text-slate-500 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20'
  const selectClass =
    'mt-1 w-full rounded-xl border border-slate-200/70 bg-white/80 px-3 py-2 text-sm text-slate-950 shadow-sm backdrop-blur focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20'
  const cardClass = 'rounded-3xl bg-white/80 p-5 shadow-sm ring-1 ring-slate-200/70 backdrop-blur'
  const btnBase =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-950/20 disabled:cursor-not-allowed disabled:opacity-50'
  const btnPrimary = `${btnBase} bg-linear-to-r from-indigo-500 to-fuchsia-500 text-white shadow-sm hover:from-indigo-400 hover:to-fuchsia-400 focus:ring-white/30`
  const btnNeutral = `${btnBase} bg-white/70 text-slate-900 shadow-sm ring-1 ring-slate-200/70 backdrop-blur hover:bg-white/90`
  const badgeBase = 'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium'
  const badgeTone = {
    normal: `${badgeBase} border-slate-200 bg-slate-50 text-slate-700`,
    sunday: `${badgeBase} border-blue-200 bg-blue-50 text-blue-700`,
    holiday: `${badgeBase} border-rose-200 bg-rose-50 text-rose-700`,
    extra: `${badgeBase} border-emerald-200 bg-emerald-50 text-emerald-700`,
  }

  return (
    <DashboardShell
      title="Dashboard"
      subtitle={session.session.user.email ?? undefined}
      navItems={navItems}
      activeNavId={activeNavId}
      onSelectNav={(id) => {
        if (!isAdmin && id === 'datos') return
        setActiveNavId(id as NavId)
      }}
      rightSlot={
        <>
          <span
            className={
              online
                ? 'rounded-full border border-emerald-200/70 bg-emerald-50/80 px-3 py-1 text-sm text-emerald-800 shadow-sm backdrop-blur'
                : 'rounded-full border border-amber-200/70 bg-amber-50/80 px-3 py-1 text-sm text-amber-900 shadow-sm backdrop-blur'
            }
          >
            {online ? 'Online' : 'Offline'}
          </span>
          <span className="rounded-full border border-slate-200/70 bg-white/70 px-3 py-1 text-sm text-slate-700 shadow-sm backdrop-blur">
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
          <div className="rounded-2xl border border-rose-200/70 bg-rose-50/80 px-4 py-3 text-sm text-rose-900 shadow-sm backdrop-blur">
            {error}
          </div>
        ) : null}
        {info ? (
          <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 px-4 py-3 text-sm text-emerald-900 shadow-sm backdrop-blur">
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
                            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                              Deducciones adicionales
                            </div>
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
                <div className="text-xs text-slate-600">
                  Hora estimada: {hourlyRate ? formatCop(hourlyRate) : '—'} (44h/semana)
                </div>
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
                <div className="mt-3">
                  <label className="text-sm text-slate-700">
                    Buscar
                    <input
                      className={inputClass}
                      value={savedSearch}
                      onChange={(e) => setSavedSearch(e.target.value)}
                      placeholder="Fecha o palabras clave: festivos, domingos, nocturnas, adicional, extra…"
                    />
                  </label>
                  {saved && savedSearch.trim() && savedFiltered ? (
                    <div className="mt-2 text-xs text-slate-600">
                      Mostrando {savedFiltered.length} de {saved.length}
                    </div>
                  ) : null}
                </div>
                {loadingRows ? (
                  <div className="mt-3 text-sm text-slate-600">Cargando…</div>
                ) : !saved ? (
                  <div className="mt-3 text-sm text-slate-700">
                    No se pudieron leer turnos desde el dispositivo{rowsLoadError ? `: ${rowsLoadError}` : ''}.
                    <div className="mt-3">
                      <button
                        type="button"
                        className={btnNeutral}
                        onClick={copySupabaseSetupSql}
                        disabled={!navigator.clipboard}
                      >
                        Copiar SQL de la tabla
                      </button>
                    </div>
                  </div>
                ) : saved.length === 0 ? (
                  <div className="mt-3 text-sm text-slate-600">Aún no hay turnos guardados.</div>
                ) : savedFiltered && savedFiltered.length === 0 ? (
                  <div className="mt-3 text-sm text-slate-600">Sin resultados.</div>
                ) : (
                  <div className="mt-4 grid gap-2">
                    {(savedFiltered ?? []).map((row) => (
                      <div
                        key={row.id}
                        className="flex flex-col gap-3 border-t border-slate-200 pt-2 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-slate-700">
                            {row.work_date} · {shiftOptions.find((s) => s.value === row.shift)?.label}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {(() => {
                              const badge = dayBadge(row.work_date, row.breakdown)
                              return <span className={badgeTone[badge.tone]}>{badge.label}</span>
                            })()}
                            {row.shift === 'adicional' || hasOvertime(row.breakdown) ? (
                              <span className={badgeTone.extra}>{row.shift === 'adicional' ? 'Adicional' : 'Horas extra'}</span>
                            ) : null}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">{noveltyLabel(row.novelty)}</div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
                          <span
                            className="rounded-full border px-3 py-1 text-xs text-slate-900"
                            style={{ borderColor: noveltyTint(row.novelty) }}
                          >
                            {formatCop(row.total_pay_cop)}
                          </span>
                          <button
                            type="button"
                            className="rounded-xl bg-white px-3 py-2 text-xs font-medium text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-950/20"
                            onClick={() => {
                              setError(null)
                              setInfo(null)
                              setEditingRowId(row.id)
                              setEditWorkDateISO(row.work_date)
                              setEditShift(row.shift)
                              setEditNovelty(row.novelty)
                              setEditAdditionalStartTimeHHmm(row.breakdown?.additionalStartTimeHHmm ?? '18:00')
                              setEditAdditionalEndTimeHHmm(row.breakdown?.additionalEndTimeHHmm ?? '19:00')
                            }}
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            className="rounded-xl bg-rose-600 px-3 py-2 text-xs font-medium text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-600/30"
                            onClick={() => {
                              setError(null)
                              setInfo(null)
                              setDeletingRowId(row.id)
                            }}
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {editingRowId ? (
              <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
                <div className="mx-auto flex min-h-full w-full max-w-lg items-start justify-center sm:items-center">
                  <div className="w-full max-w-lg rounded-3xl bg-white p-6 ring-1 ring-slate-200 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-base font-semibold text-slate-950">Editar turno</div>
                      <div className="mt-1 text-sm text-slate-600">Actualiza la fecha, turno o novedad.</div>
                    </div>
                    <button
                      type="button"
                      className={btnNeutral}
                      onClick={() => setEditingRowId(null)}
                      disabled={savingEdit}
                    >
                      Cerrar
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    <label className="text-sm text-slate-700">
                      Día
                      <input className={inputClass} value={editWorkDateISO} onChange={(e) => setEditWorkDateISO(e.target.value)} type="date" />
                    </label>
                    <label className="text-sm text-slate-700">
                      Turno
                      <select className={selectClass} value={editShift} onChange={(e) => setEditShift(e.target.value as ShiftType)}>
                        {shiftOptions.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    {editShift === 'adicional' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm text-slate-700">
                          Hora inicio (adicional)
                          <input
                            className={inputClass}
                            type="time"
                            value={editAdditionalStartTimeHHmm}
                            onChange={(e) => setEditAdditionalStartTimeHHmm(e.target.value)}
                          />
                        </label>
                        <label className="text-sm text-slate-700">
                          Hora fin (adicional)
                          <input
                            className={inputClass}
                            type="time"
                            value={editAdditionalEndTimeHHmm}
                            onChange={(e) => setEditAdditionalEndTimeHHmm(e.target.value)}
                          />
                        </label>
                      </div>
                    ) : null}
                    <label className="text-sm text-slate-700">
                      Novedad
                      <select className={selectClass} value={editNovelty} onChange={(e) => setEditNovelty(e.target.value as NoveltyType)}>
                        {noveltyOptions.map((n) => (
                          <option key={n.value} value={n.value}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-700">Total</span>
                        <span className="text-slate-950">{editPreview ? formatCop(editPreview.breakdown.totalPayCop) : '—'}</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="button" className={btnNeutral} onClick={() => setEditingRowId(null)} disabled={savingEdit}>
                        Cancelar
                      </button>
                      <button type="button" className={btnPrimary} onClick={onSaveEditRow} disabled={!editPreview || savingEdit}>
                        {savingEdit ? 'Guardando…' : 'Guardar cambios'}
                      </button>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            ) : null}

            {deletingRowId ? (
              <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/40 p-4">
                <div className="mx-auto flex min-h-full w-full max-w-md items-start justify-center sm:items-center">
                  <div className="w-full max-w-md rounded-3xl bg-white p-6 ring-1 ring-slate-200 sm:max-h-[calc(100vh-3rem)] sm:overflow-y-auto">
                  <div className="text-base font-semibold text-slate-950">Eliminar turno</div>
                  <div className="mt-2 text-sm text-slate-600">Esta acción no se puede deshacer.</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" className={btnNeutral} onClick={() => setDeletingRowId(null)} disabled={savingEdit}>
                      Cancelar
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-3 py-2 text-sm font-medium text-white hover:bg-rose-700 focus:outline-none focus:ring-2 focus:ring-rose-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                      onClick={onConfirmDeleteRow}
                      disabled={savingEdit}
                    >
                      {savingEdit ? 'Eliminando…' : 'Eliminar'}
                    </button>
                  </div>
                </div>
                </div>
              </div>
            ) : null}
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
              <div className="mt-2 text-sm text-slate-600">Datos usados: dispositivo + nube</div>
              <div className="mt-4">
                {!dailyPayPoints.length ? <div className="text-sm text-slate-600">Aún no hay datos.</div> : <SimpleBarChart points={dailyPayPoints} />}
              </div>
            </div>
          </div>
        ) : null}

        {activeNavId === 'reportes' ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <div className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-slate-950">Planilla mensual</div>
                  <div className="mt-1 text-sm text-slate-600">Resumen y planilla imprimible del mes seleccionado.</div>
                </div>
                <button type="button" className={btnPrimary} onClick={onDownloadMonthlyPdf} disabled={!monthSummary}>
                  Descargar PDF
                </button>
              </div>

              {!monthSummary ? (
                <div className="mt-4 text-sm text-slate-600">Aún no hay datos del mes para generar la planilla.</div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs text-slate-600">Neto</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(monthSummary.netPayCop || 0)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs text-slate-600">Bruto</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(monthSummary.grossPayCop || 0)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Turnos</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{monthSummary.shiftsCount}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Días únicos</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{monthSummary.uniqueDays}</div>
                  </div>
                </div>
              )}
            </div>

            <div className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-slate-950">Promedio 6 meses</div>
                  <div className="mt-1 text-sm text-slate-600">Tendencia del neto (últimos 6 meses).</div>
                </div>
                <div className="text-xs text-slate-500">{reportsLoading ? 'Cargando…' : null}</div>
              </div>

              {reportsError ? <div className="mt-4 text-sm text-rose-700">{reportsError}</div> : null}

              {!sixMonthAvg ? (
                <div className="mt-4 text-sm text-slate-600">Aún no hay datos suficientes para calcular el promedio.</div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Neto promedio</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(sixMonthAvg.avgNetCop)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Bruto promedio</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(sixMonthAvg.avgGrossCop)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Turnos promedio</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{sixMonthAvg.avgShifts}</div>
                  </div>
                </div>
              )}

              <div className="mt-4">
                {!sixMonthNetPoints.length ? (
                  <div className="text-sm text-slate-600">Aún no hay datos.</div>
                ) : (
                  <SimpleBarChart points={sixMonthNetPoints} />
                )}
              </div>
            </div>

            <div className={cardClass}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-slate-950">Reporte anual</div>
                  <div className="mt-1 text-sm text-slate-600">Acumulado de nómina del año {reportYear}.</div>
                </div>
                <button type="button" className={btnPrimary} onClick={onDownloadAnnualPdf} disabled={!yearTotals}>
                  Descargar PDF
                </button>
              </div>

              {reportsError ? <div className="mt-4 text-sm text-rose-700">{reportsError}</div> : null}

              {!yearTotals ? (
                <div className="mt-4 text-sm text-slate-600">Aún no hay datos suficientes para el reporte anual.</div>
              ) : (
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Neto anual</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(yearTotals.netPayCop)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="text-xs text-slate-600">Deducciones</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(yearTotals.totalDeductionsCop)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs text-slate-600">Bruto anual</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{formatCop(yearTotals.grossPayCop)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-xs text-slate-600">Turnos</div>
                    <div className="mt-1 text-lg font-semibold text-slate-950">{yearTotals.shiftsCount}</div>
                  </div>
                </div>
              )}

              <div className="mt-4">
                {!yearNetPoints.length ? <div className="text-sm text-slate-600">Aún no hay datos.</div> : <SimpleBarChart points={yearNetPoints} />}
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
                  onClick={copySupabaseSetupSql}
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
                  Los turnos se guardan en este dispositivo y se sincronizan cuando hay conexión.
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  )
}
