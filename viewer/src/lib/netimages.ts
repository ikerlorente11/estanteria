/** Images of other servers (catalog covers, a chapter's pages) fetched through the app's network and kept
 * as object URLs, the least recently used released first: no hotlinking limits, no mixed content. */
import { reactive } from 'vue'
import type { NetBackend } from './net.ts'

const MAX = 300
/** the headers each server's requests need (by origin): a Suwayomi or a Komga asks for its basic auth, a Komga
 * with an API key for its X-API-Key */
const auth = new Map<string, Record<string, string>>()
export function setOriginHeaders(url: string, headers: Record<string, string>): void {
  try { if (Object.keys(headers).length) auth.set(new URL(url).origin, headers); else auth.delete(new URL(url).origin) } catch (_) { /* not a URL */ }
}
export function setImageAuth(url: string, header: string): void {
  setOriginHeaders(url, header ? { Authorization: header } : {})
}
/** the headers a request to `url` needs (its server's credential, if it asks for one) */
export function authOf(url: string): Record<string, string> {
  try { return { ...(auth.get(new URL(url).origin) || {}) } } catch (_) { return {} }
}
const ready = reactive(new Map<string, string>())
const loading = new Map<string, Promise<string>>()

/** The object URL of the image at `url` (fetched through `net` once). */
export function netImage(net: NetBackend, url: string): Promise<string> {
  if (url.startsWith('data:') || url.startsWith('blob:')) return Promise.resolve(url)
  const hit = ready.get(url)
  if (hit) return Promise.resolve(hit)
  const going = loading.get(url)
  if (going) return going
  const promise = net.fetch(url, { headers: { Accept: 'image/*', ...authOf(url) } }).then(async (res) => {
    if (!res.ok) throw new Error(`la imagen respondió ${res.status}`)
    const blob = await res.blob()
    const obj = URL.createObjectURL(blob)
    ready.set(url, obj)
    loading.delete(url)
    while (ready.size > MAX) {
      const oldest = ready.keys().next().value as string
      URL.revokeObjectURL(ready.get(oldest)!)
      ready.delete(oldest)
    }
    return obj
  }, (err) => { loading.delete(url); throw err })
  loading.set(url, promise)
  return promise
}

/** For a template: the object URL if it is here already, else '' and it starts coming (the page updates). */
export function netImageNow(net: NetBackend | undefined, url: string | null | undefined): string {
  if (!url) return ''
  if (!net || url.startsWith('data:') || url.startsWith('blob:')) return url      // already here
  const hit = ready.get(url)
  if (hit) return hit
  netImage(net, url).catch(() => {})
  return ''
}
