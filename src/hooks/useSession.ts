import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { getSupabase, onSupabaseConfigChange } from '../lib/supabaseClient'

export type SessionState =
  | { status: 'loading' }
  | { status: 'signed_out' }
  | { status: 'signed_in'; session: Session }

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>(() =>
    getSupabase() ? { status: 'loading' } : { status: 'signed_out' },
  )

  useEffect(() => {
    let cancelled = false
    let authUnsubscribe: (() => void) | null = null

    const attach = () => {
      authUnsubscribe?.()
      authUnsubscribe = null

      const supabase = getSupabase()
      if (!supabase) {
        setState({ status: 'signed_out' })
        return
      }

      setState({ status: 'loading' })

      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (cancelled) return
          if (data.session) setState({ status: 'signed_in', session: data.session })
          else setState({ status: 'signed_out' })
        })
        .catch(() => {
          if (cancelled) return
          setState({ status: 'signed_out' })
        })

      const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return
        if (session) setState({ status: 'signed_in', session })
        else setState({ status: 'signed_out' })
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
  }, [])

  return state
}
