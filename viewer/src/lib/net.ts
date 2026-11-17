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
  /** Like `save`, but written a piece at a time as the page gets it (a big file of Telegram), never whole in
   * memory. A host without it gets the whole file through `save` (see writeStream). */
  saveStream?(name: string, folder?: string): Promise<FileSink>
}

/** A file being written by `saveStream`. */
export interface FileSink {
  /** the next piece, after the others */
  write(piece: Uint8Array): Promise<void>
  /** it is whole: what the shelf's `addFiles` takes for it */
  close(): Promise<string>
  /** it is not wanted: what was written is deleted */
  abort(): Promise<void>
}

/** A file the page fetches by itself, a piece at a time (a file of Telegram). */
export interface StreamSource {
  /** in bytes */
  size: number
  /** its bytes, in order; stops (throwing) once `signal` goes off */
  read(signal: AbortSignal): AsyncIterable<Uint8Array>
}

/** The bytes of `source` regrouped in pieces of `size` (the last one, what is left): what a server takes a piece
 * at a time out of what comes in whatever pieces it comes. */
export async function* inPieces(source: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
  let piece = new Uint8Array(size)
  let filled = 0
  for await (const bytes of source) {
    let at = 0
    while (at < bytes.length) {
      const n = Math.min(size - filled, bytes.length - at)
      piece.set(bytes.subarray(at, at + n), filled)
      filled += n
      at += n
      if (filled === size) {
        yield piece
        piece = new Uint8Array(size)
        filled = 0
      }
    }
  }
  if (filled) yield piece.subarray(0, filled)
}

/** `file` written into the shelf's folder (in `folder`) as `name`, telling how far it went; what the shelf's
 * `addFiles` takes for it. A piece at a time when the host can, else gathered here and saved whole. */
export async function writeStream(net: NetBackend, name: string, folder: string | undefined, file: StreamSource,
                                  progress: (done: number, total: number) => void, signal: AbortSignal): Promise<string> {
  let done = 0
  progress(0, file.size)
  if (!net.saveStream) {
    const pieces: Uint8Array[] = []
    for await (const piece of file.read(signal)) {
      pieces.push(piece)
      progress((done += piece.length), file.size)
    }
    return net.save(name, new Blob(pieces as BlobPart[]), folder)
  }
  const sink = await net.saveStream(name, folder)
  try {
    for await (const piece of file.read(signal)) {
      await sink.write(piece)
      progress((done += piece.length), file.size)
    }
  } catch (err) {
    await sink.abort().catch(() => {})
    throw err
  }
  return sink.close()
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
