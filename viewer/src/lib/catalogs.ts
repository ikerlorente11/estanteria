/** The catalogs an app reads by itself: places on the internet that offer books, comics or manga to read
 * (public domain libraries, open catalogs…). Like Mihon's sources: some come with the app, more come from
 * a repository (an index.json somewhere, with the catalogs it offers: data only, no code), and any OPDS
 * catalog can be added by hand. Several are used at once, and each can be removed at any time. They are
 * kept in this device. */
import { reactive } from 'vue'
import type { Format } from './api.ts'
import { t } from './i18n.ts'
import { getJson, type NetBackend } from './net.ts'

/** How the app talks to a catalog: OPDS (1.2 or 2.0, told apart by what it answers) or an API it knows. */
export type CatalogProtocol = 'opds' | 'mangadex' | 'suwayomi'
export type CatalogContent = 'books' | 'comics' | 'manga'

export interface CatalogDef {
  /** unique: the repository's id for it, or one made from its address */
  id: string
  name: string
  description?: string
  /** ISO 639-1 codes of the languages it offers ('multi' when it has many) */
  languages: string[]
  content: CatalogContent[]
  protocol: CatalogProtocol
  /** where it starts */
  url: string
  /** adult content */
  nsfw?: boolean
  /** a site to visit (credits, terms) */
  site?: string
  /** a source of a Suwayomi library: the library's id, the source's id, whether it has a «latest» list, its icon */
  library?: string
  source?: string
  supportsLatest?: boolean
  icon?: string
}

/** Catalogs that are not kept in the registry but made from something else (a Suwayomi's sources). */
const resolvers: ((id: string) => CatalogDef | undefined)[] = []
export function registerCatalogResolver(resolve: (id: string) => CatalogDef | undefined): void { resolvers.push(resolve) }

/** What a repository's index.json holds. */
export interface CatalogRepoIndex {
  name: string
  description?: string
  catalogs: CatalogDef[]
}

export interface CatalogRepo {
  url: string
  name: string
  description?: string
  catalogs: CatalogDef[]
  /** when it was read last (seconds) */
  updated: number
}

/** Catalogs that come with the app (public, legal, free to read): the first choices of «Añadir catálogo». */
export const INCLUDED_CATALOGS: CatalogDef[] = [
  {
    id: 'gutenberg', name: 'Project Gutenberg', protocol: 'opds', url: 'https://m.gutenberg.org/ebooks.opds/',
    description: 'Más de 70.000 libros de dominio público en muchos idiomas.', languages: ['multi'], content: ['books'], site: 'https://www.gutenberg.org',
  },
  {
    id: 'textos-info', name: 'textos.info', protocol: 'opds', url: 'https://www.textos.info/opds',
    description: 'Biblioteca digital de libros de dominio público en español.', languages: ['es'], content: ['books'], site: 'https://www.textos.info',
  },
  {
    id: 'unglue-it', name: 'unglue.it', protocol: 'opds', url: 'https://unglue.it/api/opds/',
    description: 'Libros gratuitos con licencias libres (Creative Commons y dominio público).', languages: ['en'], content: ['books'], site: 'https://unglue.it',
  },
  {
    id: 'mangadex', name: 'MangaDex', protocol: 'mangadex', url: 'https://api.mangadex.org',
    description: 'Manga traducido por grupos de aficionados, en muchos idiomas.', languages: ['multi'], content: ['manga'], site: 'https://mangadex.org',
  },
]

export const LANGUAGE_NAMES: Record<string, string> = {
  multi: 'Varios idiomas', es: 'Español', en: 'English', fr: 'Français', de: 'Deutsch', it: 'Italiano', pt: 'Português', ca: 'Català',
  eu: 'Euskara', gl: 'Galego', ja: '日本語', ko: '한국어', zh: '中文', ru: 'Русский', pl: 'Polski', nl: 'Nederlands',
}
/** A language's own name ('multi', «Varios idiomas», in the app's language). */
export function languageName(code: string): string {
  const c = (code || '').toLowerCase()
  if (c === 'multi' || c === 'all') return t(LANGUAGE_NAMES.multi)
  if (c === 'es-419' || c === 'es-la') return 'Español (Latinoamérica)'
  if (c === 'pt-br') return 'Português (Brasil)'
  if (c === 'zh-hans' || c === 'zh') return '中文 (简体)'
  if (c === 'zh-hant') return '中文 (繁體)'
  return LANGUAGE_NAMES[c] || LANGUAGE_NAMES[c.split('-')[0]] || code.toUpperCase()
}
export const CONTENT_NAMES: Record<CatalogContent, string> = { books: 'Libros', comics: 'Cómics', manga: 'Manga' }

// ---- formats of what a catalog offers ----
const MIME_FORMATS: [RegExp, Format][] = [
  [/^application\/epub\+zip/, 'epub'], [/^application\/pdf/, 'pdf'], [/^application\/(x-mobipocket-ebook|vnd\.amazon\.ebook|x-mobi8-ebook)/, 'mobi'],
  [/^application\/(x-zip-compressed-fb2|fb2\+zip)/, 'fbz'], [/^application\/(x-fictionbook\+xml|x-fictionbook|fb2)/, 'fb2'], [/^application\/(vnd\.comicbook\+zip|x-cbz)/, 'cbz'],
  [/^application\/(vnd\.comicbook-rar|x-cbr)/, 'cbr'], [/^application\/(x-cb7|x-7z-compressed)/, 'cb7'], [/^application\/x-cbt/, 'cbt'],
  [/^image\/(vnd\.djvu|x-djvu)/, 'djvu'], [/^text\/plain/, 'txt'],
]
/** The format a MIME type stands for, if the app reads it. */
export function formatOfMime(mime: string): Format | null {
  const m = (mime || '').toLowerCase()
  return MIME_FORMATS.find(([re]) => re.test(m))?.[1] || null
}
/** The best of several offers: what reads best here first. */
const PREFERENCE: Format[] = ['epub', 'cbz', 'pdf', 'cbr', 'cb7', 'cbt', 'djvu', 'mobi', 'fbz', 'fb2', 'txt']
export function bestFormat<T extends { format: Format | null }>(offers: T[]): T | null {
  const usable = offers.filter((o) => o.format)
  return usable.sort((a, b) => PREFERENCE.indexOf(a.format!) - PREFERENCE.indexOf(b.format!))[0] || null
}

/** A file name for something downloaded: its title and the format's extension. */
export function fileName(title: string, format: Format): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'descarga'
  return `${clean}.${format}`
}

// ---- the registry: what this device uses ----
const KEY = 'estanteria.catalogs'

interface Saved { active: CatalogDef[]; repos: CatalogRepo[] }

function load(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (saved && Array.isArray(saved.active)) return { active: saved.active, repos: saved.repos || [] }
  } catch (_) { /* nothing kept */ }
  return { active: [], repos: [] }
}

export class CatalogRegistry {
  readonly state = reactive<Saved>(load())

  private save(): void {
    try { localStorage.setItem(KEY, JSON.stringify({ active: this.state.active, repos: this.state.repos })) } catch (_) { /* private mode */ }
  }

  get active(): CatalogDef[] { return this.state.active }
  get repos(): CatalogRepo[] { return this.state.repos }
  get(id: string): CatalogDef | undefined {
    return this.state.active.find((c) => c.id === id) || resolvers.map((r) => r(id)).find(Boolean)
  }
  has(id: string): boolean { return this.state.active.some((c) => c.id === id) }

  /** Everything that can be added: the included ones and those of the repositories, not active yet. */
  available(): { from: string; catalogs: CatalogDef[] }[] {
    const fresh = (list: CatalogDef[]) => list.filter((c) => !this.has(c.id))
    return [{ from: t('Incluidos'), catalogs: fresh(INCLUDED_CATALOGS) }, ...this.state.repos.map((r) => ({ from: r.name, catalogs: fresh(r.catalogs) }))]
      .filter((g) => g.catalogs.length)
  }

  add(def: CatalogDef): CatalogDef {
    if (this.has(def.id)) return this.get(def.id)!
    this.state.active.push({ ...def })
    this.save()
    return def
  }

  remove(id: string): void {
    this.state.active = this.state.active.filter((c) => c.id !== id)
    this.save()
  }

  /** An OPDS catalog given by hand: its address, a name and its language. */
  addOpds(url: string, name: string, language: string): CatalogDef {
    const host = (() => { try { return new URL(url).host } catch (_) { throw new Error(t('Esa dirección no es válida.')) } })()
    return this.add({ id: `opds:${url}`, name: name || host, protocol: 'opds', url, languages: [language || 'multi'], content: ['books'] })
  }

  /** Reads a repository (an index.json) and keeps it: its catalogs become available to add. */
  async addRepo(net: NetBackend, url: string): Promise<CatalogRepo> {
    if (/\.pb(\?|$)/i.test(url)) throw mihonRepo()
    let index: any
    try { index = await getJson<any>(net, url) } catch (err: any) {
      if (/JSON|Unexpected token/i.test(String(err?.message || err))) throw new Error(t('Esa dirección no tiene un repositorio de catálogos (un index.json).'))
      throw err
    }
    // Mihon's / Tachiyomi's repositories list Android extensions (apk files with code), not catalogs
    if (Array.isArray(index) && index.some((e: any) => e && (e.apk || e.pkg))) throw mihonRepo()
    if (!index || !Array.isArray(index.catalogs)) throw new Error(t('Eso no es un repositorio de catálogos (falta su lista «catalogs»).'))
    const catalogs = index.catalogs.filter(validDef).map((c) => ({ ...c, id: c.id.includes(':') ? c.id : `${new URL(url).host}:${c.id}` }))
    const repo: CatalogRepo = { url, name: index.name || new URL(url).host, description: index.description, catalogs, updated: Math.round(Date.now() / 1000) }
    this.state.repos = [...this.state.repos.filter((r) => r.url !== url), repo]
    this.save()
    return repo
  }

  removeRepo(url: string): void {
    this.state.repos = this.state.repos.filter((r) => r.url !== url)
    this.save()
  }
}

function mihonRepo(): Error {
  return new Error(t('Eso es un repositorio de extensiones de Mihon/Tachiyomi: son programas para esa app (archivos apk) y aquí no se pueden usar. '
    + 'Esta app lee repositorios de catálogos (un index.json). Para usar extensiones de Mihon, conecta un servidor Suwayomi en Bibliotecas.'))
}

function validDef(c: any): c is CatalogDef {
  return c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.url === 'string' && /^https?:\/\//.test(c.url)
    && ['opds', 'mangadex'].includes(c.protocol) && Array.isArray(c.languages) && Array.isArray(c.content)
}
