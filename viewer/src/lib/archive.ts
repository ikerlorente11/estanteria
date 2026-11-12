/** The Internet Archive (https://archive.org) as a catalog the app reads by itself: scanned books of the world's
 * libraries and golden-age comics, through its search API. Only what is free to download is listed (no lending
 * copies). A search lists items; an item lists the files it offers (EPUB, PDF with text, CBZ, CBR). Addresses:
 * `archive:home`, `archive:list?q=…&t=…&page=N`, `archive:search?q=…&page=N`, `archive:item/<identifier>`. */
import { t } from './i18n.ts'
import { getJson, type NetBackend } from './net.ts'
import type { Feed, FeedEntry } from './opds.ts'
import type { Format } from './api.ts'

const HOME = 'https://archive.org'
const FREE = 'mediatype:texts AND -access-restricted-item:true AND -collection:inlibrary AND -collection:printdisabled'
const READABLE = 'format:(EPUB OR "Text PDF" OR "Comic Book ZIP" OR "Comic Book RAR")'
/** the Archive's names of the formats the app reads */
const FORMATS: Record<string, Format> = { 'Comic Book ZIP': 'cbz', 'Comic Book RAR': 'cbr', EPUB: 'epub', 'Text PDF': 'pdf' }
const ROWS = 48
export const ARCHIVE_SHELVES: { title: string; q: string }[] = [
  { title: 'Cómics clásicos', q: 'collection:(fawcett-comics OR classiccomics OR captainmarveladventures OR ace-comics OR ForbiddenWorlds OR skywald-comics OR comic_fanzines)' },
  { title: 'Historietas en español', q: 'collection:historietas-collection' },
  { title: 'Revistas pulp', q: 'collection:pulpmagazinearchive' },
  { title: 'Libros en español', q: 'language:(spa OR Spanish) AND format:(EPUB OR "Text PDF")' },
  { title: 'Libros en euskera', q: 'language:(baq OR eus OR Basque) AND format:(EPUB OR "Text PDF")' },
  { title: 'Libros en inglés', q: 'language:(eng OR English) AND collection:(americana OR gutenberg OR cdl OR toronto OR europeanlibraries) AND format:(EPUB OR "Text PDF")' },
]

const first = (v: any) => (Array.isArray(v) ? v[0] : v)
function clean(text: any): string | null {
  const s = Array.isArray(text) ? text.join(' ') : text
  if (!s) return null
  return String(s).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim().slice(0, 2000) || null
}
const cover = (id: string) => `${HOME}/services/img/${encodeURIComponent(id)}`

async function search(net: NetBackend, q: string, page: number, title: string, again: (page: number) => string): Promise<Feed> {
  const params = new URLSearchParams([['q', `${FREE} AND ${q}`], ['rows', String(ROWS)], ['page', String(page)], ['output', 'json'], ['sort[]', 'downloads desc']])
  for (const f of ['identifier', 'title', 'creator', 'year', 'description', 'format']) params.append('fl[]', f)
  const data = await getJson<any>(net, `${HOME}/advancedsearch.php?${params}`)
  const docs: any[] = data?.response?.docs || []
  const found = Number(data?.response?.numFound || 0)
  const entries: FeedEntry[] = docs.filter((d) => d.identifier).flatMap((d) => {
    const formats: string[] = Array.isArray(d.format) ? d.format : d.format ? [d.format] : []
    const have = formats.map((f) => FORMATS[f]).filter(Boolean)
    if (!have.length) return []
    const creator = Array.isArray(d.creator) ? d.creator.slice(0, 3).join(', ') : d.creator || null
    const year = String(first(d.year) || '').match(/^\d{4}/)?.[0]
    return [{ id: `archive:${d.identifier}`, title: clean(first(d.title)) || d.identifier, author: creator, summary: clean(d.description), cover: cover(d.identifier),
              language: null, offers: [], href: `archive:item/${d.identifier}`, detail: [year, [...new Set(have)].map((f) => f.toUpperCase()).join(', ')].filter(Boolean).join(' · ') }]
  })
  return { url: again(page), title, subtitle: null, navigation: [], entries, next: page * ROWS < found && docs.length ? again(page + 1) : null, search: 'archive:search' }
}

/** The page of the Internet Archive at `address`. */
export async function archiveFeed(net: NetBackend, address: string): Promise<Feed> {
  if (!address || address === 'archive:home') {
    return { url: 'archive:home', title: 'Internet Archive', subtitle: t('Libros digitalizados por bibliotecas de todo el mundo y cómics clásicos de dominio público.'),
             navigation: ARCHIVE_SHELVES.map((s) => ({ title: t(s.title), href: `archive:list?${new URLSearchParams({ q: s.q, t: s.title })}`, subtitle: null })),
             entries: [], next: null, search: 'archive:search' }
  }
  const [head, query = ''] = address.split('?')
  const args = new URLSearchParams(query)
  const page = Math.max(1, Number(args.get('page')) || 1)
  if (head === 'archive:list') {
    const q = args.get('q') || '', title = args.get('t') || ''
    return search(net, q, page, t(title) || 'Internet Archive', (p) => `archive:list?${new URLSearchParams({ q, t: title, page: String(p) })}`)
  }
  if (head === 'archive:search') {
    const words = (args.get('q') || '').replace(/[^\p{L}\p{N}\s-]/gu, ' ').trim()
    if (!words) return archiveFeed(net, 'archive:home')
    return search(net, `(title:(${words}) OR creator:(${words})) AND ${READABLE}`, page, `«${args.get('q')}»`,
                  (p) => `archive:search?${new URLSearchParams({ q: args.get('q') || '', page: String(p) })}`)
  }
  const item = address.match(/^archive:item\/([\w.-]+)$/)?.[1]
  if (!item) throw new Error(t('Esa dirección no es del Internet Archive.'))
  const data = await getJson<any>(net, `${HOME}/metadata/${encodeURIComponent(item)}`)
  const meta = data?.metadata
  if (!meta) throw new Error(t('Ese elemento ya no está en el Internet Archive.'))
  const files: any[] = (data.files || []).filter((f: any) => FORMATS[f.format] && !/encrypted|_lcp/i.test(f.name || ''))
  const title = clean(first(meta.title)) || item
  const author = Array.isArray(meta.creator) ? meta.creator.slice(0, 3).join(', ') : meta.creator || null
  const entries: FeedEntry[] = files.map((f) => {
    const format = FORMATS[f.format]
    const href = `${HOME}/download/${encodeURIComponent(item)}/${f.name.split('/').map(encodeURIComponent).join('/')}`
    const size = Number(f.size || 0)
    // several files: each by its own name (they are often different issues), else the item's title
    const own = String(f.name).split('/').pop()!.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim()
    return { id: href, title: files.length > 1 && own ? own : title, author, summary: null, cover: cover(item), language: first(meta.language) || null,
             offers: [{ href, type: '', format }], href: null,
             detail: [format.toUpperCase(), size ? `${(size / 2 ** 20).toFixed(1)} MB` : ''].filter(Boolean).join(' · ') }
  })
  const about = clean(meta.description)?.replace(/([=_*~-])\1{4,}/g, ' ').replace(/\s+/g, ' ')
  const feed: Feed & { cover?: string } = { url: address, title, subtitle: about && about.length > 600 ? `${about.slice(0, 600).replace(/\s+\S*$/, '')}…` : about || null, navigation: [], entries, next: null, search: 'archive:search' }
  feed.cover = cover(item)
  if (!entries.length) feed.subtitle = t('Este elemento no ofrece ningún archivo que se pueda leer aquí.')
  return feed
}
