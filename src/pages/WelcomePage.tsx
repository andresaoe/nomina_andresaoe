import { Link } from 'react-router-dom'

export default function WelcomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_circle_at_20%_10%,rgba(99,102,241,0.26),transparent_60%),radial-gradient(900px_circle_at_85%_20%,rgba(236,72,153,0.20),transparent_55%),radial-gradient(900px_circle_at_50%_90%,rgba(34,197,94,0.14),transparent_55%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-30 bg-[radial-gradient(rgba(148,163,184,0.25)_1px,transparent_1px)] bg-size-[24px_24px]" />

      <div className="relative mx-auto flex min-h-screen max-w-3xl flex-col px-4 pb-12 pt-20 sm:pt-24">
        <div className="flex flex-1 items-center">
          <div className="w-full rounded-3xl bg-white/10 p-8 text-center text-slate-100 shadow-[0_24px_80px_-50px_rgba(0,0,0,0.7)] ring-1 ring-white/15 backdrop-blur-xl sm:p-10">
            <h1 className="text-4xl font-bold sm:text-5xl">
              <span className="bg-linear-to-r from-indigo-200 via-white to-fuchsia-200 bg-clip-text text-transparent">
                Control de Nómina
              </span>
              <span className="block text-base font-medium text-slate-300 sm:text-lg">by @andresaoe</span>
            </h1>

            <div className="mt-8 flex items-center justify-center gap-6">
              <img
                src="https://github.githubassets.com/favicons/favicon.svg"
                alt="GitHub"
                className="h-14 w-14 brightness-75 contrast-125"
              />
              <img
                src="https://raw.githubusercontent.com/supabase/supabase/master/packages/common/assets/images/supabase-logo-icon.svg"
                alt="Supabase"
                className="h-14 w-14"
              />
              <a href="https://www.trae.ai/" target="_blank" rel="noopener noreferrer">
                <img
                  src="https://lf16-web-neutral.traecdn.ai/obj/trae-ai-static/trae_website/favicon.png"
                  alt="TRAE AI"
                  className="h-14 w-14"
                />
              </a>
            </div>

            <div className="mt-10">
              <Link
                to="/auth"
                className="inline-flex items-center justify-center rounded-xl bg-linear-to-r from-indigo-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:from-indigo-400 hover:to-fuchsia-400 focus:outline-none focus:ring-2 focus:ring-white/30"
              >
                Iniciar
              </Link>
            </div>
          </div>
        </div>

        <footer className="mt-10 w-full text-center text-xs text-slate-400">
          <a href="https://profile-andresaoe.vercel.app" target="_blank" rel="noopener noreferrer" className="underline decoration-slate-500/40 hover:decoration-slate-300">
            @andresaoe
          </a>{' '}
          es patrocinado por TRAE AI la mejor inteligencia artificial premium para desarrollo web del futuro.
        </footer>
      </div>
    </div>
  )
}
