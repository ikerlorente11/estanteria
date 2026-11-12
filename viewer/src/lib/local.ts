/** The shelf of this device: folders the user adds as libraries and files opened one by one (a
 * double click, «Abrir con», a file dropped on the window). They join the library next to the
 * Archivador's, with their folders, series and progress, but nothing of them goes to the service:
 * the host lists them, makes their covers and pages and serves the files (see the desktop's
 * local.rs), and their progress and notes stay on this device (see Offline.own).
 *
 * Their items' ids start at LOCAL_BASE (the service's count from 1); each folder is a library
 * whose source id is below 0 (−its id), so the library's filters and folder browsing work as for
 * the Archivador. Files added on their own make the library «Archivos sueltos» (root 1). */
import { catalogMeta } from './catalogdownloads.ts'
import { reactive } from 'vue'
import type { Item, ItemDetail, ItemQuery, Series, Source } from './api.ts'
import { appSettings } from './appsettings.ts'
import { t } from './i18n.ts'

export const LOCAL_BASE = 2 ** 50
/** the root of the files added on their own */
export const LOOSE_ROOT = 1
/** What was downloaded from the catalogs: a library of its own, «Descargas», a folder per series (a root of
 * the viewer's, not a folder the host knows: the files are loose ones of the host, in its catalog folder). */
export const DOWNLOADS_ROOT = 2 ** 30

export function isLocal(id: number): boolean {
  return id >= LOCAL_BASE
}

/** A library of the shelf, as the library's filters name it: its source id is below 0. */
export function isLocalSource(source: string | number | null | undefined): boolean {
  return source !== undefined && source !== null && source !== '' && Number(source) < 0
}

export interface LocalRoot {
  id: number
  path: string
  name: string
}

export type LocalFormat = 'cbz' | 'cbr' | 'cb7' | 'cbt' | 'pdf' | 'djvu' | 'epub' | 'mobi' | 'fb2' | 'fbz' | 'txt'

/** A file of the shelf, as the host lists it (nothing opened). */
export interface LocalFile {
  id: number
  root: number
  path: string
  /** its folder inside the root, with «/» (empty at the top) */
  folder: string
  name: string
  format: LocalFormat
  size: number
  modified: number
}

export interface ShelfConfig {
  roots: LocalRoot[]
  files: number
  cache_limit: number
  cache_bytes: number
}

export interface Prepared {
  pages: number
  page_sizes: [number, number][]
}

export interface UploadDone {
  path: string
  item: Item | null
}

/** What the host does (the desktop: Rust commands and the `shelf` protocol). */
export interface ShelfBackend {
  config(): Promise<ShelfConfig>
  scan(): Promise<LocalFile[]>
  /** the system's folder and file choosers; [] when cancelled */
  pickFolders(): Promise<string[]>
  pickFiles(): Promise<string[]>
  addRoot(path: string): Promise<LocalRoot>
  removeRoot(id: number): Promise<void>
  renameRoot(id: number, name: string): Promise<void>
  addFile(path: string): Promise<LocalFile>
  removeFile(id: number): Promise<void>
  /** pages and their sizes (a cbr or cb7 is unpacked now) */
  prepare(id: number): Promise<Prepared>
  /** a URL the web view fetches without credentials: part is 'c' (cover), 'f' (the file) or 'p/<n>' */
  url(id: number, part: string): string
  setCacheLimit(bytes: number): Promise<void>
  clearCache(): Promise<void>
  /** shows the file in the system's file browser */
  reveal(id: number): Promise<void>
  /** puts the file in the reading folder of the Archivador, at `dest` (inside it); progress in bytes */
  upload(id: number, dest: string, progress: (sent: number, total: number) => void): Promise<UploadDone>
  /** stops the upload of that file going on (it fails with a cancelled error); a host without it lets it end */
  cancelUpload?(id: number): Promise<void>
}

export const LOCAL_FORMATS: LocalFormat[] = ['cbz', 'cbr', 'cb7', 'cbt', 'pdf', 'djvu', 'epub', 'mobi', 'fb2', 'fbz', 'txt']
const LOCAL_BOOKS: LocalFormat[] = ['epub', 'mobi', 'fb2', 'fbz', 'txt']
/** The folders of the reading folder by what is in them (the service files there what it copies, too). */
export const SHELF_FOLDERS = { manga: 'Manga', comic: 'Comics', book: 'Libros', pdf: 'Documentos' } as const
type Place = keyof typeof SHELF_FOLDERS
const SHELF_ALIASES: Record<Place, string[]> = {
  manga: ['manga', 'mangas'], comic: ['comics', 'comic'], book: ['libros', 'libro', 'books'], pdf: ['documentos', 'documents', 'pdf'],
}
/** What a folder's name says it holds (Cómics, comics, Manga…), if it says. */
function placeOf(name: string): Place | undefined {
  const plain = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
  return (Object.keys(SHELF_ALIASES) as Place[]).find((p) => SHELF_ALIASES[p].includes(plain))
}
export const CACHE_LIMITS = [1, 2, 5, 10, 20].map((gb) => gb * 2 ** 30)

/** Series, title and number from where the file is, like the service does for Lectura:
 * `<Serie>/<Serie> 012.cbz` (the series is the folder the file is in). */
export function guess(file: Pick<LocalFile, 'folder' | 'name'>): { title: string; series: string | null; number: number | null } {
  const stem = file.name.replace(/\.[^.]+$/, '')
  const parts = file.folder ? file.folder.split('/') : []
  const series = parts.length ? parts[parts.length - 1] : null
  const title = stem.replace(/_/g, ' ').split(/\s+/).filter(Boolean).join(' ')
  let rest = title
  if (series && rest.toLowerCase().startsWith(series.toLowerCase())) rest = rest.slice(series.length)
  // a chapter's number before any other («Vol. 15 · Cap. 114» is 114), then the first number
  const m = rest.match(/\b(?:cap(?:[ií]tulo)?|ch(?:apter)?)\.?\s*(\d+(?:[.,]\d+)?)/i) || rest.match(/(?<![\d.])(\d+(?:[.,]\d+)?)/)
  return { title, series, number: m ? Number(m[1].replace(',', '.')) : null }
}

/** The root a file shows under: its own; one downloaded from a catalog, «Descargas». */
function rootOf(f: LocalFile): number {
  return f.root === LOOSE_ROOT && catalogMeta[f.id] ? DOWNLOADS_ROOT : f.root
}

/** The series a title is of, when nothing says it: the title without its number («The Flash 012», «The Flash
 * #12», «The Flash vol. 2» are of «The Flash»); the title itself when it has none. */
export function seriesOfTitle(title: string): string {
  const cut = title.replace(/\s*(?:[-–—·:,(#]|\b(?:vol(?:umen|ume)?|tomo|t|cap(?:[ií]tulo)?|ch(?:apter)?|n\.?º|no|issue|parte|part)\b\.?)?\s*\d[\s\S]*$/i, '').trim()
  // what separated it from its number goes too («ONE PIECE - #001» is of «ONE PIECE», not «ONE PIECE -»)
  const bare = cut.replace(/[\s\-–—·:,(#]+$/, '').trim()
  return bare || cut || title.trim()
}

/** Where a file shows on the shelf: its folder; something downloaded from a catalog in a folder of its series
 * (or of its title, without a series), inside «Descargas». */
function shelfFolder(f: LocalFile): string {
  if (rootOf(f) !== DOWNLOADS_ROOT) return f.folder
  const meta = catalogMeta[f.id]!
  return (meta.series || seriesOfTitle(meta.title)).replace(/[\\/]+/g, ' ').trim()
}

function kindOf(format: LocalFormat): Item['kind'] {
  return LOCAL_BOOKS.includes(format) ? 'book' : format === 'pdf' || format === 'djvu' ? 'pdf' : 'comic'
}

export class LocalShelf {
  readonly state = reactive({
    loaded: false,
    scanning: false,
    roots: [] as LocalRoot[],
    files: {} as Record<number, LocalFile>,
    cacheLimit: 2 * 2 ** 30,
    cacheBytes: 0,
    error: '',
  })
  private prepared = new Map<number, Prepared>()
  private waiting = new Map<number, Promise<Prepared>>()
  readonly backend: ShelfBackend

  constructor(backend: ShelfBackend) {
    this.backend = backend
  }

  get count(): number { return Object.keys(this.state.files).length }
  has(id: number): boolean { return !!this.state.files[id] }

  async load(): Promise<void> {
    await this.refreshConfig()
    await this.scan()
    this.state.loaded = true
  }

  async refreshConfig(): Promise<void> {
    try {
      const config = await this.backend.config()
      this.state.roots = config.roots
      this.state.cacheLimit = config.cache_limit
      this.state.cacheBytes = config.cache_bytes
    } catch (err: any) { this.state.error = err?.message || String(err) }
  }

  /** Looks at the folders again (what came, what went). */
  async scan(): Promise<void> {
    this.state.scanning = true
    try {
      const files = await this.backend.scan()
      const next: Record<number, LocalFile> = {}
      for (const f of files) next[f.id] = f
      this.state.files = next
      this.state.error = ''
    } catch (err: any) { this.state.error = err?.message || String(err) }
    this.state.scanning = false
  }

  /** Asks for folders and adds them; the libraries they became. */
  async addFolders(): Promise<LocalRoot[]> {
    const paths = await this.backend.pickFolders()
    const roots: LocalRoot[] = []
    for (const path of paths) roots.push(await this.backend.addRoot(path))
    if (paths.length) { await this.refreshConfig(); await this.scan() }
    return roots
  }

  /** Asks for files and adds them; their items. */
  async pickFiles(): Promise<Item[]> {
    const paths = await this.backend.pickFiles()
    return this.addFiles(paths)
  }

  /** Files opened from outside (the Explorer, dropped on the window): on the shelf from now on. */
  async addFiles(paths: string[]): Promise<Item[]> {
    const out: Item[] = []
    for (const path of paths) {
      const file = await this.backend.addFile(path)
      this.state.files[file.id] = file
      out.push(this.item(file.id)!)
    }
    if (out.length) this.refreshConfig()
    return out
  }

  async removeRoot(id: number): Promise<void> {
    await this.backend.removeRoot(id)
    await this.refreshConfig()
    await this.scan()
  }

  async renameRoot(id: number, name: string): Promise<void> {
    await this.backend.renameRoot(id, name)
    await this.refreshConfig()
  }

  /** Takes a file added on its own off the shelf (the file stays where it is). */
  async removeFile(id: number): Promise<void> {
    await this.backend.removeFile(id)
    delete this.state.files[id]
  }

  async setCacheLimit(bytes: number): Promise<void> {
    await this.backend.setCacheLimit(bytes)
    await this.refreshConfig()
  }

  async clearCache(): Promise<void> {
    await this.backend.clearCache()
    this.prepared.clear()
    await this.refreshConfig()
  }

  rootName(root: number): string {
    if (root === LOOSE_ROOT) return t('Archivos sueltos')
    if (root === DOWNLOADS_ROOT) return t('Descargas')
    return this.state.roots.find((r) => r.id === root)?.name || t('Este dispositivo')
  }

  /** The item a file of the shelf is (pages known once it was prepared). */
  item(id: number): Item | null {
    const f = this.state.files[id]
    if (!f) return null
    const folder = shelfFolder(f)
    const g = guess({ folder, name: f.name })
    const prepared = this.prepared.get(id)
    return {
      id, source_id: -rootOf(f), path: f.path, folder, name: f.name, format: f.format, kind: kindOf(f.format), size: f.size,
      modified: f.modified, title: (rootOf(f) === DOWNLOADS_ROOT && catalogMeta[f.id]?.title) || g.title, series: g.series, number: g.number, author: null, year: null, summary: null,
      pages: prepared?.pages || 0, direction: 'ltr', cover: true, state: 'ready', error: null, added: f.modified, updated: f.modified,
      meta: { local: true, root: rootOf(f), rootName: this.rootName(rootOf(f)) }, progress: null,
    }
  }

  /** The item ready to read: its pages counted (once). */
  async detail(id: number): Promise<ItemDetail> {
    const base = this.item(id)
    if (!base) throw Object.assign(new Error(t('Ese archivo ya no está en este dispositivo (¿se movió o se borró?).')), { status: 404 })
    // books and DjVu are read from the whole file (the reader counts their pages): nothing to prepare
    if (base.kind === 'book' || base.format === 'djvu') return { ...base, page_sizes: [], bookmarks: [] }
    let prepared = this.prepared.get(id)
    if (!prepared) {
      let going = this.waiting.get(id)
      if (!going) {
        going = this.backend.prepare(id).finally(() => this.waiting.delete(id))
        this.waiting.set(id, going)
      }
      prepared = await going
      this.prepared.set(id, prepared)
    }
    return { ...this.item(id)!, page_sizes: prepared.page_sizes, bookmarks: [] }
  }

  url(id: number, part: string): string { return this.backend.url(id, part) }

  /** The libraries of the shelf, as the library's filters show them. */
  sources(): Source[] {
    const counts = new Map<number, number>()
    for (const f of Object.values(this.state.files)) counts.set(rootOf(f), (counts.get(rootOf(f)) || 0) + 1)
    const roots: { id: number; name: string; path: string }[] = [...this.state.roots]
    if (counts.get(DOWNLOADS_ROOT)) roots.push({ id: DOWNLOADS_ROOT, name: t('Descargas'), path: '' })
    if (counts.get(LOOSE_ROOT)) roots.push({ id: LOOSE_ROOT, name: t('Archivos sueltos'), path: '' })
    return roots.map((r) => ({
      id: -r.id, kind: 'local' as any, catalog: false, label: t('Este dispositivo'), name: r.name, url: r.path, username: '', config: {}, enabled: true,
      scanned: null, scan_error: null, info: {}, items: counts.get(r.id) || 0, supports_progress: false, created: 0, updated: 0,
    }))
  }

  /** Every folder of a library (with the ones on the way), like the Archivador's `folders`. */
  folders(source: number): string[] {
    const root = -source
    const out = new Set<string>()
    for (const f of Object.values(this.state.files)) {
      const folder = shelfFolder(f)
      if (rootOf(f) !== root || !folder) continue
      const parts = folder.split('/')
      for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
    }
    return [...out]
  }

  /** Everything listed (the formats hidden in the settings are not). */
  all(): Item[] {
    const hidden = appSettings.hiddenFormats
    return Object.values(this.state.files).filter((f) => !hidden.includes(f.format)).map((f) => this.item(f.id)!)
  }

  /** What /api/items would answer for the shelf. */
  query(q: ItemQuery & { series?: string }, withProgress: (i: Item) => Item = (i) => i): Item[] {
    const text = (q.q || '').toLowerCase()
    const source = q.source
    let out = this.all().filter((i) =>
      (!text || [i.title, i.series, i.name].some((t) => (t || '').toLowerCase().includes(text))) &&
      (!q.series || i.series === q.series) &&
      (!q.kind || i.kind === q.kind) &&
      (!isLocalSource(source) || i.source_id === Number(source)) &&
      (q.folder === undefined || q.folder === null || (q.direct ? i.folder === q.folder : (q.folder === '' || i.folder === q.folder || i.folder.startsWith(q.folder + '/')))))
      .map(withProgress)
    const sort = q.sort || 'series'
    const lower = (s: string | null) => (s || '').toLocaleLowerCase()
    out = out.sort((a, b) => sort === 'title' ? lower(a.title).localeCompare(lower(b.title), 'es', { numeric: true })
      : sort === 'added' ? b.added - a.added : sort === 'modified' ? b.modified - a.modified
      : (lower(a.series) || '￿').localeCompare(lower(b.series) || '￿', 'es') || (a.number ?? 0) - (b.number ?? 0)
        || lower(a.title).localeCompare(lower(b.title), 'es', { numeric: true }))
    const offset = Number(q.offset || 0)
    return out.slice(offset, offset + Number(q.limit || 200))
  }

  series(withProgress: (i: Item) => Item = (i) => i): Series[] {
    const by = new Map<string, Item[]>()
    for (const i of this.all()) if (i.series) by.set(i.series, [...(by.get(i.series) || []), withProgress(i)])
    return [...by.entries()].map(([series, items]) => {
      const first = [...items].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0]
      return { series, items: items.length, finished: items.filter((i) => i.progress?.finished).length, cover_item: first.id, cover: true,
               modified: Math.max(...items.map((i) => i.modified)), added: Math.max(...items.map((i) => i.added)),
               last_read: Math.max(0, ...items.map((i) => i.progress?.updated || 0)) || null }
    })
  }

  /** Where a file would go in the reading folder of the Archivador: its library's name and its folder. */
  /** Where in the server's reading folder a file goes, like the rest there: `Manga`, `Comics`, `Libros` or
   * `Documentos` (spelled as the server already has it, when it has one), then its series (its folders
   * here), then the file. What it is: what the catalog said, else what its folders say («Cómics/…»,
   * «Manga/…»), else its format. `existing`: the server's folders, to follow how they are spelled. */
  uploadPath(id: number, existing: string[] = []): string {
    const f = this.state.files[id]
    if (!f) return ''
    const meta = catalogMeta[id]
    const segs = f.folder ? f.folder.split('/').filter(Boolean) : []
    const named = [f.root === LOOSE_ROOT ? '' : this.rootName(f.root), ...segs].map(placeOf).find(Boolean)
    const kind = kindOf(f.format)
    const place: Place = meta ? (meta.kind === 'manga' ? 'manga' : meta.kind === 'book' ? 'book' : 'comic')
      : named || (kind === 'book' ? 'book' : kind === 'pdf' ? 'pdf' : 'comic')
    // the folder that says what it is is the top one there: not repeated below it
    while (segs.length && placeOf(segs[0]) === place) segs.shift()
    const tops = [...new Set(existing.map((p) => p.split('/')[0]).filter(Boolean))]
    const top = tops.find((t) => placeOf(t) === place) || SHELF_FOLDERS[place]
    const clean = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim()
    // a library of this device whose name is not «Manga», «Cómics»… and has no such folders inside is the
    // series itself (a folder «ONE PIECE» added as a library): its name goes up as the folder, as it shows here
    const rootName = f.root !== LOOSE_ROOT ? this.rootName(f.root) : ''
    const rootIsSeries = !!rootName && !placeOf(rootName) && !f.folder.split('/').some((s) => placeOf(s))
    let below = meta ? (meta.series ? [clean(meta.series)] : []) : rootIsSeries ? [clean(rootName), ...segs] : segs
    if (!below.length) {
      // loose: its series is what the name says («ONE PIECE - #001…» is of «ONE PIECE»); never loose among the rest
      const title = guess(f).title
      const fromTitle = seriesOfTitle(title)
      if (fromTitle && fromTitle !== title) below = [clean(fromTitle)]
    }
    // a series folder the server has already, spelled as it is there («One Piece» and «ONE PIECE» are one)
    if (below.length) {
      const there = existing.find((p) => p.toLowerCase() === `${top}/${below[0]}`.toLowerCase())
      if (there) below = [there.split('/')[1], ...below.slice(1)]
    }
    return [top, ...below, f.name].join('/')
  }

}
