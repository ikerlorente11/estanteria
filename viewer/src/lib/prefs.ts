/** What follows the person rather than the device: the libraries and catalogs they connected (and their
 * passwords). An app keeps them in this device (localStorage); the web of a server keeps them in the server,
 * per user (`serverPrefs`), and holds them here only in memory: nothing of them stays in a shared browser. */
import type { Api } from './api.ts'

export interface PrefsStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

/** the keys that are the person's (`estanteria.secret.<library>`: a library's password) */
export const PREF_KEYS = ['estanteria.libraries', 'estanteria.catalogs', 'estanteria.catalogs.langs', 'estanteria.suwayomi.hidden']
export const SECRET_PREFIX = 'estanteria.secret.'

const local: PrefsStore = {
  get: (key) => { try { return localStorage.getItem(key) } catch (_) { return null } },
  set: (key, value) => { try { localStorage.setItem(key, value) } catch (_) { /* private mode */ } },
  remove: (key) => { try { localStorage.removeItem(key) } catch (_) { /* nothing kept */ } },
}

let current: PrefsStore = local
const listeners = new Set<() => void>()

/** Where the person's settings are now (this device, until the host says otherwise). */
export const prefs: PrefsStore = {
  get: (key) => current.get(key),
  set: (key, value) => current.set(key, value),
  remove: (key) => current.remove(key),
}

/** Puts the settings somewhere else; whoever read them reads them again (`onPrefsReplaced`). */
export function usePrefs(store: PrefsStore): void {
  current = store
  for (const fn of listeners) fn()
}
export function onPrefsReplaced(fn: () => void): void { listeners.add(fn) }

/** The settings as `PrefsStore` that live only in memory (what is used when the server's cannot be had). */
export function memoryPrefs(initial: Record<string, string> = {}): PrefsStore {
  const map = new Map(Object.entries(initial))
  return { get: (k) => map.get(k) ?? null, set: (k, v) => { map.set(k, v) }, remove: (k) => { map.delete(k) } }
}

/** The server's copy of the person's settings: read once, every change sent back (together, a moment later).
 * `failed` hears when a change could not be kept (it is tried again with the next one). */
export async function serverPrefs(api: Api, failed?: (err: unknown) => void): Promise<PrefsStore> {
  return remotePrefs(api, await api.prefs(), false, failed)
}

const isPref = (k: string) => PREF_KEYS.includes(k) || k.startsWith(SECRET_PREFIX)

/** How two copies of a setting become one, when both devices had it: the libraries (by their address) and the
 * catalogs (by their id) of both; the sources hidden on either. Anything else: the server's. */
const MERGE: Record<string, (server: string, here: string) => string> = {
  'estanteria.libraries': (server, here) => {
    const a = JSON.parse(server) as { type: string; url: string }[]
    const b = JSON.parse(here) as { type: string; url: string }[]
    const same = (x: { type: string; url: string }, y: { type: string; url: string }) => x.type === y.type && x.url.replace(/\/+$/, '') === y.url.replace(/\/+$/, '')
    return JSON.stringify([...a, ...b.filter((l) => !a.some((m) => same(l, m)))])
  },
  'estanteria.catalogs': (server, here) => {
    const a = JSON.parse(server) || { active: [], repos: [] }
    const b = JSON.parse(here) || { active: [], repos: [] }
    return JSON.stringify({
      active: [...(a.active || []), ...(b.active || []).filter((c: any) => !(a.active || []).some((d: any) => d.id === c.id))],
      repos: [...(a.repos || []), ...(b.repos || []).filter((r: any) => !(a.repos || []).some((q: any) => q.url === r.url))],
    })
  },
  'estanteria.suwayomi.hidden': (server, here) => {
    const a = JSON.parse(server) || {}
    const b = JSON.parse(here) || {}
    for (const [lib, ids] of Object.entries(b)) a[lib] = [...new Set([...(a[lib] || []), ...(ids as string[])])]
    return JSON.stringify(a)
  },
}

/** An app connected to a server of its own: the person's settings are the server's (so every device has the same
 * libraries and catalogs), joined at first with what this device had; kept here too, to work without connection. */
export async function syncedPrefs(api: Api, failed?: (err: unknown) => void): Promise<PrefsStore> {
  const server = await api.prefs()
  const here: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!
      if (isPref(k)) here[k] = localStorage.getItem(k) || ''
    }
  } catch (_) { /* no storage */ }
  const merged: Record<string, string> = { ...server }
  const up: Record<string, string> = {}
  for (const [k, v] of Object.entries(here)) {
    if (!v) continue
    if (server[k] === undefined) { merged[k] = v; up[k] = v; continue }
    if (MERGE[k] && server[k] !== v) {
      try { const m = MERGE[k](server[k], v); merged[k] = m; if (m !== server[k]) up[k] = m } catch (_) { /* a broken copy: the server's */ }
    }
  }
  for (const [k, v] of Object.entries(merged)) local.set(k, v)
  if (Object.keys(up).length) await api.savePrefs({ set: up, remove: [] }).catch((err) => failed?.(err))
  return remotePrefs(api, merged, true, failed)
}

/** Settings held in memory, every change sent to the server a moment later (`mirror`: and kept in this device). */
function remotePrefs(api: Api, data: Record<string, string>, mirror: boolean, failed?: (err: unknown) => void): PrefsStore {
  const mem = memoryPrefs(data)
  const changed = new Map<string, string | null>()
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = async () => {
    timer = null
    if (!changed.size) return
    const batch = new Map(changed)
    changed.clear()
    const set: Record<string, string> = {}
    const remove: string[] = []
    for (const [k, v] of batch) v === null ? remove.push(k) : (set[k] = v)
    try {
      await api.savePrefs({ set, remove })
    } catch (err) {
      for (const [k, v] of batch) if (!changed.has(k)) changed.set(k, v)      // the next change takes them again
      failed?.(err)
    }
  }
  const later = () => { if (!timer) timer = setTimeout(flush, 300) }
  if (typeof window !== 'undefined') window.addEventListener('pagehide', () => { if (changed.size) flush() })
  return {
    get: mem.get,
    set: (k, v) => { mem.set(k, v); if (mirror) local.set(k, v); changed.set(k, v); later() },
    remove: (k) => { mem.remove(k); if (mirror) local.remove(k); changed.set(k, null); later() },
  }
}

/** Back to this device's own settings (no server now): what was last synced stays here. */
export function useLocalPrefs(): void { if (current !== local) usePrefs(local) }
