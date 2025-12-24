export function readJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function writeJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

