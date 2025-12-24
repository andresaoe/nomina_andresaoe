import { readJson, writeJson } from './storage'

export type PendingEntry = {
  id: string
  payload: Record<string, unknown>
  createdAt: string
}

const STORAGE_KEY = 'cn_pending_entries_v1'

export function getPendingEntries(): PendingEntry[] {
  return readJson<PendingEntry[]>(STORAGE_KEY) ?? []
}

export function enqueueEntry(entry: PendingEntry) {
  const current = getPendingEntries()
  writeJson(STORAGE_KEY, [entry, ...current])
}

export function removePendingEntries(ids: string[]) {
  const current = getPendingEntries()
  const idSet = new Set(ids)
  writeJson(
    STORAGE_KEY,
    current.filter((e) => !idSet.has(e.id)),
  )
}

