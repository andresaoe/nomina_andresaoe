import type { ReactNode } from 'react'

export default function KpiCard(props: {
  label: string
  value: string
  helper?: string
  tone?: 'default' | 'good' | 'warn'
  icon?: ReactNode
}) {
  const { label, value, helper, tone = 'default', icon } = props

  const ring =
    tone === 'good'
      ? 'ring-emerald-600/20'
      : tone === 'warn'
        ? 'ring-amber-600/25'
        : 'ring-slate-800/60'

  const valueColor = tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-slate-950'

  return (
    <div
      className={`rounded-2xl bg-white/80 p-4 shadow-sm ring-1 backdrop-blur ${tone === 'default' ? 'ring-slate-200/70' : ring}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm text-slate-600">{label}</div>
          <div className={`mt-1 truncate text-lg font-semibold ${valueColor}`}>{value}</div>
          {helper ? <div className="mt-1 text-xs text-slate-500">{helper}</div> : null}
        </div>
        {icon ? <div className="mt-1 text-slate-500">{icon}</div> : null}
      </div>
    </div>
  )
}
