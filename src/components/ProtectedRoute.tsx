import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSession } from '../hooks/useSession'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <div className="relative min-h-screen overflow-hidden bg-slate-950">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_circle_at_20%_10%,rgba(99,102,241,0.26),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(236,72,153,0.20),transparent_55%),radial-gradient(900px_circle_at_50%_90%,rgba(34,197,94,0.14),transparent_55%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(148,163,184,0.25)_1px,transparent_1px)] [background-size:24px_24px]" />

        <div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
          <div className="w-full rounded-3xl bg-white/10 p-6 text-slate-100 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl">
            Cargando…
          </div>
        </div>
      </div>
    )
  }

  if (session.status === 'signed_out') return <Navigate to="/auth" replace />

  return children
}
