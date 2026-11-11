/** Reading catalogs by OPDS (1.2, Atom/XML, and 2.0, JSON) into a feed the app shows: where to go next
 * (navigation), what can be read (publications, with the files they offer), the next page and how to
 * search. Addresses are resolved against where the feed really was (after redirects). */
import type { Format } from './api.ts'
import { formatOfMime } from './catalogs.ts'
import { t } from './i18n.ts'
import type { NetBackend } from './net.ts'

export interface Offer {
  href: string
  type: string
  format: Format | null
}

export interface FeedEntry {
  id: string
  title: string
  author: string | null
  summary: string | null
  /** an image URL */
  cover: string | null
  language: string | null
  /** the files it can be downloaded as */
  offers: Offer[]
  /** a navigation entry: the feed it leads to */
  href: string | null
  /** a chapter read page by page (MangaDex): its id there */
  chapter?: string
  /** a chapter's number, as the source gives it */
  number?: string
  /** a short line under the title (a chapter's number and group) */
  detail?: string | null
}

export interface Feed {
  url: string
  title: string
  subtitle: string | null
  /** where to go: the sections of a navigation feed */
  navigation: { title: string; href: string; subtitle: string | null }[]
  /** what can be read here */
  entries: FeedEntry[]
  next: string | null
  /** how to search: a URL template with {searchTerms}, if the catalog can */
  search: string | null
}

const ATOM = 'http://www.w3.org/2005/Atom'
const ACQUISITION = /^http:\/\/opds-spec\.org\/acquisition(\/open-access|\/borrow|\/buy|\/sample|\/preview)?$|^http:\/\/opds-spec\.org\/acquisition$/

function absolute(href: string | null | undefined, base: string): string | null {
  if (!href) return null
  // a template ({searchTerms}, {?query}) keeps its braces: only what comes before them is resolved
  const brace = href.indexOf('{')
  if (brace >= 0) {
    const head = absolute(href.slice(0, brace) || './', base)
    return head ? head + href.slice(brace) : null
  }
  try { return new URL(href, base).toString() } catch (_) { return null }
}

/** The feed at `url` (OPDS 1.2 or 2.0, whichever it answers). */
export async function readFeed(net: NetBackend, url: string): Promise<Feed> {
  const res = await net.fetch(url, { headers: { Accept: 'application/opds+json, application/atom+xml, application/xml;q=0.9, */*;q=0.5' } })
  if (!res.ok) throw new Error(t('{host} respondió {status}', { host: new URL(url).host, status: res.status }))
  const where = res.headers.get('X-Fetch-Url') || res.url || url
  const type = res.headers.get('Content-Type') || ''
  const text = await res.text()
  if (/json/.test(type) || /^\s*\{/.test(text)) return parseOpds2(JSON.parse(text), where)
  const feed = parseOpds1(text, where)
  if (feed.search?.startsWith('osd:')) feed.search = await openSearchTemplate(net, feed.search.slice(4), where).catch(() => null)
  return feed
}

/** The search of a catalog: its template filled with the words. */
export function searchUrl(template: string, q: string): string {
  return template
    .replace(/\{\?(query|q|searchTerms)\}/g, (_, name) => `?${name}=${encodeURIComponent(q)}`)      // OPDS 2.0 (RFC 6570)
    .replace(/\{searchTerms\??\}/g, encodeURIComponent(q))                                         // OpenSearch
    .replace(/\{[a-zA-Z:]+\?\}/g, '')
}

// ---- OPDS 1.2 (Atom) ----
export function parseOpds1(xml: string, base: string): Feed {
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error(t('El catálogo no ha respondido con un OPDS que se pueda leer.'))
  const root = doc.documentElement
  const kids = (el: Element, name: string) => Array.from(el.children).filter((c) => c.localName === name && (c.namespaceURI === ATOM || !c.namespaceURI))
  const textOf = (el: Element, name: string) => kids(el, name)[0]?.textContent?.trim() || null
  const links = (el: Element) => kids(el, 'link').map((l) => ({ rel: l.getAttribute('rel') || '', href: l.getAttribute('href') || '', type: l.getAttribute('type') || '', title: l.getAttribute('title') || '' }))

  const feedLinks = links(root)
  const next = absolute(feedLinks.find((l) => l.rel === 'next')?.href, base)
  const searchLink = feedLinks.find((l) => l.rel === 'search')
  let search: string | null = null
  if (searchLink) {
    const href = absolute(searchLink.href, base)
    if (href) search = /opensearchdescription/.test(searchLink.type) ? `osd:${href}` : href
  }

  const navigation: Feed['navigation'] = []
  const entries: FeedEntry[] = []
  for (const e of kids(root, 'entry')) {
    const ls = links(e)
    const title = textOf(e, 'title') || t('Sin título')
    const offers: Offer[] = ls.filter((l) => ACQUISITION.test(l.rel) || /^http:\/\/opds-spec\.org\/acquisition/.test(l.rel))
      .map((l) => ({ href: absolute(l.href, base)!, type: l.type, format: formatOfMime(l.type) }))
      .filter((o) => o.href)
    const image = ls.find((l) => l.rel === 'http://opds-spec.org/image') || ls.find((l) => l.rel === 'http://opds-spec.org/image/thumbnail')
      || ls.find((l) => /^image\//.test(l.type) && /image|thumbnail|cover/.test(l.rel))
    const author = kids(e, 'author').map((a) => textOf(a, 'name')).filter(Boolean).join(', ') || null
    const summary = textOf(e, 'summary') || textOf(e, 'content')
    const language = Array.from(e.children).find((c) => c.localName === 'language')?.textContent?.trim() || null
    if (offers.length) {
      entries.push({ id: textOf(e, 'id') || offers[0].href, title, author, summary: summary ? strip(summary) : null, cover: absolute(image?.href, base), language, offers, href: null })
    } else {
      const nav = ls.find((l) => /navigation|acquisition|opds-catalog/.test(l.type) || l.rel === 'subsection' || /^http:\/\/opds-spec\.org\/(sort|featured|crawlable|group)/.test(l.rel))
        || ls.find((l) => l.rel === 'alternate' && /atom|opds/.test(l.type))
      const href = absolute(nav?.href, base)
      if (!href) continue
      // with a picture it is a book (or a series) to open, shown with its cover; else a section to go to
      if (image) entries.push({ id: textOf(e, 'id') || href, title, author, summary: summary ? strip(summary) : null, cover: absolute(image.href, base), language, offers: [], href })
      else navigation.push({ title, href, subtitle: summary ? strip(summary).slice(0, 140) : null })
    }
  }
  return { url: base, title: textOf(root, 'title') || t('Catálogo'), subtitle: textOf(root, 'subtitle'), navigation, entries, next, search }
}

async function openSearchTemplate(net: NetBackend, url: string, base: string): Promise<string | null> {
  const res = await net.fetch(url)
  if (!res.ok) return null
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml')
  const urls = Array.from(doc.getElementsByTagName('Url'))
  const pick = urls.find((u) => /atom|opds/.test(u.getAttribute('type') || '')) || urls[0]
  return absolute(pick?.getAttribute('template'), res.headers.get('X-Fetch-Url') || base)
}

// ---- OPDS 2.0 (JSON) ----
export function parseOpds2(json: any, base: string): Feed {
  const linkOf = (ls: any[] | undefined, rel: string) => (ls || []).find((l) => (Array.isArray(l.rel) ? l.rel : [l.rel]).includes(rel))
  const navigation: Feed['navigation'] = (json.navigation || []).map((n: any) => ({ title: n.title || t('Sección'), href: absolute(n.href, base)!, subtitle: n.properties?.description || null })).filter((n: any) => n.href)
  const pubs: any[] = [...(json.publications || []), ...((json.groups || []).flatMap((g: any) => g.publications || []))]
  for (const g of json.groups || []) {
    for (const n of g.navigation || []) { const href = absolute(n.href, base); if (href) navigation.push({ title: n.title, href, subtitle: g.metadata?.title || null }) }
    const more = linkOf(g.links, 'self')
    if (g.metadata?.title && more && !(g.navigation || []).length) { const href = absolute(more.href, base); if (href) navigation.push({ title: g.metadata.title, href, subtitle: null }) }
  }
  const entries: FeedEntry[] = pubs.map((p) => {
    const m = p.metadata || {}
    const offers: Offer[] = (p.links || []).filter((l: any) => /acquisition/.test(Array.isArray(l.rel) ? l.rel.join(' ') : l.rel || ''))
      .map((l: any) => ({ href: absolute(l.href, base)!, type: l.type || '', format: formatOfMime(l.type || '') })).filter((o: Offer) => o.href)
    const img = (p.images || [])[0]
    const authors = (Array.isArray(m.author) ? m.author : m.author ? [m.author] : []).map((a: any) => (typeof a === 'string' ? a : a.name)).filter(Boolean)
    return { id: m.identifier || offers[0]?.href || m.title, title: m.title || t('Sin título'), author: authors.join(', ') || null, summary: m.description ? strip(m.description) : null,
             cover: absolute(img?.href, base), language: Array.isArray(m.language) ? m.language[0] : m.language || null, offers, href: null }
  })
  const search = linkOf(json.links, 'search')
  return { url: base, title: json.metadata?.title || t('Catálogo'), subtitle: null, navigation, entries,
           next: absolute(linkOf(json.links, 'next')?.href, base), search: search ? absolute(search.href, base) : null }
}

function strip(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()
}
