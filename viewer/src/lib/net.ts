/** The network as an app sees it: requests to any server (catalogs, libraries) made by the app itself,
 * without the browser's limits (CORS), and files downloaded straight into this device's shelf. The web
 * of a server has none: there the browser's own fetch is all there is. */
import type { Api } from './api.ts'
import { t } from './i18n.ts'

export interface NetInit {
  method?: string
  headers?: Record<string, string>
  body?: string
}

export interface NetBackend {
  /** A request the app makes for the page (any http or https address; redirects followed). */
  fetch(url: string, init?: NetInit): Promise<Response>
  /** Downloads a file into this device's shelf folder and answers what the shelf's `addFiles` takes for it
   * (a path on the desktop, a content:// or file:// URI on Android). `name` is the file name to give it;
   * `folder`, the folder (of its series) it goes in, inside that folder. */
  download(url: string, name: string, headers?: Record<string, string>, progress?: (done: number, total: number) => void, folder?: string, signal?: AbortSignal): Promise<string>
  /** Saves a file made here (a chapter packed as CBZ) into the same folder `download` uses (in `folder`);
   * answers what the shelf's `addFiles` takes for it. */
  save(name: string, data: Blob, folder?: string): Promise<string>
}

/** The browser's fetch, as a NetBackend (the web; anything the server does not allow fails). */
export const browserNet: NetBackend = {
  fetch: (url, init) => fetch(url, { method: init?.method, headers: init?.headers, body: init?.body }),
  download: () => Promise.reject(new Error(t('Aquí no se pueden guardar archivos en el dispositivo.'))),
  save: () => Promise.reject(new Error(t('Aquí no se pueden guardar archivos en el dispositivo.'))),
}

/** The network of the web of a server: every request made by the service for the page (`/api/net`), so
 * catalogs and libraries without CORS answer here too. Nothing is saved on the device (there is none). */
export function serverNet(api: Api): NetBackend {
  return {
    async fetch(url, init) {
      const res = await api.netFetch(url, init)
      const status = Number(res.headers.get('X-Net-Status'))
      if (!res.ok || !(status >= 200 && status <= 599)) {
        const detail = await res.json().then((b) => b?.detail).catch(() => '')
        throw new Error(typeof detail === 'string' && detail ? detail : t('{host} respondió {status}', { host: new URL(url).host, status: res.status }))
      }
      const headers = new Headers()
      for (const h of ['Content-Type', 'Content-Disposition', 'Content-Length']) {
        const v = res.headers.get(h)
        if (v) headers.set(h, v)
      }
      headers.set('X-Fetch-Url', res.headers.get('X-Net-Url') || url)      // where it ended (opds.ts resolves links against it)
      return new Response([101, 204, 205, 304].includes(status) ? null : res.body, { status, headers })
    },
    download: browserNet.download,
    save: browserNet.save,
  }
}

/** The JSON at `url`, or a clear error. */
export async function getJson<T>(net: NetBackend, url: string, headers?: Record<string, string>): Promise<T> {
  const res = await net.fetch(url, { headers: { Accept: 'application/json', ...(headers || {}) } })
  if (!res.ok) throw new Error(t('{host} respondió {status}', { host: new URL(url).host, status: res.status }))
  return res.json() as Promise<T>
}

/** The text at `url` (an OPDS feed, a page), or a clear error. */
export async function getText(net: NetBackend, url: string, headers?: Record<string, string>): Promise<string> {
  const res = await net.fetch(url, { headers })
  if (!res.ok) throw new Error(t('{host} respondió {status}', { host: new URL(url).host, status: res.status }))
  return res.text()
}
