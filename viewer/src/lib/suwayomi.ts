/** Suwayomi (a server that runs Mihon/Tachiyomi extensions) through its GraphQL API: its extensions (to
 * install, update or remove), its sources (each one a catalog: popular, latest, search, a manga's chapters)
 * and a chapter's pages. Addresses inside a source are `suwayomi:<what>?…`, read here. Every request carries
 * the server's credential (HTTP basic). */
import type { Feed, FeedEntry } from './opds.ts'
import type { NetBackend } from './net.ts'
import { t } from './i18n.ts'

export interface SuwayomiServer {
  url: string
  /** the Authorization header ('' when the server has no login) */
  auth: string
}

export interface SuwayomiSource {
  id: string
  name: string
  displayName: string
  lang: string
  iconUrl: string
  isNsfw: boolean
  supportsLatest: boolean
}

export interface SuwayomiExtension {
  pkgName: string
  name: string
  lang: string
  versionName: string
  iconUrl: string
  isNsfw: boolean
  isInstalled: boolean
  hasUpdate: boolean
  isObsolete: boolean
}

function base(server: SuwayomiServer): string { return server.url.replace(/\/+$/, '') }

/** A GraphQL call; a clear error when the server says no. */
export async function gql<T>(net: NetBackend, server: SuwayomiServer, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await net.fetch(`${base(server)}/api/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(server.auth ? { Authorization: server.auth } : {}) },
    body: JSON.stringify({ query, variables }),
  })
  if (res.status === 401) throw new Error(t('Suwayomi no acepta ese usuario o esa contraseña.'))
  if (!res.ok) throw new Error(t('Suwayomi respondió {status}', { status: res.status }))
  const body = await res.json()
  if (body.errors?.length) throw new Error(body.errors.map((e: any) => e.message).join('; '))
  return body.data as T
}

/** Checks the server answers and lets us in: its version. */
export async function suwayomiCheck(net: NetBackend, server: SuwayomiServer): Promise<string> {
  const data = await gql<any>(net, server, 'query { aboutServer { name version } }')
  return `${data.aboutServer?.name || 'Suwayomi'} ${data.aboutServer?.version || ''}`.trim()
}

/** The sources of the installed extensions (the «Local source» left out). */
export async function suwayomiSources(net: NetBackend, server: SuwayomiServer): Promise<SuwayomiSource[]> {
  const data = await gql<any>(net, server, 'query { sources { nodes { id name displayName lang iconUrl isNsfw supportsLatest } } }')
  return (data.sources?.nodes || []).filter((s: SuwayomiSource) => s.id !== '0').map((s: SuwayomiSource) => ({ ...s, id: String(s.id), iconUrl: absolute(server, s.iconUrl) }))
}

const EXTENSION_FIELDS = 'pkgName name lang versionName iconUrl isNsfw isInstalled hasUpdate isObsolete'

/** Every extension the server's repositories offer (asked to look again at the repositories when `refresh`). */
export async function suwayomiExtensions(net: NetBackend, server: SuwayomiServer, refresh = false): Promise<SuwayomiExtension[]> {
  const data = refresh
    ? await gql<any>(net, server, `mutation { fetchExtensions(input: {}) { extensions { ${EXTENSION_FIELDS} } } }`)
    : await gql<any>(net, server, `query { extensions { nodes { ${EXTENSION_FIELDS} } } }`)
  const list: SuwayomiExtension[] = refresh ? data.fetchExtensions?.extensions || [] : data.extensions?.nodes || []
  return list.map((e) => ({ ...e, iconUrl: absolute(server, e.iconUrl) }))
}

/** Installs, updates or removes an extension. */
export async function suwayomiExtension(net: NetBackend, server: SuwayomiServer, pkgName: string, what: 'install' | 'update' | 'uninstall'): Promise<SuwayomiExtension> {
  const data = await gql<any>(net, server, `mutation ($id: String!, $patch: UpdateExtensionPatchInput!) { updateExtension(input: { id: $id, patch: $patch }) { extension { ${EXTENSION_FIELDS} } } }`,
    { id: pkgName, patch: { [what]: true } })
  return data.updateExtension?.extension
}

function absolute(server: SuwayomiServer, path: string | null | undefined): string {
  if (!path) return ''
  return /^https?:\/\//.test(path) ? path : `${base(server)}${path.startsWith('/') ? '' : '/'}${path}`
}

function parse(address: string): { what: string; params: URLSearchParams } {
  const [what, qs] = address.replace(/^suwayomi:/, '').split('?')
  return { what: what || 'home', params: new URLSearchParams(qs || '') }
}

/** a new run at random (each visit to «Al azar» is one) */
export const randomTag = () => Math.random().toString(36).slice(2, 8)

/** How many pages a source's popular list has, as far as is known: `lo` pages are there for sure,
 * from `hi` on there are none (0: not known). Kept on this device, it grows as pages are seen. */
interface PageBounds { lo: number; hi: number }
const boundsKey = (server: SuwayomiServer, source: string) => `estanteria.suwayomi.pages.${server.url}|${source}`
function pageBounds(server: SuwayomiServer, source: string): PageBounds {
  try { const b = JSON.parse(localStorage.getItem(boundsKey(server, source)) || 'null'); if (b) return b } catch (_) { /* none yet */ }
  return { lo: 1, hi: 0 }
}
function savePageBounds(server: SuwayomiServer, source: string, b: PageBounds) {
  try { localStorage.setItem(boundsKey(server, source), JSON.stringify(b)) } catch (_) { /* this time only */ }
}
/** the pages of the source already shown in a run */
const runs = new Map<string, Set<number>>()
function shownPages(run: string): Set<number> {
  let used = runs.get(run)
  if (!used) { used = new Set(); runs.set(run, used) }
  return used
}
/** A page not shown yet in the run: among those known, and some beyond (to find how far it goes). */
function pickPage(b: PageBounds, used: Set<number>, onlyAsk = false): number | null {
  const top = b.hi ? b.hi - 1 : Math.min(500, Math.max(10, b.lo * 2))
  const free: number[] = []
  for (let p = 1; p <= top; p++) if (!used.has(p)) free.push(p)
  if (!free.length) return null
  return onlyAsk ? free[0] : free[Math.floor(Math.random() * free.length)]
}
function shuffle<T>(list: T[]): T[] {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** What a source shows at `address` (its home when empty): popular, latest, a search, a manga's chapters. */
export async function suwayomiFeed(net: NetBackend, server: SuwayomiServer, source: string, address: string, supportsLatest = true): Promise<Feed> {
  const { what, params } = parse(address)
  if (what === 'home') {
    const navigation = [{ title: t('Populares'), href: 'suwayomi:list?type=POPULAR', subtitle: null }]
    if (supportsLatest) navigation.push({ title: t('Recientes'), href: 'suwayomi:list?type=LATEST', subtitle: null })
    navigation.push({ title: t('Al azar'), href: 'suwayomi:random', subtitle: null })
    // the home is the popular list itself, with the sections above it
    const popular = await suwayomiFeed(net, server, source, 'suwayomi:list?type=POPULAR')
    return { ...popular, url: 'suwayomi:home', navigation }
  }
  if (what === 'list' || what === 'search') {
    const page = Number(params.get('page') || 1)
    const type = what === 'search' ? 'SEARCH' : params.get('type') === 'LATEST' ? 'LATEST' : 'POPULAR'
    const q = params.get('q') || ''
    const data = await gql<any>(net, server,
      'mutation ($source: LongString!, $type: FetchSourceMangaType!, $page: Int!, $query: String) { fetchSourceManga(input: { source: $source, type: $type, page: $page, query: $query }) { hasNextPage mangas { id title thumbnailUrl author description } } }',
      { source, type, page, query: q || null })
    const got = data.fetchSourceManga
    const entries: FeedEntry[] = (got?.mangas || []).map((m: any) => ({
      id: String(m.id), title: m.title || t('Sin título'), author: m.author || null, summary: m.description || null, language: null, offers: [],
      cover: absolute(server, m.thumbnailUrl), href: `suwayomi:manga/${m.id}`,
    }))
    const next = got?.hasNextPage ? `suwayomi:${what}?${new URLSearchParams({ ...Object.fromEntries(params), page: String(page + 1) })}` : null
    return { url: address, title: q ? `«${q}»` : type === 'LATEST' ? t('Recientes') : t('Populares'), subtitle: null, navigation: [], entries, next, search: 'suwayomi:search?q={searchTerms}' }
  }
  if (what === 'random') {
    // a run at random: each page of it is a page of the source picked at random (never one already shown
    // in this run), its mangas shuffled; another visit is another run (`s`)
    const run = params.get('s') || randomTag()
    const k = Number(params.get('page') || 1)
    const bounds = pageBounds(server, source)
    const used = shownPages(run)
    let got: { mangas: any[]; hasNextPage: boolean } | null = null
    for (let tries = 0; tries < 4 && !got; tries++) {
      const p = pickPage(bounds, used)
      if (!p) break
      used.add(p)
      const data = await gql<any>(net, server,
        'mutation ($source: LongString!, $page: Int!) { fetchSourceManga(input: { source: $source, type: POPULAR, page: $page }) { hasNextPage mangas { id title thumbnailUrl author description } } }',
        { source, page: p })
      const answer = data.fetchSourceManga
      if (answer?.mangas?.length) {
        got = answer
        if (answer.hasNextPage) bounds.lo = Math.max(bounds.lo, p + 1)
        else { bounds.lo = Math.max(bounds.lo, p); bounds.hi = bounds.hi ? Math.min(bounds.hi, p + 1) : p + 1 }
      } else bounds.hi = bounds.hi ? Math.min(bounds.hi, p) : p        // past the last page: never above it again
      savePageBounds(server, source, bounds)
    }
    const entries: FeedEntry[] = shuffle(got?.mangas || []).map((m: any) => ({
      id: String(m.id), title: m.title || t('Sin título'), author: m.author || null, summary: m.description || null, language: null, offers: [],
      cover: absolute(server, m.thumbnailUrl), href: `suwayomi:manga/${m.id}`,
    }))
    const more = !!got && pickPage(bounds, used, true) !== null
    return { url: address, title: t('Al azar'), subtitle: null, navigation: [], entries,
             next: more ? `suwayomi:random?${new URLSearchParams({ s: run, page: String(k + 1) })}` : null, search: 'suwayomi:search?q={searchTerms}' }
  }
  const manga = what.match(/^manga\/(\d+)$/)
  if (manga) {
    const id = Number(manga[1])
    const data = await gql<any>(net, server,
      'mutation ($id: Int!) { fetchManga(input: { id: $id }) { manga { id title description thumbnailUrl } } fetchChapters(input: { mangaId: $id }) { chapters { id name chapterNumber scanlator pageCount sourceOrder } } }',
      { id })
    const m = data.fetchManga?.manga
    // the source gives them newest first: read in order, from the first
    const chapters = [...(data.fetchChapters?.chapters || [])].sort((a: any, b: any) => (a.chapterNumber - b.chapterNumber) || (b.sourceOrder - a.sourceOrder))
    const entries: FeedEntry[] = chapters.map((c: any) => ({
      id: String(c.id), title: c.name || t('Cap. {n}', { n: c.chapterNumber }), author: null, summary: null, cover: null, language: null, offers: [], href: null,
      chapter: `${id}:${c.id}`, number: c.chapterNumber >= 0 ? String(c.chapterNumber) : undefined,
      detail: [c.scanlator, c.pageCount > 0 ? t('{n} págs.', { n: c.pageCount }) : ''].filter(Boolean).join(' · ') || null,
    }))
    return { url: address, title: m?.title || t('Capítulos'), subtitle: m?.description?.slice(0, 400) || null, navigation: [], entries, next: null, search: null,
             ...(m?.thumbnailUrl ? { cover: absolute(server, m.thumbnailUrl) } : {}) } as Feed
  }
  throw new Error(t('Esa página de la fuente no existe.'))
}

/** The pages of a chapter (`<mangaId>:<chapterId>`), as image URLs of the server (they need its credential). */
export async function suwayomiPages(net: NetBackend, server: SuwayomiServer, chapter: string): Promise<string[]> {
  const chapterId = Number(chapter.split(':').pop())
  const data = await gql<any>(net, server, 'mutation ($id: Int!) { fetchChapterPages(input: { chapterId: $id }) { pages } }', { id: chapterId })
  const pages: string[] = data.fetchChapterPages?.pages || []
  if (!pages.length) throw new Error(t('Este capítulo no tiene páginas.'))
  return pages.map((p) => absolute(server, p))
}

export interface SuwayomiStore { name: string; indexUrl: string }

/** The extension repositories the server reads (Mihon's, like keiyoushi's). */
export async function suwayomiStores(net: NetBackend, server: SuwayomiServer): Promise<SuwayomiStore[]> {
  const data = await gql<any>(net, server, 'query { extensionStores { nodes { name indexUrl } } }')
  return data.extensionStores?.nodes || []
}
export async function suwayomiAddStore(net: NetBackend, server: SuwayomiServer, indexUrl: string): Promise<SuwayomiStore> {
  const data = await gql<any>(net, server, 'mutation ($url: String!) { addExtensionStore(input: { indexUrl: $url }) { extensionStore { name indexUrl } } }', { url: indexUrl })
  return data.addExtensionStore?.extensionStore
}
export async function suwayomiRemoveStore(net: NetBackend, server: SuwayomiServer, indexUrl: string): Promise<void> {
  await gql<any>(net, server, 'mutation ($url: String!) { removeExtensionStore(input: { indexUrl: $url }) { clientMutationId } }', { url: indexUrl })
}
