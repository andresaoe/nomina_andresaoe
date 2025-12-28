import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getSupabase, isSupabaseConfigured, onSupabaseConfigChange, setSupabaseConfig } from '../lib/supabaseClient'
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
  const [supabaseReady, setSupabaseReady] = useState(() => isSupabaseConfigured())
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('')
  const [supabaseAnonKeyInput, setSupabaseAnonKeyInput] = useState('')

  const canLogin = useMemo(() => email.includes('@') && password.length >= 8, [email, password])

  useEffect(() => {
    if (session.status === 'signed_in') navigate('/dashboard', { replace: true })
  }, [navigate, session.status])

  useEffect(() => {
    setSupabaseReady(isSupabaseConfigured())
    return onSupabaseConfigChange(() => setSupabaseReady(isSupabaseConfigured()))
  }, [])

  useEffect(() => {
    if (pendingVerificationEmail) writeJson(PENDING_VERIFY_EMAIL_KEY, pendingVerificationEmail)
    else localStorage.removeItem(PENDING_VERIFY_EMAIL_KEY)
  }, [pendingVerificationEmail])

  function onSaveSupabaseConfig(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setInfo(null)
    try {
      setSupabaseConfig({ url: supabaseUrlInput, anonKey: supabaseAnonKeyInput })
      setInfo('Configuración guardada. Ya puedes iniciar sesión.')
      setSupabaseUrlInput('')
      setSupabaseAnonKeyInput('')
    } catch {
      setError('No se pudo guardar la configuración de Supabase.')
    }
  }

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
    'mt-1 w-full rounded-xl border border-white/15 bg-white/90 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 shadow-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-400/30'
  const btnBase =
    'inline-flex items-center justify-center rounded-xl px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-950/20 disabled:cursor-not-allowed disabled:opacity-50'
  const btnPrimary = `${btnBase} bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white hover:from-indigo-400 hover:to-fuchsia-400 focus:ring-white/30`
  const btnNeutral = `${btnBase} bg-white/10 text-slate-100 ring-1 ring-white/15 hover:bg-white/15 focus:ring-white/30`

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_circle_at_20%_10%,rgba(99,102,241,0.26),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(236,72,153,0.20),transparent_55%),radial-gradient(900px_circle_at_50%_90%,rgba(34,197,94,0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(rgba(148,163,184,0.25)_1px,transparent_1px)] [background-size:24px_24px]" />

      <div className="relative mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl bg-white/10 p-6 text-slate-100 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl">
            <h1 className="text-xl font-semibold sm:text-2xl">
              <span className="bg-gradient-to-r from-indigo-200 via-white to-fuchsia-200 bg-clip-text text-transparent">
                Control de Nómina
              </span>
              <span className="block text-sm font-medium text-slate-300">by @andresaoe</span>
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Inicia sesión para usar el dashboard de turnos y cálculo automático.
            </p>
            {!supabaseReady ? (
              <div className="mt-4 grid gap-3">
                <div className="rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  Servicio no disponible. Falta configurar Supabase.
                </div>
                <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                  <div className="text-sm font-medium text-slate-100">Configurar Supabase</div>
                  <div className="mt-1 text-sm text-slate-300">
                    Si publicaste en Vercel, asegúrate de configurar las variables VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY. Como alternativa, puedes pegarlas aquí (se guardan en este navegador).
                  </div>
                  <form className="mt-4 grid gap-3" onSubmit={onSaveSupabaseConfig}>
                    <label className="text-sm text-slate-200">
                      URL de Supabase
                      <input
                        className={inputClass}
                        value={supabaseUrlInput}
                        onChange={(e) => setSupabaseUrlInput(e.target.value)}
                        placeholder="https://xxxx.supabase.co"
                        autoComplete="off"
                      />
                    </label>
                    <label className="text-sm text-slate-200">
                      ANON key
                      <input
                        className={inputClass}
                        value={supabaseAnonKeyInput}
                        onChange={(e) => setSupabaseAnonKeyInput(e.target.value)}
                        placeholder="eyJhbGciOi..."
                        autoComplete="off"
                      />
                    </label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      <button type="submit" className={btnPrimary} disabled={!supabaseUrlInput.trim() || !supabaseAnonKeyInput.trim()}>
                        Guardar
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            ) : null}

            {error ? (
              <div className="mt-4 rounded-2xl border border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
            {info ? (
              <div className="mt-4 rounded-2xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
                {info}
              </div>
            ) : null}

            {pendingVerificationEmail ? (
              <div className="mt-4 rounded-2xl bg-white/5 p-4 ring-1 ring-white/10">
                <div className="text-sm font-medium text-slate-100">Verificación de correo</div>
                <div className="mt-2 text-sm text-slate-300">{pendingVerificationEmail}</div>
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

          <form
            className="rounded-3xl bg-white/10 p-6 text-slate-100 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl"
            onSubmit={onLoginSubmit}
          >
            <div className="text-xl font-semibold">Iniciar sesión</div>
            <div className="mt-4 grid gap-3">
              <label className="text-sm text-slate-200">
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
              <label className="text-sm text-slate-200">
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
