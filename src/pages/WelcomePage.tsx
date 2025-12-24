import { Link } from 'react-router-dom'

export default function WelcomePage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex min-h-screen max-w-3xl items-center px-4 py-12">
        <div className="w-full rounded-3xl bg-white p-8 text-center ring-1 ring-slate-200 sm:p-10">
          <h1 className="text-4xl font-bold text-slate-950 sm:text-5xl">Control de Nómina by @andresaoe</h1>

          <div className="mt-8 flex items-center justify-center gap-6">
            <img src="https://www.trae.ai/favicon.ico" alt="Trae" className="h-14 w-14" />
            <img
              src="https://raw.githubusercontent.com/supabase/supabase/master/packages/common/assets/images/supabase-logo-icon.svg"
              alt="Supabase"
              className="h-14 w-14"
            />
            <img src="https://react.dev/favicon-32x32.png" alt="React" className="h-14 w-14" />
          </div>

          <div className="mt-10">
            <Link
              to="/auth"
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-5 py-2.5 text-sm font-medium text-white hover:bg-slate-900"
            >
              Iniciar
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
