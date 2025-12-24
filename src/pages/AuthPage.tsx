import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase } from '../lib/supabaseClient'
import { useSession } from '../hooks/useSession'
import { readJson, writeJson } from '../lib/storage'

const PENDING_VERIFY_EMAIL_KEY = 'cn_pending_verify_email_v1'

export default function AuthPage() {
  const navigate = useNavigate()
  const session = useSession()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(() => readJson<string>(PENDING_VERIFY_EMAIL_KEY))

  const canLogin = useMemo(() => email.includes('@') && password.length >= 8, [email, password])
  const supabaseReady = Boolean(getSupabase())

  useEffect(() => {
    if (session.status === 'signed_in') navigate('/dashboard', { replace: true })
  }, [navigate, session.status])

  useEffect(() => {
    if (pendingVerificationEmail) writeJson(PENDING_VERIFY_EMAIL_KEY, pendingVerificationEmail)
    else localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY)
  }, [pendingVerificationEmail])

  async function onResendVerificationEmail(targetEmail: string) {
    setError(null)
    setInfo(null)

    const supabase = getSupabase()
    if (!supabase) {
      setError('Servicio no disponible. Contacta al administrador.')
      return
    }

    setResending(true)
    try {
      const emailRedirectTo = `${window.location.origin}/auth/callback`
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail,
        options: { emailRedirectTo },
      })
      if (resendError) {
        setError(resendError.message)
        return
      }
      setInfo('Correo de verificación reenviado. Revisa spam/promociones.')
    } finally {
      setResending(false)
    }
  }

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)

    const supabase = getSupabase()
    if (!supabase) {
      setError('Servicio no disponible. Contacta al administrador.')
      return
    }

    if (!canLogin) return

    setLoading(true)
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })
      if (signInError) {
        const message = signInError.message || ''
        if (message.toLowerCase().includes('not confirmed') || message.toLowerCase().includes('confirm')) {
          setPendingVerificationEmail(email)
        }
        setError(signInError.message)
        return
      }
      navigate('/dashboard', { replace: true })
    } finally {
      setLoading(false)
    }
  }

  const inputClass =
    'mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-950/20'
  const btnBase =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-950/20 disabled:cursor-not-allowed disabled:opacity-50'
  const btnPrimary = `${btnBase} bg-slate-950 text-white hover:bg-slate-900`
  const btnNeutral = `${btnBase} bg-white text-slate-900 ring-1 ring-slate-200 hover:bg-slate-50`

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white p-6 ring-1 ring-slate-200">
            <h1 className="text-xl font-semibold text-slate-950 sm:text-2xl">Control de Nómina by @andresaoe</h1>
            <p className="mt-2 text-sm text-slate-600">
              Inicia sesión para usar el dashboard de turnos y cálculo automático.
            </p>
            {!supabaseReady ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                Servicio no disponible. Contacta al administrador.
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {error}
              </div>
            ) : null}
            {info ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                {info}
              </div>
            ) : null}

            {pendingVerificationEmail ? (
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <div className="text-sm font-medium text-slate-900">Verificación de correo</div>
                <div className="mt-2 text-sm text-slate-600">{pendingVerificationEmail}</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={() => onResendVerificationEmail(pendingVerificationEmail)}
                    type="button"
                    className={btnPrimary}
                    disabled={resending || loading || !supabaseReady}
                  >
                    {resending ? 'Reenviando…' : 'Reenviar correo'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <form className="rounded-3xl bg-white p-6 ring-1 ring-slate-200" onSubmit={onLoginSubmit}>
            <div className="text-xl font-semibold text-slate-950">Iniciar sesión</div>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-700">
                  Correo
                  <input
                    className={inputClass}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    type="email"
                    placeholder="tu@correo.com"
                    autoComplete="email"
                  />
              </label>
              <label className="text-sm text-slate-700">
                  Contraseña
                  <input
                    className={inputClass}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    type="password"
                    placeholder="Mínimo 8 caracteres"
                    autoComplete="current-password"
                  />
              </label>
              <div className="flex flex-wrap gap-2 pt-1">
                <button type="submit" className={btnPrimary} disabled={!canLogin || loading || !supabaseReady}>
                  {loading ? 'Entrando…' : 'Entrar'}
                </button>
                <button
                  type="button"
                  className={btnNeutral}
                  disabled={loading || resending || !supabaseReady || !email.includes('@')}
                  onClick={() => {
                    setError(null)
                    setInfo(null)
                    setPendingVerificationEmail(email)
                    setInfo('Listo. Ahora puedes reenviar la verificación.')
                  }}
                >
                  No me llegó el correo de verificación
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
