import type { NoveltyType, ShiftCalcBreakdown, ShiftType } from './payroll/types'

export type LocalShiftEntry = {
  id: string
  user_id: string
  work_date: string
  shift: ShiftType
  novelty: NoveltyType
  hourly_rate_cop: number
  total_pay_cop: number
  breakdown: ShiftCalcBreakdown
  created_at: string
  synced: boolean
  deleted?: boolean
}

const DB_NAME = 'cn_local_db_v1'
const DB_VERSION = 1
const SHIFT_ENTRIES_STORE = 'shift_entries'

type LocalDb = {
  db: IDBDatabase
}

let cachedDb: LocalDb | null = null

function openDb(): Promise<LocalDb> {
  if (cachedDb) return Promise.resolve(cachedDb)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (db.objectStoreNames.contains(SHIFT_ENTRIES_STORE)) return
      const store = db.createObjectStore(SHIFT_ENTRIES_STORE, { keyPath: 'id' })
      store.createIndex('user_id', 'user_id', { unique: false })
      store.createIndex('user_id_work_date', ['user_id', 'work_date'], { unique: false })
      store.createIndex('user_id_created_at', ['user_id', 'created_at'], { unique: false })
      store.createIndex('user_id_synced', ['user_id', 'synced'], { unique: false })
    }

    request.onsuccess = () => {
      cachedDb = { db: request.result }
      resolve(cachedDb)
    }
    request.onerror = () => reject(request.error)
  })
}

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<void> {
  return openDb().then(
    ({ db }) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SHIFT_ENTRIES_STORE, mode)
        const store = tx.objectStore(SHIFT_ENTRIES_STORE)

        try {
          run(store)
        } catch (err) {
          reject(err)
          return
        }

        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function upsertLocalShiftEntries(entries: LocalShiftEntry[]) {
  if (!entries.length) return
  await withStore('readwrite', (store) => {
    for (const entry of entries) store.put(entry)
  })
}

export async function listLocalShiftEntriesForRange(userId: string, startISO: string, endISO: string) {
  const { db } = await openDb()
  return new Promise<LocalShiftEntry[]>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readonly')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)
    const index = store.index('user_id_work_date')
    const range = IDBKeyRange.bound([userId, startISO], [userId, endISO])

    const results: LocalShiftEntry[] = []
    const cursorRequest = index.openCursor(range, 'next')

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const value = cursor.value as LocalShiftEntry
      if (!value.deleted) results.push(value)
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)

    tx.oncomplete = () => resolve(results)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listRecentLocalShiftEntries(userId: string, limit: number) {
  const { db } = await openDb()
  return new Promise<LocalShiftEntry[]>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readonly')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)
    const index = store.index('user_id_created_at')
    const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff'])

    const results: LocalShiftEntry[] = []
    const cursorRequest = index.openCursor(range, 'prev')

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const value = cursor.value as LocalShiftEntry
      if (!value.deleted) results.push(value)
      if (results.length >= limit) return
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)

    tx.oncomplete = () => resolve(results.slice(0, limit))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function listUnsyncedLocalShiftEntries(userId: string, limit: number) {
  const { db } = await openDb()
  return new Promise<LocalShiftEntry[]>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readonly')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)
    const index = store.index('user_id_created_at')
    const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff'])

    const results: LocalShiftEntry[] = []
    const cursorRequest = index.openCursor(range, 'prev')

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const value = cursor.value as LocalShiftEntry
      if (!value.synced && !value.deleted) results.push(value)
      if (results.length >= limit) return
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)

    tx.oncomplete = () => resolve(results.slice(0, limit))
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function countUnsyncedLocalShiftEntries(userId: string) {
  const { db } = await openDb()
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readonly')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)
    const index = store.index('user_id')
    const range = IDBKeyRange.only(userId)

    let count = 0
    const cursorRequest = index.openCursor(range, 'next')
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      const value = cursor.value as LocalShiftEntry
      if (!value.synced && !value.deleted) count += 1
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)

    tx.oncomplete = () => resolve(count)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function getLocalShiftEntryById(userId: string, id: string) {
  const { db } = await openDb()
  const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readonly')
  const store = tx.objectStore(SHIFT_ENTRIES_STORE)
  const value = await requestToPromise(store.get(id))
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
  if (!value) return null
  const entry = value as LocalShiftEntry
  if (entry.user_id !== userId) return null
  return entry
}

export async function markLocalShiftEntriesSynced(userId: string, ids: string[]) {
  if (!ids.length) return
  const { db } = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readwrite')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)

    for (const id of ids) {
      const getReq = store.get(id)
      getReq.onsuccess = () => {
        const value = getReq.result as LocalShiftEntry | undefined
        if (!value) return
        if (value.user_id !== userId) return
        if (value.synced) return
        store.put({ ...value, synced: true })
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function deleteLocalShiftEntriesByIds(userId: string, ids: string[]) {
  if (!ids.length) return
  const { db } = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readwrite')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)

    for (const id of ids) {
      const getReq = store.get(id)
      getReq.onsuccess = () => {
        const value = getReq.result as LocalShiftEntry | undefined
        if (!value) return
        if (value.user_id !== userId) return
        store.delete(id)
      }
    }

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

export async function clearLocalShiftEntriesForUser(userId: string) {
  const { db } = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(SHIFT_ENTRIES_STORE, 'readwrite')
    const store = tx.objectStore(SHIFT_ENTRIES_STORE)
    const index = store.index('user_id')
    const range = IDBKeyRange.only(userId)
    const cursorRequest = index.openCursor(range, 'next')

    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result
      if (!cursor) return
      cursor.delete()
      cursor.continue()
    }
    cursorRequest.onerror = () => reject(cursorRequest.error)

    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}
