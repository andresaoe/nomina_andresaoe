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
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-2xl items-center px-4 py-10">
        <div className="w-full rounded-3xl bg-white p-6 text-slate-950 ring-1 ring-slate-200">
          <div className="text-sm text-slate-600">Supabase</div>
          <div className="mt-2 text-base font-semibold">Callback</div>
          <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700 ring-1 ring-slate-200">
            {message}
          </div>
        </div>
      </div>
    </div>
  )
}
