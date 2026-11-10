/** The shelf of this device: folders the user adds as libraries and files opened one by one (a
 * double click, «Abrir con», a file dropped on the window). They join the library next to the
 * Archivador's, with their folders, series and progress, but nothing of them goes to the service:
 * the host lists them, makes their covers and pages and serves the files (see the desktop's
 * local.rs), and their progress and notes stay on this device (see Offline.own).
 *
 * Their items' ids start at LOCAL_BASE (the service's count from 1); each folder is a library
 * whose source id is below 0 (−its id), so the library's filters and folder browsing work as for
 * the Archivador. Files added on their own make the library «Archivos sueltos» (root 1). */
import { reactive } from 'vue'
import type { Item, ItemDetail, ItemQuery, Series, Source } from './api.ts'

export const LOCAL_BASE = 2 ** 50
/** the root of the files added on their own */
export const LOOSE_ROOT = 1

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

export type LocalFormat = 'cbz' | 'cbr' | 'cb7' | 'epub' | 'pdf'

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
}

export const LOCAL_FORMATS: LocalFormat[] = ['cbz', 'cbr', 'cb7', 'epub', 'pdf']
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
  const m = rest.match(/(?<![\d.])(\d+(?:[.,]\d+)?)/)
  return { title, series, number: m ? Number(m[1].replace(',', '.')) : null }
}

function kindOf(format: LocalFormat): Item['kind'] {
  return format === 'epub' ? 'book' : format === 'pdf' ? 'pdf' : 'comic'
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

  /** Asks for folders and adds them; how many. */
  async addFolders(): Promise<number> {
    const paths = await this.backend.pickFolders()
    for (const path of paths) await this.backend.addRoot(path)
    if (paths.length) { await this.refreshConfig(); await this.scan() }
    return paths.length
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
    if (root === LOOSE_ROOT) return 'Archivos sueltos'
    return this.state.roots.find((r) => r.id === root)?.name || 'Este PC'
  }

  /** The item a file of the shelf is (pages known once it was prepared). */
  item(id: number): Item | null {
    const f = this.state.files[id]
    if (!f) return null
    const g = guess(f)
    const prepared = this.prepared.get(id)
    return {
      id, source_id: -f.root, path: f.path, folder: f.folder, name: f.name, format: f.format, kind: kindOf(f.format), size: f.size,
      modified: f.modified, title: g.title, series: g.series, number: g.number, author: null, year: null, summary: null,
      pages: prepared?.pages || 0, direction: 'ltr', cover: true, state: 'ready', error: null, added: f.modified, updated: f.modified,
      meta: { local: true, root: f.root, rootName: this.rootName(f.root) }, progress: null,
    }
  }

  /** The item ready to read: its pages counted (once). */
  async detail(id: number): Promise<ItemDetail> {
    const base = this.item(id)
    if (!base) throw Object.assign(new Error('Ese archivo ya no está en tu PC (¿se movió o se borró?).'), { status: 404 })
    if (base.kind === 'book') return { ...base, page_sizes: [], bookmarks: [] }
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
    for (const f of Object.values(this.state.files)) counts.set(f.root, (counts.get(f.root) || 0) + 1)
    const roots: { id: number; name: string; path: string }[] = [...this.state.roots]
    if (counts.get(LOOSE_ROOT)) roots.push({ id: LOOSE_ROOT, name: 'Archivos sueltos', path: '' })
    return roots.map((r) => ({
      id: -r.id, kind: 'local' as any, catalog: false, label: 'Este PC', name: r.name, url: r.path, username: '', config: {}, enabled: true,
      scanned: null, scan_error: null, info: {}, items: counts.get(r.id) || 0, supports_progress: false, created: 0, updated: 0,
    }))
  }

  /** Every folder of a library (with the ones on the way), like the Archivador's `folders`. */
  folders(source: number): string[] {
    const root = -source
    const out = new Set<string>()
    for (const f of Object.values(this.state.files)) {
      if (f.root !== root || !f.folder) continue
      const parts = f.folder.split('/')
      for (let i = 1; i <= parts.length; i++) out.add(parts.slice(0, i).join('/'))
    }
    return [...out]
  }

  all(): Item[] {
    return Object.keys(this.state.files).map((id) => this.item(Number(id))!)
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
  uploadPath(id: number): string {
    const f = this.state.files[id]
    if (!f) return ''
    const root = f.root === LOOSE_ROOT ? 'Del PC' : this.rootName(f.root)
    return [root, f.folder, f.name].filter(Boolean).join('/')
  }
}
