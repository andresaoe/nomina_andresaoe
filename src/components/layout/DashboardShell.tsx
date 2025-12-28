import type { ReactNode } from 'react'

type NavItem = {
  id: string
  label: string
}

export default function DashboardShell(props: {
  title: string
  subtitle?: string
  navItems: readonly NavItem[]
  activeNavId: string
  onSelectNav: (id: string) => void
  rightSlot?: ReactNode
  children: ReactNode
}) {
  const { title, subtitle, navItems, activeNavId, onSelectNav, rightSlot, children } = props

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_15%_-10%,rgba(99,102,241,0.14),transparent_60%),radial-gradient(700px_circle_at_85%_0%,rgba(236,72,153,0.10),transparent_55%),radial-gradient(900px_circle_at_50%_110%,rgba(34,197,94,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-35 [background-image:radial-gradient(rgba(15,23,42,0.10)_1px,transparent_1px)] [background-size:22px_22px]" />

      <div className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
        <div className="lg:flex lg:gap-6">
          <aside className="hidden lg:block lg:w-56 lg:shrink-0">
            <div className="rounded-2xl bg-white/80 p-3 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
              <div className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-slate-500">
                Navegación
              </div>
              <div className="mt-2 grid gap-1">
                {navItems.map((item) => {
                  const active = item.id === activeNavId
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectNav(item.id)}
                      className={
                        active
                          ? 'w-full rounded-xl bg-slate-950 px-3 py-2 text-left text-sm text-white'
                          : 'w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100'
                      }
                    >
                      {item.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <h1 className="truncate text-xl font-semibold text-slate-950 sm:text-2xl">{title}</h1>
                {subtitle ? <div className="mt-1 text-sm text-slate-600">{subtitle}</div> : null}
                <div className="mt-3 flex flex-wrap gap-2 lg:hidden">
                  {navItems.map((item) => {
                    const active = item.id === activeNavId
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onSelectNav(item.id)}
                        className={
                          active
                            ? 'rounded-full border border-slate-950 bg-slate-950 px-3 py-1 text-sm text-white'
                            : 'rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-sm text-slate-700 shadow-sm backdrop-blur hover:bg-white'
                        }
                      >
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              {rightSlot ? <div className="flex shrink-0 items-center gap-2">{rightSlot}</div> : null}
            </div>

            <div className="mt-6">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
