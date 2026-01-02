import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useSession } from '../../hooks/useSession'

export default function NavBar() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const session = useSession()
  const path = location.pathname
  const homeTo = session.status === 'signed_in' ? '/dashboard' : '/'
  const items = useMemo(() => [{ to: homeTo, label: 'Inicio' }, { to: '/dashboard', label: 'Dashboard' }, { to: '/gastos', label: 'Gastos' }], [homeTo])
  return (
    <header className="sticky top-0 z-50 w-full bg-white/80 shadow-sm ring-1 ring-slate-200/70 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3">
          <Link to={homeTo} className="flex items-center gap-2">
            <span className="inline-block h-6 w-6 rounded-md bg-linear-to-r from-indigo-500 to-fuchsia-500" />
            <span className="text-sm font-semibold text-slate-950">Nómina</span>
          </Link>
        </div>
        <nav className="hidden gap-3 sm:flex">
          {items.map((it) => {
            const active = path === it.to || (it.to !== '/' && path.startsWith(it.to))
            return (
              <Link
                key={it.to}
                to={it.to}
                className={
                  active
                    ? 'rounded-full bg-linear-to-r from-indigo-500 to-fuchsia-500 px-3 py-1 text-sm font-medium text-white'
                    : 'rounded-full border border-slate-200/80 bg-white/80 px-3 py-1 text-sm text-slate-700 hover:bg-white'
                }
              >
                {it.label}
              </Link>
            )
          })}
        </nav>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-xl border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 shadow-sm sm:hidden"
        >
          Menú
        </button>
      </div>
      {open ? (
        <div className="sm:hidden">
          <nav className="mx-auto max-w-7xl px-4 pb-3 sm:px-6 lg:px-8">
            <div className="grid gap-2">
              {items.map((it) => {
                const active = path === it.to || (it.to !== '/' && path.startsWith(it.to))
                return (
                  <Link
                    key={it.to}
                    to={it.to}
                    className={
                      active
                        ? 'w-full rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 px-3 py-2 text-sm font-medium text-white'
                        : 'w-full rounded-xl px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100/70'
                    }
                    onClick={() => setOpen(false)}
                  >
                    {it.label}
                  </Link>
                )
              })}
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  )
}
