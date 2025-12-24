import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

type SupabaseConfig = {
  url: string
  anonKey: string
}

const STORAGE_KEY = 'cn_supabase_config_v1'
const EVENT_NAME = 'supabase_config_changed'

function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      detectSessionInUrl: true,
      flowType: 'pkce',
      autoRefreshToken: true,
      persistSession: true,
    },
  })
}

function readStoredConfig(): SupabaseConfig | null {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { url?: unknown; anonKey?: unknown }
    if (typeof parsed.url !== 'string' || typeof parsed.anonKey !== 'string') return null
    if (!parsed.url || !parsed.anonKey) return null
    return { url: parsed.url, anonKey: parsed.anonKey }
  } catch {
    return null
  }
}

let supabase: SupabaseClient | null = null

if (supabaseUrl && supabaseAnonKey) {
  supabase = createSupabaseClient(supabaseUrl, supabaseAnonKey)
} else {
  const stored = readStoredConfig()
  if (stored) supabase = createSupabaseClient(stored.url, stored.anonKey)
}

export function getSupabase() {
  return supabase
}

export function isSupabaseConfigured() {
  return Boolean(getSupabase())
}

export function setSupabaseConfig(config: SupabaseConfig) {
  const cleaned: SupabaseConfig = {
    url: config.url.trim(),
    anonKey: config.anonKey.trim(),
  }
  if (!cleaned.url || !cleaned.anonKey) return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned))
  supabase = createSupabaseClient(cleaned.url, cleaned.anonKey)
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function clearSupabaseConfig() {
  localStorage.removeItem(STORAGE_KEY)
  supabase = null
  window.dispatchEvent(new CustomEvent(EVENT_NAME))
}

export function onSupabaseConfigChange(handler: () => void) {
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
