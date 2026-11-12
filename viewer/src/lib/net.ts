/** The network as an app sees it: requests to any server (catalogs, libraries) made by the app itself,
 * without the browser's limits (CORS), and files downloaded straight into this device's shelf. The web
 * of a server has none: there the browser's own fetch is all there is. */
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
