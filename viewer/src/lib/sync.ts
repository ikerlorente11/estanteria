/**
 * What every device of a person shares (favourites now; the reading progress and more will come): records by
 * kind and key, each with when it was last changed on the device where it was changed. With a server of one's
 * own connected, each device tells it its changes and asks for the others' (`/api/sync`); the newest change of
 * each record wins, a deletion included (it stays as a mark until every device has it).
 *
 * Two books: the account's (the server's person: shared) and this device's own (what was done without a server,
 * and what only this device has, like its own files). What the device did without a server goes into the
 * account's when it connects. An app keeps both books in this device; the web keeps nothing (it is the server's).
 */
import { reactive } from 'vue'
import type { Api } from './api.ts'

export type SyncKind = 'favorite' | 'progress' | 'mark'

export interface SyncRecord<T = any> {
  kind: SyncKind
  key: string
  value: T | null
  deleted: boolean
  /** seconds since 1970, on the clock of the device that changed it */
  updated: number
  device: string
}

interface Book { records: Record<string, SyncRecord>; pending: string[]; seq: number }

const DEVICE_BOOK = 'estanteria.sync.device'
const bookKey = (account: string) => `estanteria.sync.${account}`
const id = (kind: SyncKind, key: string) => `${kind}\u0000${key}`

let persist = true
function loadBook(key: string): Book {
  if (!persist && key !== DEVICE_BOOK) return { records: {}, pending: [], seq: 0 }
  try {
    const b = JSON.parse(localStorage.getItem(key) || 'null')
    if (b && b.records) return { records: b.records, pending: b.pending || [], seq: b.seq || 0 }
  } catch (_) { /* nothing kept */ }
  return { records: {}, pending: [], seq: 0 }
}
function keepBook(key: string, book: Book) {
  if (!persist) return
  try { localStorage.setItem(key, JSON.stringify(book)) } catch (_) { /* storage off: this session only */ }
}

const state = reactive<{ device: Book; account: Book | null; accountId: string | null; syncing: boolean; error: string }>({
  device: loadBook(DEVICE_BOOK), account: null, accountId: null, syncing: false, error: '',
})

/** the name this device signs its changes with («móvil», «escritorio», «web») */
let deviceName = 'web'
export function setSyncDevice(name: string) { deviceName = name.slice(0, 80) }

const now = () => Date.now() / 1000

/** The records of a kind that are there (not deleted): the account's and this device's own. */
export function syncRecords<T = any>(kind: SyncKind): SyncRecord<T>[] {
  const out = new Map<string, SyncRecord<T>>()
  for (const book of [state.device, state.account]) {
    if (!book) continue
    for (const r of Object.values(book.records)) if (r.kind === kind) out.set(r.key, r as SyncRecord<T>)
  }
  return [...out.values()].filter((r) => !r.deleted)
}
/** Every record of a kind whose key starts so, deleted ones too (to know what was removed elsewhere). */
export function syncRecordsLike<T = any>(kind: SyncKind, prefix: string): SyncRecord<T>[] {
  const out = new Map<string, SyncRecord<T>>()
  for (const book of [state.device, state.account]) {
    if (!book) continue
    for (const r of Object.values(book.records)) if (r.kind === kind && r.key.startsWith(prefix)) out.set(r.key, r as SyncRecord<T>)
  }
  return [...out.values()]
}

export function syncGet<T = any>(kind: SyncKind, key: string): T | null {
  const r = state.account?.records[id(kind, key)] || state.device.records[id(kind, key)]
  return r && !r.deleted ? (r.value as T) : null
}

/** Changes a record (`value` null: deletes it). `onlyHere`: it is of this device alone (one of its own files). */
export function syncPut(kind: SyncKind, key: string, value: unknown, onlyHere = false) {
  const rec: SyncRecord = { kind, key, value: value ?? null, deleted: value == null, updated: now(), device: deviceName }
  const k = id(kind, key)
  if (state.account && !onlyHere) {
    state.account.records[k] = rec
    if (!state.account.pending.includes(k)) state.account.pending.push(k)
    if (state.device.records[k]) { delete state.device.records[k]; keepBook(DEVICE_BOOK, state.device) }
    keepBook(bookKey(state.accountId!), state.account)
    later()
  } else {
    state.device.records[k] = rec
    keepBook(DEVICE_BOOK, state.device)
  }
}

// ---- talking to the server ----
let api: Api | null = null
let timer: ReturnType<typeof setTimeout> | null = null
let running: Promise<void> | null = null
function later(ms = 1500) { if (!timer) timer = setTimeout(() => { timer = null; syncNow() }, ms) }

/** With a server: the account's book, and what this device did alone goes into it. `keep`: false on the web
 * (nothing of the account is kept in the browser). Again with the same server, it only syncs. */
export async function attachSync(server: Api, keep = true): Promise<void> {
  if (api === server) return syncNow()
  api = server
  persist = keep
  try {
    const where = await server.sync(Number.MAX_SAFE_INTEGER)            // who it is and where it is, nothing else
    if (api !== server) return
    const book = loadBook(bookKey(where.user))
    if (book.seq > where.seq) {                                        // the server started again empty: all of ours goes up
      book.seq = 0
      book.pending = Object.keys(book.records)
    }
    // what this device did without a server, if it is not of this device alone, is the person's now
    for (const [k, r] of Object.entries(state.device.records)) {
      if (r.key.startsWith('local:')) continue
      const there = book.records[k]
      if (!there || there.updated < r.updated) { book.records[k] = r; if (!book.pending.includes(k)) book.pending.push(k) }
      delete state.device.records[k]
    }
    keepBook(DEVICE_BOOK, state.device)
    state.accountId = where.user
    state.account = book
    keepBook(bookKey(where.user), book)
  } catch (err: any) {
    state.error = err?.message || String(err)
    if (api === server) api = null
    return
  }
  return syncNow()
}

/** Without a server: only this device's own book shows. */
export function detachSync() {
  api = null
  state.account = null
  state.accountId = null
}

/** Asks for the others' changes and tells ours (one at a time). */
export function syncNow(): Promise<void> {
  if (!api || !state.account) return Promise.resolve()
  if (!running) running = round(api).finally(() => { running = null })
  return running
}

async function round(server: Api) {
  const book = state.account!
  const account = state.accountId!
  state.syncing = true
  try {
    // ours first: what the server has newer stays, and comes back below
    if (book.pending.length) {
      const sending = book.pending.slice(0, 2000)
      const sent = new Map(sending.map((k) => [k, book.records[k]?.updated]))
      const refused = new Set<string>()
      try {
        await server.syncPush(sending.map((k) => book.records[k]).filter(Boolean))
      } catch (err: any) {
        // the server refuses something (a kind it does not know yet, an older server): one by one, so what it takes
        // goes, and what it refuses waits for it (the rest is not held back)
        if (!(err?.status >= 400 && err.status < 500) || err.status === 401) throw err
        for (const k of sending) {
          if (!book.records[k]) continue
          try { await server.syncPush([book.records[k]]) } catch (e: any) {
            if (e?.status >= 400 && e.status < 500 && e.status !== 401) refused.add(k)
            else throw e
          }
        }
      }
      book.pending = book.pending.filter((k) => refused.has(k) || !sent.has(k) || book.records[k]?.updated !== sent.get(k))
    }
    for (let more = true; more;) {
      const got = await server.sync(book.seq)
      if (api !== server || state.accountId !== account) return
      for (const c of got.changes) {
        const k = id(c.kind, c.key)
        const mine = book.records[k]
        if (mine && mine.updated >= c.updated) continue
        book.records[k] = { kind: c.kind, key: c.key, value: c.value, deleted: c.deleted, updated: c.updated, device: c.device }
      }
      book.seq = got.seq
      more = got.more
    }
    keepBook(bookKey(account), book)
    state.error = ''
  } catch (err: any) {
    state.error = err?.message || String(err)
  } finally {
    state.syncing = false
    if (book.pending.length) later(30000)
  }
}

// every minute while open, and when the device comes back (online, or the page shown again)
if (typeof window !== 'undefined') {
  setInterval(() => { syncNow() }, 60000)
  window.addEventListener('online', () => { syncNow() })
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow() })
}

export const syncState = state
