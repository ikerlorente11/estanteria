/** The page's side of the host (modules/estanteria-host, HostServer.kt): the local server the app
 * serves this page from. Everything goes over HTTP on 127.0.0.1 with the token the app put in the
 * URL (`?t=`), which is kept for the session. The server of its own (if one is connected) is reached through the
 * host too (`/api/...`): it adds the credential, so this page never holds the app password. */
import type { FileToHand, LocalFile, LocalRoot, NativeFeatures, NetBackend, OfflineBackend, OfflineEntry, OfflineProgress, Prepared, ShelfBackend, ShelfConfig, UploadDone } from 'estanteria-viewer'
import { t, turnPage } from 'estanteria-viewer'

const TOKEN_KEY = 'estanteria.host.token'
const BASE_KEY = 'estanteria.host.base'
function remembered(key: string, param: string): string {
  const given = new URLSearchParams(window.location.search).get(param)
  if (given !== null) { try { sessionStorage.setItem(key, given) } catch (_) {} return given }
  try { return sessionStorage.getItem(key) || '' } catch (_) { return '' }
}
export const TOKEN: string = remembered(TOKEN_KEY, 't')
/** Where the host is: '' (this page's own origin), or another origin in development, when the page
 * comes from Vite on the PC and the host runs on the device (`?host=http://127.0.0.1:48123`). */
export const HOST_BASE: string = remembered(BASE_KEY, 'host').replace(/\/+$/, '')

export interface HostInfo {
  version: string
  shelf: boolean
  offline: boolean
  /** what the app's native side can do (see hostNative); absent on the development host of the PC (Expo Go) */
  volumeKeys?: boolean
  wifiOnly?: boolean
  lock?: boolean
  /** the system's «save as» and share sheet for a file (/host/file) */
  saveAs?: boolean
  share?: boolean
}

export interface Connection {
  url: string
  username: string
  /** what the user called the server */
  name: string
  hasToken: boolean
}

/** A URL of the host with the token, for images and files the web view fetches on its own. */
export function hostUrl(path: string): string {
  return `${HOST_BASE}${path}${path.includes('?') ? '&' : '?'}t=${TOKEN}`
}

export async function host<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(HOST_BASE + path, { ...init, headers: { 'X-Host-Token': TOKEN, 'Content-Type': 'application/json', ...((init.headers as any) || {}) } })
  if (!res.ok) {
    const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
    const err: any = new Error(typeof detail === 'string' ? detail : res.statusText)
    err.status = res.status
    throw err
  }
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

export const info = () => host<HostInfo>('/host/info')
export const loadConnection = () => host<Connection>('/host/settings')
export const saveConnection = (c: { url: string; username: string; name: string; token?: string }) => host<Connection>('/host/settings', { method: 'PUT', body: JSON.stringify(c) })
/** forgets the server: password, address, user and name */
export const forgetServer = () => host<Connection>('/host/settings', { method: 'DELETE' })

/** The app (React Native) listens for these: reading on/off keeps the screen awake, open-url goes to the browser. */
export function tellApp(message: Record<string, unknown>): void {
  const rn = (window as any).ReactNativeWebView
  if (rn?.postMessage) rn.postMessage(JSON.stringify(message))
}

// ---- what happens on the host, as it happens (downloads, uploads) ----
type Listener = (event: any) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null
export function onHostEvent(listener: Listener): () => void {
  listeners.add(listener)
  if (!source) {
    source = new EventSource(hostUrl('/host/events'))
    source.onmessage = (e) => {
      let data: any
      try { data = JSON.parse(e.data) } catch (_) { return }
      for (const l of listeners) l(data)
    }
  }
  return () => { listeners.delete(listener) }
}

// ---- the files and folders of this device, listed and served by the host ----
export function hostShelf(): ShelfBackend {
  return {
    config: () => host<ShelfConfig>('/host/shelf'),
    scan: () => host<LocalFile[]>('/host/shelf/scan'),
    pickFolders: () => host<string[]>('/host/shelf/pick?kind=folders', { method: 'POST' }),
    pickFiles: () => host<string[]>('/host/shelf/pick?kind=files', { method: 'POST' }),
    addRoot: (path) => host<LocalRoot>('/host/shelf/roots', { method: 'POST', body: JSON.stringify({ path }) }),
    removeRoot: (id) => host<void>(`/host/shelf/roots/${id}`, { method: 'DELETE' }),
    renameRoot: (id, name) => host<void>(`/host/shelf/roots/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
    addFile: (path) => host<LocalFile>('/host/shelf/files', { method: 'POST', body: JSON.stringify({ path }) }),
    removeFile: (id) => host<void>(`/host/shelf/files/${id}`, { method: 'DELETE' }),
    prepare: (id) => host<Prepared>(`/host/shelf/prepare/${id}`, { method: 'POST' }),
    url: (id, part) => {
      const [kind, n] = part.split('/')
      return hostUrl(n !== undefined ? `/shelf/${kind}/${id}/${n}` : `/shelf/${kind}/${id}`)
    },
    setCacheLimit: (bytes) => host<void>('/host/shelf/cache', { method: 'PUT', body: JSON.stringify({ bytes }) }),
    clearCache: () => host<void>('/host/shelf/cache', { method: 'DELETE' }),
    reveal: (id) => host<void>(`/host/shelf/reveal/${id}`, { method: 'POST' }),
    upload: async (id, dest, progress) => {
      const stop = onHostEvent((e) => { if (e.type === 'upload' && e.id === id) progress(e.sent, e.total) })
      try {
        return await host<UploadDone>(`/host/shelf/upload/${id}`, { method: 'POST', body: JSON.stringify({ dest }) })
      } finally { stop() }
    },
  }
}

// ---- the items kept for reading offline: the host downloads and stores them ----
export function hostBackend(): OfflineBackend {
  return {
    list: () => host<OfflineEntry[]>('/host/offline'),
    start: (job) => host<void>('/host/offline', { method: 'POST', body: JSON.stringify(job) }),
    remove: (id) => host<void>(`/host/offline/${id}`, { method: 'DELETE' }),
    url: (id, part) => hostUrl(`/offline/${id}/${part}`),
    onProgress: (handler) => { onHostEvent((e) => { if (e.type === 'offline') handler(e as OfflineProgress) }) },
    where: () => host<string>('/host/offline/where'),
  }
}

// ---- any server (catalogs, libraries), reached through the host: no CORS, and downloads into the shelf ----
/** A header value carries only Latin-1: the JSON of the headers goes with everything else escaped (\uXXXX). */
function headerJson(headers: Record<string, string> | undefined): string {
  return JSON.stringify(headers || {}).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
}

/** The NetBackend of the app (`store.net`). `fetch` goes through `/host/fetch`, the headers wanted in
 * X-Fetch-Headers (so neither CORS nor the host's own token touch them), and answers the server's own answer:
 * its status, type, length and body. The address it ended at after redirects (what an OPDS feed's relative
 * links resolve against) comes in the `X-Fetch-Url` header, and is also set as the Response's `url`. When the
 * server cannot be reached, or the host refuses the request, it rejects (like the browser's fetch) with the
 * host's Spanish message. `download` saves into the shelf's catalog folder (`/host/shelf/fetch`), reports the
 * `fetch-progress` events of that address, and answers the file:// URI to give to the shelf's `addFiles`. */
export function hostNet(): NetBackend {
  return {
    fetch: async (url, init = {}) => {
      const wanted = Object.entries(init.headers || {}).find(([k]) => k.toLowerCase() === 'content-type')?.[1]
      const headers: Record<string, string> = { 'X-Host-Token': TOKEN, 'X-Fetch-Headers': headerJson(init.headers) }
      if (init.body !== undefined) headers['Content-Type'] = wanted || 'text/plain;charset=UTF-8'
      const res = await fetch(`${HOST_BASE}/host/fetch?url=${encodeURIComponent(url)}`, {
        method: (init.method || 'GET').toUpperCase(), headers, body: init.body,
      })
      const final = res.headers.get('X-Fetch-Url')
      if (!final) {     // the host's own answer, not the server's: the address was refused or not reached
        const detail = await res.json().then((b) => b.detail).catch(() => null)
        throw new TypeError(typeof detail === 'string' ? detail : t('No se pudo pedir {url} ({status})', { url, status: res.status }))
      }
      try { Object.defineProperty(res, 'url', { value: final }) } catch (_) {}
      return res
    },
    download: async (url, name, headers, progress, folder) => {
      const key = url.trim()
      const stop = progress ? onHostEvent((e) => { if (e.type === 'fetch-progress' && e.url === key) progress(e.done, e.total) }) : null
      try {
        const done = await host<{ uri: string }>('/host/shelf/fetch', { method: 'POST', body: JSON.stringify({ url, name, headers: headers || {}, folder: folder || '' }) })
        return done.uri
      } finally { stop?.() }
    },
    /** a file made here (a chapter packed as CBZ…), into the same folder: the host streams it to disk */
    save: async (name, data, folder) => {
      const done = await host<{ uri: string }>(`/host/shelf/save?name=${encodeURIComponent(name)}&folder=${encodeURIComponent(folder || '')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: data,
      })
      return done.uri
    },
  }
}

// ---- what only the app's native side can do (volume keys, Wi-Fi only, the device's lock) ----
/**
 * The NativeFeatures of the app (`store.native`), with only what the host says it can do (`/host/info`: the
 * development host of the PC, for Expo Go, says none of them, so none is there).
 * - `volumeKeys(on)`: the app (React Native) takes the volume keys while on and hands them back here through
 *   `window.__estanteriaKey(dir)`, which turns the page (`turnPage`: volume down the next one, volume up the previous).
 * - `wifiOnly(on)`: kept by the host (`PUT /host/prefs`); while on, its downloads and the app's refuse mobile data.
 * - `lock`: the device's fingerprint, face or PIN, asked by the host (`/host/lock`: GET whether there is one, POST
 *   shows the system's prompt and answers when the person has passed or given up).
 */
export function hostNative(can: Pick<HostInfo, 'volumeKeys' | 'wifiOnly' | 'lock' | 'saveAs' | 'share'> = {}): NativeFeatures {
  const native: NativeFeatures = {}
  if (can.volumeKeys && (window as any).ReactNativeWebView) {
    ;(window as any).__estanteriaKey = (dir: number) => turnPage(dir < 0 ? -1 : 1)
    native.volumeKeys = (on) => tellApp({ type: 'volume-keys', on: !!on })
  }
  if (can.wifiOnly) {
    native.wifiOnly = (on) => {
      host<{ wifiOnly: boolean }>('/host/prefs', { method: 'PUT', body: JSON.stringify({ wifiOnly: !!on }) })
        .catch((err) => console.warn('solo con wifi:', err?.message || err))
    }
  }
  // the host reads the file itself (its path on the host: a file of this device, a kept copy, the service's API)
  const hand = (action: 'save' | 'share', file: FileToHand) => {
    const path = file.src.startsWith('/') ? file.src : (() => { const u = new URL(file.src); return u.pathname + u.search })()
    return host<{ ok: boolean }>('/host/file', { method: 'POST', body: JSON.stringify({ action, path, name: file.name, mime: file.mime }) })
  }
  if (can.saveAs) native.saveAs = (file) => hand('save', file).then((r) => !!r?.ok)
  if (can.share) native.share = async (file) => { await hand('share', file) }
  if (can.lock) {
    native.lock = {
      available: () => host<{ available: boolean }>('/host/lock').then((r) => !!r?.available).catch(() => false),
      unlock: (reason) => host<{ ok: boolean }>('/host/lock', { method: 'POST', body: JSON.stringify({ reason }) }).then((r) => !!r?.ok),
    }
  }
  return native
}
