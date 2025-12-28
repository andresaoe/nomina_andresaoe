import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, isSupabaseConfigured, onSupabaseConfigChange } from '../lib/supabaseClient'

export default function AuthCallbackPage() {
  const navigate = useNavigate()
  const [message, setMessage] = useState(() =>
    isSupabaseConfigured() ? 'Verificando sesión…' : 'Servicio no disponible. Contacta al administrador.',
  )

  useEffect(() => {
    let cancelled = false
    let authUnsubscribe: (() => void) | null = null

    const attach = () => {
      authUnsubscribe?.()
      authUnsubscribe = null

      const supabase = getSupabase()
      if (!supabase) {
        setMessage('Servicio no disponible. Contacta al administrador.')
        return
      }

      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return
        if (session) navigate('/dashboard', { replace: true })
      })

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (data.session) navigate('/dashboard', { replace: true })
          else setMessage('No se detectó sesión. Intenta iniciar sesión.')
        })
        .catch(() => {
          if (cancelled) return
          setMessage('No se pudo completar la verificación.')
        })

      authUnsubscribe = () => subscription.subscription.unsubscribe()
    }

    attach()
    const detachListener = onSupabaseConfigChange(attach)

    return () => {
      cancelled = true
      detachListener()
      authUnsubscribe?.()
    }
  }, [navigate])

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_circle_at_20%_10%,rgba(99,102,241,0.26),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(236,72,153,0.20),transparent_55%),radial-gradient(900px_circle_at_50%_90%,rgba(34,197,94,0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 bg-[radial-gradient(rgba(148,163,184,0.25)_1px,transparent_1px)] bg-size-[24px_24px]" />

      <div className="relative mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
        <div className="w-full rounded-3xl bg-white/10 p-6 text-slate-100 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl">
          <div className="text-sm text-slate-300">Supabase</div>
          <div className="mt-2 text-base font-semibold">Callback</div>
          <div className="mt-4 rounded-2xl bg-white/5 px-4 py-3 text-sm text-slate-200 ring-1 ring-white/10">
            {message}
          </div>
        </div>
      </div>
    </div>
  )
}
