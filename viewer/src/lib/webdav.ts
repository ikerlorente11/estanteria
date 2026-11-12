/** A WebDAV folder (Nextcloud, OpenCloud, a NAS…) read as a catalog: its subfolders to go into, its comics
 * and books to download and read. A PROPFIND of one level each time, with the library's credential (by origin,
 * see netimages.ts). */
import type { Format } from './api.ts'
import { t } from './i18n.ts'
import type { NetBackend } from './net.ts'
import { authOf } from './netimages.ts'
import type { Feed, FeedEntry } from './opds.ts'

const DAV = 'DAV:'
const BODY = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:resourcetype/>'
  + '<d:getcontenttype/><d:getcontentlength/><d:getlastmodified/></d:prop></d:propfind>'

/** What the app reads, by the end of the file's name. */
const EXTENSIONS: Record<string, Format> = {
  cbz: 'cbz', cbr: 'cbr', cb7: 'cb7', cbt: 'cbt', zip: 'cbz', rar: 'cbr', pdf: 'pdf', epub: 'epub', mobi: 'mobi', azw3: 'mobi', azw: 'mobi',
  prc: 'mobi', fb2: 'fb2', fbz: 'fbz', djvu: 'djvu', djv: 'djvu', txt: 'txt',
}
export function formatOfName(name: string): Format | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return (ext && EXTENSIONS[ext]) || null
}

export interface DavEntry { href: string; name: string; folder: boolean; size: number; type: string; modified: string }

/** What is inside the folder at `url` (not the folder itself), folders first, by name. */
export async function davList(net: NetBackend, url: string): Promise<DavEntry[]> {
  const folder = url.endsWith('/') ? url : `${url}/`
  const res = await net.fetch(folder, { method: 'PROPFIND', headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8', ...authOf(folder) }, body: BODY })
  if (res.status === 401 || res.status === 403) throw new Error(t('{host} no deja entrar con ese usuario y contraseña.', { host: new URL(folder).host }))
  if (res.status !== 207 && !res.ok) throw new Error(t('{host} respondió {status}', { host: new URL(folder).host, status: res.status }))
  const where = res.headers.get('X-Fetch-Url') || res.url || folder
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(t('Esa dirección no es una carpeta WebDAV.'))
  const self = new URL(where).pathname.replace(/\/+$/, '')
  const out: DavEntry[] = []
  for (const r of Array.from(doc.getElementsByTagNameNS(DAV, 'response'))) {
    const hrefText = r.getElementsByTagNameNS(DAV, 'href')[0]?.textContent?.trim()
    if (!hrefText) continue
    const href = new URL(hrefText, where).toString()
    const path = new URL(href).pathname.replace(/\/+$/, '')
    if (path === self || decodeURIComponent(path) === decodeURIComponent(self)) continue
    const prop = (name: string) => r.getElementsByTagNameNS(DAV, name)[0]
    const folderish = !!prop('resourcetype')?.getElementsByTagNameNS(DAV, 'collection').length
    const name = prop('displayname')?.textContent?.trim() || decodeURIComponent(path.split('/').pop() || '')
    if (!name || name.startsWith('.')) continue
    out.push({ href, name, folder: folderish, size: Number(prop('getcontentlength')?.textContent || 0), type: prop('getcontenttype')?.textContent?.trim() || '',
               modified: prop('getlastmodified')?.textContent?.trim() || '' })
  }
  return out.sort((a, b) => (a.folder === b.folder ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.folder ? -1 : 1))
}

function sizeText(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 2 ** 20) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 2 ** 30) return `${(bytes / 2 ** 20).toFixed(1)} MB`
  return `${(bytes / 2 ** 30).toFixed(2)} GB`
}

/** The folder at `url` as a feed: subfolders as sections, the files the app reads as entries. */
export async function webdavFeed(net: NetBackend, url: string, root: string): Promise<Feed> {
  const list = await davList(net, url)
  const entries: FeedEntry[] = list.filter((e) => !e.folder).flatMap((e) => {
    const format = formatOfName(e.name)
    if (!format) return []
    const title = e.name.replace(/\.[a-z0-9]+$/i, '')
    return [{ id: e.href, title, author: null, summary: null, cover: null, language: null, href: null,
              offers: [{ href: e.href, type: e.type, format }], detail: [format.toUpperCase(), sizeText(e.size)].filter(Boolean).join(' · ') }]
  })
  const here = decodeURIComponent(new URL(url).pathname.replace(/\/+$/, '').split('/').pop() || '')
  const atRoot = url.replace(/\/+$/, '') === root.replace(/\/+$/, '')
  return {
    url, title: atRoot ? '' : here, subtitle: null,
    navigation: list.filter((e) => e.folder).map((e) => ({ title: e.name, href: e.href, subtitle: null })),
    entries, next: null, search: null,
  }
}
