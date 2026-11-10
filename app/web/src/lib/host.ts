/** The page's side of the host (modules/estanteria-host, HostServer.kt): the local server the app
 * serves this page from. Everything goes over HTTP on 127.0.0.1 with the token the app put in the
 * URL (`?t=`), which is kept for the session. The service of the Archivador is reached through the
 * host too (`/api/...`): it adds the credential, so this page never holds the app password. */
import type { LocalFile, LocalRoot, OfflineBackend, OfflineEntry, OfflineProgress, Prepared, ShelfBackend, ShelfConfig, UploadDone } from 'estanteria-viewer'

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
}

export interface Connection {
  url: string
  username: string
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
export const saveConnection = (c: { url: string; username: string; token?: string }) => host<Connection>('/host/settings', { method: 'PUT', body: JSON.stringify(c) })
export const forgetToken = () => host<Connection>('/host/settings', { method: 'DELETE' })

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
