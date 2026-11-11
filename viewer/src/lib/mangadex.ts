/** MangaDex (api.mangadex.org) as a catalog: its manga, by popularity, recency, rating or a search, in one
 * language at a time; each manga's chapters in that language; and a chapter's pages (MangaDex@Home).
 * Addresses inside the catalog are `mangadex:<what>?…`, read here. Only safe and suggestive content. */
import type { Feed, FeedEntry } from './opds.ts'
import { t } from './i18n.ts'
import { getJson, type NetBackend } from './net.ts'

const API = 'https://api.mangadex.org'
const PAGE = 24
const RATINGS = 'contentRating[]=safe&contentRating[]=suggestive'
/** the languages MangaDex has most in (what the catalog offers to choose) */
export const MANGADEX_LANGUAGES = ['es', 'en', 'pt-br', 'fr', 'it', 'de', 'ca', 'ja']
const ORDERS: Record<string, { title: string; order: string }> = {
  popular: { title: 'Populares', order: 'order[followedCount]=desc' },
  latest: { title: 'Con capítulos nuevos', order: 'order[latestUploadedChapter]=desc' },
  rated: { title: 'Mejor valorados', order: 'order[rating]=desc' },
}

function nameIn(map: Record<string, string> | undefined, lang: string): string {
  if (!map) return ''
  return map[lang] || map[lang.split('-')[0]] || map.en || map['ja-ro'] || Object.values(map)[0] || ''
}

/** the MangaDex languages a choice stands for: Spanish is Spain's and Latin America's together */
function langs(lang: string, param: string): string {
  const codes = lang === 'es' ? ['es', 'es-la'] : [lang]
  return codes.map((c) => `${param}[]=${encodeURIComponent(c)}`).join('&')
}

function parse(address: string): { what: string; params: URLSearchParams } {
  const [what, qs] = address.replace(/^mangadex:/, '').split('?')
  return { what: what || 'home', params: new URLSearchParams(qs || '') }
}

/** What the catalog shows at `address` (its home when empty), in `lang`. */
export async function mangadexFeed(net: NetBackend, address: string, lang: string): Promise<Feed> {
  const { what, params } = parse(address)
  if (what === 'home') {
    return { url: 'mangadex:home', title: 'MangaDex', subtitle: null, entries: [], next: null, search: `mangadex:search?q={searchTerms}`,
             navigation: Object.entries(ORDERS).map(([key, o]) => ({ title: t(o.title), href: `mangadex:list?order=${key}`, subtitle: null })) }
  }
  if (what === 'list' || what === 'search') {
    const offset = Number(params.get('offset') || 0)
    const order = ORDERS[params.get('order') || 'popular'] || ORDERS.popular
    const q = params.get('q') || ''
    const url = `${API}/manga?limit=${PAGE}&offset=${offset}&includes[]=cover_art&${RATINGS}&hasAvailableChapters=true&${langs(lang, 'availableTranslatedLanguage')}`
      + (q ? `&title=${encodeURIComponent(q)}&order[relevance]=desc` : `&${order.order}`)
    const got = await getJson<any>(net, url)
    const entries: FeedEntry[] = (got.data || []).map((m: any) => {
      const art = (m.relationships || []).find((r: any) => r.type === 'cover_art')?.attributes?.fileName
      return { id: m.id, title: nameIn(m.attributes?.title, lang) || nameIn(Object.assign({}, ...(m.attributes?.altTitles || [])), lang) || t('Sin título'),
               author: null, summary: nameIn(m.attributes?.description, lang) || null, language: lang, offers: [],
               cover: art ? `https://uploads.mangadex.org/covers/${m.id}/${art}.256.jpg` : null, href: `mangadex:manga/${m.id}` }
    })
    const more = offset + PAGE < (got.total || 0)
    const next = more ? `mangadex:${what}?${new URLSearchParams({ ...Object.fromEntries(params), offset: String(offset + PAGE) })}` : null
    return { url: address, title: q ? `«${q}»` : t(order.title), subtitle: null, navigation: [], entries, next, search: `mangadex:search?q={searchTerms}` }
  }
  const manga = what.match(/^manga\/([\w-]+)$/)
  if (manga) {
    const id = manga[1]
    const offset = Number(params.get('offset') || 0)
    const [info, feed] = await Promise.all([
      offset ? Promise.resolve(null) : getJson<any>(net, `${API}/manga/${id}?includes[]=cover_art`),
      getJson<any>(net, `${API}/manga/${id}/feed?limit=100&offset=${offset}&${langs(lang, 'translatedLanguage')}&order[volume]=asc&order[chapter]=asc&includes[]=scanlation_group&${RATINGS}`),
    ])
    const entries: FeedEntry[] = (feed.data || []).filter((c: any) => !c.attributes?.externalUrl && c.attributes?.pages > 0).map((c: any) => {
      const a = c.attributes
      const group = (c.relationships || []).find((r: any) => r.type === 'scanlation_group')?.attributes?.name
      const number = [a.volume ? t('Vol. {n}', { n: a.volume }) : '', a.chapter ? t('Cap. {n}', { n: a.chapter }) : t('Único')].filter(Boolean).join(' · ')
      return { id: c.id, title: a.title ? `${number}: ${a.title}` : number, author: null, summary: null, cover: null, language: a.translatedLanguage, offers: [], href: null,
               chapter: c.id, number: a.chapter || undefined, detail: [group, t('{n} págs.', { n: a.pages })].filter(Boolean).join(' · ') }
    })
    const more = offset + 100 < (feed.total || 0)
    const m = info?.data
    const art = m && (m.relationships || []).find((r: any) => r.type === 'cover_art')?.attributes?.fileName
    return { url: address, title: m ? nameIn(m.attributes?.title, lang) : t('Capítulos'), subtitle: m ? nameIn(m.attributes?.description, lang).slice(0, 400) || null : null,
             navigation: [], entries, next: more ? `mangadex:manga/${id}?offset=${offset + 100}` : null, search: null,
             ...(art ? { cover: `https://uploads.mangadex.org/covers/${id}/${art}.512.jpg` } : {}) } as Feed
  }
  throw new Error(t('Esa página de MangaDex no existe.'))
}

/** The pages of a chapter, in order (image URLs of a MangaDex@Home server). */
export async function mangadexPages(net: NetBackend, chapter: string, saver = false): Promise<string[]> {
  const got = await getJson<any>(net, `${API}/at-home/server/${chapter}`)
  const files: string[] = saver ? got.chapter?.dataSaver || [] : got.chapter?.data || []
  if (!got.baseUrl || !files.length) throw new Error(t('Este capítulo no tiene páginas (puede que esté solo en la web del editor).'))
  return files.map((f) => `${got.baseUrl}/${saver ? 'data-saver' : 'data'}/${got.chapter.hash}/${f}`)
}
