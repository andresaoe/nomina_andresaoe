import { Navigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useSession } from '../hooks/useSession'

export default function ProtectedRoute({ children }: { children: ReactNode }) {
  const session = useSession()

  if (session.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950">
        <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
          <div className="w-full rounded-3xl bg-slate-900/40 p-6 text-slate-100 ring-1 ring-slate-800/60">
            Cargando…
          </div>
        </div>
      </div>
    )
  }

  if (session.status === 'signed_out') return <Navigate to="/auth" replace />

  return children
}
