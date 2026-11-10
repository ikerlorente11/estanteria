/** Reading without connection, shared by the apps that can keep files (the desktop, Android): which
 * items are kept, the queue of downloads, and what the API answers when the service cannot be reached.
 *
 * A kept item is its pages as the service rendered them (or the file, for a book) plus what the
 * service said of it; the host stores them (`OfflineBackend`) and gives a URL for each part. The API
 * asks here first for an image or a file, so a kept item opens from disk even with connection, and
 * falls back here for its JSON when the service does not answer. Reading progress made offline waits
 * here (in this device's storage) and is sent when the service answers again. */
import { reactive } from 'vue'
import type { Api, ApiOffline, Bookmark, Item, ItemDetail, LibraryStatus, Progress, Series } from './api.ts'
import { isLocal, isLocalSource, type LocalShelf } from './local.ts'

export interface OfflineEntry {
  item: ItemDetail
  /** the width the pages were asked in */
  width: number
  /** when it finished (seconds) */
  added: number
  bytes: number
}

export interface OfflineProgress {
  id: number
  done: number
  total: number
  bytes: number
  error: string | null
  finished: boolean
  cancelled: boolean
}

export interface OfflineJob {
  id: number
  title: string
  state: 'waiting' | 'running' | 'error'
  done: number
  total: number
  bytes: number
  error: string | null
}

/** What the host does with the files. */
export interface OfflineBackend {
  list(): Promise<OfflineEntry[]>
  /** starts the download in the background: progress comes through `onProgress` */
  start(job: { id: number; pages: number; file: boolean; width: number; meta: ItemDetail }): Promise<void>
  /** stops a download going on (and deletes what it got), or deletes a finished one */
  remove(id: number): Promise<void>
  /** a URL the web view fetches without credentials: part is 'cover', 'file' or 'p/<n>' */
  url(id: number, part: string): string
  onProgress(handler: (p: OfflineProgress) => void): void
  /** where the files are, to show it */
  where?(): Promise<string>
}

export const OFFLINE_WIDTHS = [1200, 1600, 2000, 2560]
const WIDTH_KEY = 'estanteria.offline.width'
const PENDING_KEY = 'estanteria.offline.pending'
const KNOWN_KEY = 'estanteria.offline.progress'
const MARKS_KEY = 'estanteria.offline.marks'
const KNOWN_MARKS_KEY = 'estanteria.offline.bookmarks'

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch (_) { return fallback }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* storage full or off: only this session */ }
}

function refused(message: string): Error {
  const err: any = new Error(message)
  err.status = 409
  return err
}

/** A book is kept as its file; anything else as its pages. */
export function keptAsFile(item: Item): boolean {
  return item.kind === 'book'
}

type Pending = { clear?: boolean; body?: Record<string, unknown>; at: number }

/** Bookmarks, notes and highlights made or changed while the service does not answer. One made offline
 * has a temporary id below 0 until it is sent; a change to it changes what will be sent. */
interface Marks {
  next: number
  creates: Record<number, { item: number; body: Record<string, any>; mark: Bookmark; at: number }>
  /** a change to a bookmark the service has (null: delete it) */
  changes: Record<number, { item: number; change: Record<string, any> | null; at: number }>
  /** temporary id → the one the service gave it, for the views that still hold the temporary one */
  resolved: Record<number, number>
}

export class Offline implements ApiOffline {
  readonly state = reactive({
    loaded: false,
    /** false while the service does not answer */
    online: true,
    entries: {} as Record<number, OfflineEntry>,
    jobs: {} as Record<number, OfflineJob>,
    width: Number(read(WIDTH_KEY, 1600)) || 1600,
  })
  private order: number[] = []
  private running = false
  private flushing = false
  private pending: Record<number, Pending> = read(PENDING_KEY, {})
  private known: Record<number, Progress> = read(KNOWN_KEY, {})
  private marks: Marks = { next: -1, creates: {}, changes: {}, resolved: {}, ...read<Partial<Marks>>(MARKS_KEY, {}) }
  private knownMarks: Record<number, Bookmark[]> = read(KNOWN_MARKS_KEY, {})
  private api: Api | null = null
  /** the files of this device (the desktop), shown with the library */
  shelf: LocalShelf | null = null

  private backend: OfflineBackend

  constructor(backend: OfflineBackend) {
    this.backend = backend
    backend.onProgress((p) => this.progressed(p))
  }

  /** The API it works for (to fetch what to download and to send progress made offline). */
  attach(api: Api): void {
    this.api = api
    api.offline = this
  }

  async load(): Promise<void> {
    try {
      const entries = await this.backend.list()
      const next: Record<number, OfflineEntry> = {}
      for (const e of entries) if (e?.item?.id) next[e.item.id] = e
      this.state.entries = next
    } catch (err) { console.warn('offline list', err) }
    this.state.loaded = true
  }

  setWidth(width: number): void {
    this.state.width = width
    write(WIDTH_KEY, width)
  }

  has(id: number): boolean { return !!this.state.entries[id] }
  /** 'done', 'running', 'waiting', 'error' or '' (not kept). */
  status(id: number): string { return this.state.entries[id] ? 'done' : this.state.jobs[id]?.state || '' }
  get count(): number { return Object.keys(this.state.entries).length }
  get bytes(): number { return Object.values(this.state.entries).reduce((sum, e) => sum + (e.bytes || 0), 0) }
  where(): Promise<string> { return this.backend.where ? this.backend.where() : Promise.resolve('') }

  /** Puts items in the queue (those already kept or queued are left as they are); how many went in. */
  add(items: Item[]): number {
    let added = 0
    for (const item of items) {
      if (this.state.entries[item.id] || (this.state.jobs[item.id] && this.state.jobs[item.id].state !== 'error')) continue
      if (item.format === 'folder' && !item.pages) continue
      this.state.jobs[item.id] = { id: item.id, title: item.series && item.number !== null ? `${item.series} ${item.number}` : item.title,
                                   state: 'waiting', done: 0, total: item.pages || 1, bytes: 0, error: null }
      this.order.push(item.id)
      added += 1
    }
    this.pump()
    return added
  }

  /** Stops (and forgets) a download, or deletes a kept item. */
  async remove(id: number): Promise<void> {
    const job = this.state.jobs[id]
    this.order = this.order.filter((x) => x !== id)
    if (job && job.state !== 'running') delete this.state.jobs[id]
    await this.backend.remove(id)
    delete this.state.entries[id]
  }

  async removeAll(ids: number[]): Promise<void> {
    for (const id of ids) await this.remove(id)
  }

  private async pump(): Promise<void> {
    if (this.running || !this.api) return
    const id = this.order.shift()
    if (id === undefined) return
    const job = this.state.jobs[id]
    if (!job) return this.pump()
    this.running = true
    job.state = 'running'
    try {
      const item = await this.api.item(id)        // also makes the service open it, if it had not
      if (item.state !== 'ready') throw new Error(item.state === 'error' ? item.error || 'no se puede abrir' : 'aún se está abriendo; prueba en un momento')
      job.total = keptAsFile(item) ? 1 : item.pages
      await this.backend.start({ id, pages: keptAsFile(item) ? 0 : item.pages, file: keptAsFile(item), width: this.state.width, meta: item })
      // the backend tells when it is done (progressed)
    } catch (err: any) {
      job.state = 'error'
      job.error = err?.message || String(err)
      this.running = false
      this.pump()
    }
  }

  private progressed(p: OfflineProgress): void {
    const job = this.state.jobs[p.id]
    if (p.cancelled) {
      delete this.state.jobs[p.id]
      this.running = false
      this.pump()
      return
    }
    if (job) {
      job.done = p.done
      job.total = p.total || job.total
      job.bytes = p.bytes
    }
    if (p.error) {
      if (job) { job.state = 'error'; job.error = p.error }
      this.running = false
      this.pump()
    } else if (p.finished) {
      delete this.state.jobs[p.id]
      this.running = false
      this.load().then(() => this.pump())
    }
  }

  // ---- for the API (ApiOffline) ----
  private match(path: string): [number, string] | null {
    const m = path.match(/^\/api\/items\/(\d+)\/(cover|file|pages\/(\d+))/)
    return m ? [Number(m[1]), m[3] !== undefined ? `p/${m[3]}` : m[2]] : null
  }

  local(path: string): string | null {
    const found = this.match(path)
    if (!found) return null
    const [id, part] = found
    if (isLocal(id) && this.shelf?.has(id)) {
      const w = path.match(/[?&]w=(\d+)/)
      return this.shelf.url(id, part === 'cover' ? 'c' : part === 'file' ? 'f' : part) + (w && part.startsWith('p/') ? `?w=${w[1]}` : '')
    }
    const entry = this.state.entries[id]
    if (!entry) return null
    if (part === 'file' && !keptAsFile(entry.item)) return null
    return this.backend.url(id, part)
  }

  private withProgress<T extends Item>(item: T): T {
    const known = this.known[item.id]
    return known === undefined ? item : { ...item, progress: known }
  }

  /** The bookmarks of an item as this device knows them: the service's last answer plus what was made offline. */
  private marksOf(id: number): Bookmark[] {
    const out: Bookmark[] = []
    for (const b of this.marksBase(id)) {
      const c = this.marks.changes[b.id]
      if (c && c.change === null) continue
      out.push(c ? { ...b, ...c.change, updated: c.at } : b)
    }
    for (const c of Object.values(this.marks.creates)) if (c.item === id) out.push(c.mark)
    return out.sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || a.created - b.created)
  }

  private marksBase(id: number): Bookmark[] {
    return this.knownMarks[id] ?? this.state.entries[id]?.item.bookmarks ?? []
  }

  private hasMarks(id: number): boolean {
    return Object.values(this.marks.creates).some((c) => c.item === id) || Object.values(this.marks.changes).some((c) => c.item === id)
  }

  private marksPending(): boolean {
    return !!(Object.keys(this.marks.creates).length || Object.keys(this.marks.changes).length)
  }

  /** The id the service gave a bookmark made offline (or the same id). */
  bookmarkId(id: number): number {
    return id < 0 ? this.marks.resolved[id] ?? id : id
  }

  private items(): ItemDetail[] {
    return Object.values(this.state.entries).map((e) => this.withProgress(e.item))
  }

  fallback(path: string): unknown {
    if (!this.count && !this.shelf?.count) return undefined
    const [base, qs] = path.split('?')
    const params = new URLSearchParams(qs || '')
    const all = this.items()
    if (base === '/api/cloud') return { connected: true, username: '' }
    if (base === '/api/library') {
      const counts = { total: all.length, pending: 0, errors: 0 }
      return { connected: true, username: '', scanned: null, scan_error: null, ...counts, folders: [], archivador: counts, sources: [] }
    }
    if (base === '/api/series') return this.series(all)
    if (base === '/api/continue') {
      return all.filter((i) => i.progress && !i.progress.finished && i.progress.percent > 0)
        .sort((a, b) => (b.progress!.updated || 0) - (a.progress!.updated || 0)).slice(0, Number(params.get('limit') || 20))
    }
    if (base === '/api/recent') {
      return Object.values(this.state.entries).sort((a, b) => b.added - a.added).slice(0, Number(params.get('limit') || 20)).map((e) => this.withProgress(e.item))
    }
    if (base === '/api/items') return this.filter(all, params)
    const one = base.match(/^\/api\/items\/(\d+)$/)
    if (one) {
      const entry = this.state.entries[Number(one[1])]
      return entry ? { ...this.withProgress(entry.item), bookmarks: this.marksOf(entry.item.id) } : undefined
    }
    if (base === '/api/sources' || base === '/api/catalogs' || base === '/api/sources/kinds') return []
    return undefined
  }

  private filter(all: ItemDetail[], params: URLSearchParams): ItemDetail[] {
    const q = (params.get('q') || '').toLowerCase()
    const source = params.get('source')
    let out = all.filter((i) =>
      (!q || [i.title, i.series, i.author, i.name].some((t) => (t || '').toLowerCase().includes(q))) &&
      (!params.get('series') || i.series === params.get('series')) &&
      (!params.get('kind') || i.kind === params.get('kind')) &&
      (!source || (source === 'archivador' ? !i.source_id : source === 'external' ? !!i.source_id : String(i.source_id) === source)))
    const sort = params.get('sort') || 'series'
    const text = (s: string | null) => (s || '').toLocaleLowerCase()
    out = out.sort((a, b) => sort === 'title' ? text(a.title).localeCompare(text(b.title))
      : sort === 'added' ? b.added - a.added : sort === 'modified' ? b.modified - a.modified
      : (text(a.series) || '￿').localeCompare(text(b.series) || '￿') || (a.number ?? 0) - (b.number ?? 0) || text(a.title).localeCompare(text(b.title)))
    const offset = Number(params.get('offset') || 0)
    return out.slice(offset, offset + Number(params.get('limit') || 200))
  }

  private series(all: ItemDetail[]): Series[] {
    const by = new Map<string, ItemDetail[]>()
    for (const i of all) if (i.series) by.set(i.series, [...(by.get(i.series) || []), i])
    return [...by.entries()].map(([series, items]) => {
      const first = [...items].sort((a, b) => (a.number ?? 0) - (b.number ?? 0))[0]
      return { series, items: items.length, finished: items.filter((i) => i.progress?.finished).length, cover_item: first.id, cover: first.cover,
               modified: Math.max(...items.map((i) => i.modified)), added: Math.max(...items.map((i) => i.added)),
               last_read: Math.max(0, ...items.map((i) => i.progress?.updated || 0)) || null }
    }).sort((a, b) => a.series.localeCompare(b.series))
  }

  /** What only this device can answer, with or without connection: the files of this device. */
  own(method: string, path: string, body: unknown): unknown {
    const now = Date.now() / 1000
    const b = (body || {}) as Record<string, any>
    const base = path.split('?')[0]
    const params = new URLSearchParams(path.split('?')[1] || '')
    if (base === '/api/items' && method === 'GET' && isLocalSource(params.get('source'))) {
      return this.shelf ? this.shelf.query(queryOf(params), (i) => this.withProgress(i)) : []
    }
    const m = base.match(/^\/api\/items\/(\d+)(\/.*)?$/)
    if (m && isLocal(Number(m[1]))) {
      const id = Number(m[1])
      const rest = m[2] || ''
      if (!this.shelf?.has(id)) throw Object.assign(refused('Ese archivo ya no está en tu PC (¿se movió o se borró?).'), { status: 404 })
      if (!rest && method === 'GET') return this.shelf.detail(id).then((d) => ({ ...this.withProgress(d), bookmarks: this.marksOf(id) }))
      if (rest === '/progress' && method === 'DELETE') {
        delete this.known[id]
        this.save()
        return { ok: true }
      }
      if (rest === '/progress' && method === 'PUT') {
        const progress: Progress = { page: b.page ?? null, location: b.location ?? null, percent: b.percent ?? 0, finished: !!b.finished,
                                     device: b.device ?? null, updated: now }
        this.known[id] = progress
        this.save()
        return progress
      }
      if (rest === '/bookmarks' && method === 'POST') {
        const made: Bookmark = { id: this.marks.next, kind: b.kind || 'bookmark', page: b.page ?? null, location: b.location ?? null,
                                 excerpt: b.excerpt || '', note: b.note || '', created: now, updated: null }
        this.marks.next -= 1
        this.knownMarks[id] = [...this.marksBase(id), made]
        this.saveMarks()
        write(KNOWN_MARKS_KEY, this.knownMarks)
        return made
      }
      const one = rest.match(/^\/bookmarks\/(-?\d+)$/)
      if (one && method === 'PUT') {
        const was = this.marksBase(id).find((x) => x.id === Number(one[1]))
        if (!was) throw refused('Esa nota ya no está.')
        const changed = { ...was, ...b, updated: now }
        this.knownMarks[id] = this.marksBase(id).map((x) => (x.id === was.id ? changed : x))
        write(KNOWN_MARKS_KEY, this.knownMarks)
        return changed
      }
      throw refused('Esto solo se puede con lo que está en El Archivador; este es un archivo de este PC.')
    }
    const gone = base.match(/^\/api\/bookmarks\/(-?\d+)$/)
    if (gone && method === 'DELETE') {
      const bid = Number(gone[1])
      const owner = Object.keys(this.knownMarks).map(Number).find((i) => isLocal(i) && this.knownMarks[i].some((x) => x.id === bid))
      if (owner === undefined) return undefined
      this.knownMarks[owner] = this.knownMarks[owner].filter((x) => x.id !== bid)
      write(KNOWN_MARKS_KEY, this.knownMarks)
      return { ok: true }
    }
    return undefined
  }

  /** The service's answer (or the one kept for it) with the files of this device added: its libraries
   * and folders, its series, what is being read of it, and what a search finds in it. */
  merge(method: string, path: string, data: unknown): unknown {
    const shelf = this.shelf
    if (!shelf || method !== 'GET' || !shelf.count) return data
    const [base, qs] = path.split('?')
    const params = new URLSearchParams(qs || '')
    const progress = (i: Item) => this.withProgress(i)
    if (base === '/api/library' && data && typeof data === 'object') {
      const status = data as LibraryStatus
      const local: Record<string, string[]> = {}
      for (const s of shelf.sources()) local[String(s.id)] = shelf.folders(s.id)
      return { ...status, total: status.total + shelf.count, sources: [...(status.sources || []), ...shelf.sources()], local_folders: local }
    }
    if (base === '/api/series' && Array.isArray(data)) {
      const out = new Map<string, Series>((data as Series[]).map((s) => [s.series, { ...s }]))
      for (const s of shelf.series(progress)) {
        const there = out.get(s.series)
        if (!there) out.set(s.series, s)
        else Object.assign(there, { items: there.items + s.items, finished: there.finished + s.finished,
                                    last_read: Math.max(there.last_read || 0, s.last_read || 0) || null })
      }
      return [...out.values()].sort((a, b) => a.series.localeCompare(b.series, 'es'))
    }
    if (base === '/api/continue' && Array.isArray(data)) {
      const reading = shelf.all().map(progress).filter((i) => i.progress && !i.progress.finished && i.progress.percent > 0)
      return [...(data as Item[]), ...reading].sort((a, b) => (b.progress?.updated || 0) - (a.progress?.updated || 0))
        .slice(0, Number(params.get('limit') || 20))
    }
    if (base === '/api/items' && Array.isArray(data)) {
      const source = params.get('source')
      // the Archivador's folders, the outside libraries: theirs alone; everything else, the shelf too (on the first page)
      if (source || params.has('folder') || Number(params.get('offset') || 0) > 0) return data
      return [...(data as Item[]), ...shelf.query(queryOf(params), progress)]
    }
    return data
  }

  /** A change made while the service does not answer: kept to send later, answered from here. */
  write(method: string, path: string, body: unknown): unknown {
    const mark = this.writeMark(method, path, (body || {}) as Record<string, any>)
    if (mark !== undefined) return mark
    const m = path.match(/^\/api\/items\/(\d+)\/progress$/)
    if (!m || this.flushing) return undefined        // while sending what was kept, a failure is a failure
    const id = Number(m[1])
    const now = Date.now() / 1000
    if (method === 'DELETE') {
      this.pending[id] = { clear: true, at: now }
      delete this.known[id]
      this.save()
      return { ok: true }
    }
    if (method !== 'PUT') return undefined
    const b = (body || {}) as Record<string, any>
    const progress: Progress = { page: b.page ?? null, location: b.location ?? null, percent: b.percent ?? 0, finished: !!b.finished,
                                 device: b.device ?? null, updated: now }
    this.pending[id] = { body: b, at: now }
    this.known[id] = progress
    this.save()
    return progress
  }

  private writeMark(method: string, path: string, body: Record<string, any>): unknown {
    const now = Date.now() / 1000
    const add = path.match(/^\/api\/items\/(\d+)\/bookmarks$/)
    const change = path.match(/^\/api\/items\/(\d+)\/bookmarks\/(-?\d+)$/)
    const remove = path.match(/^\/api\/bookmarks\/(-?\d+)$/)
    const id = change ? Number(change[2]) : remove ? Number(remove[1]) : NaN
    // while sending, only what was made offline can still change here (anything else is a real failure)
    if (this.flushing && !(id < 0)) return undefined
    if (add && method === 'POST') {
      const item = Number(add[1])
      const temp = this.marks.next
      this.marks.next -= 1
      const made: Bookmark = { id: temp, kind: body.kind || 'bookmark', page: body.page ?? null, location: body.location ?? null,
                               excerpt: body.excerpt || '', note: body.note || '', created: now, updated: null }
      this.marks.creates[temp] = { item, body: { ...body }, mark: made, at: now }
      this.saveMarks()
      return made
    }
    if (change && method === 'PUT') {
      const item = Number(change[1])
      const created = this.marks.creates[id]
      if (created) {
        Object.assign(created.body, body)
        created.mark = { ...created.mark, ...body, updated: now }
        this.saveMarks()
        return created.mark
      }
      if (id < 0) return undefined
      const was = this.marksOf(item).find((b) => b.id === id)
      if (!was) return undefined
      this.marks.changes[id] = { item, change: { ...(this.marks.changes[id]?.change || {}), ...body }, at: now }
      this.saveMarks()
      return { ...was, ...body, updated: now }
    }
    if (remove && method === 'DELETE') {
      if (this.marks.creates[id]) delete this.marks.creates[id]
      else if (id < 0) return { ok: true }
      else {
        const owner = Object.keys(this.state.entries).map(Number).find((i) => this.marksBase(i).some((b) => b.id === id)) ?? -1
        this.marks.changes[id] = { item: owner, change: null, at: now }
      }
      this.saveMarks()
      return { ok: true }
    }
    return undefined
  }

  /** What the service answered, to remember the progress of kept items for when it does not. */
  seen(method: string, path: string, data: unknown): void {
    const base = path.split('?')[0]
    let changed = false
    const remember = (item: any) => {
      if (item && typeof item.id === 'number' && this.state.entries[item.id] && item.progress !== undefined && !this.pending[item.id]) {
        if (item.progress) this.known[item.id] = item.progress
        else delete this.known[item.id]
        changed = true
      }
    }
    if (method === 'GET' && Array.isArray(data)) data.forEach(remember)
    else if (method === 'GET' && /^\/api\/items\/\d+$/.test(base)) {
      remember(data)
      const item = data as ItemDetail
      if (item && this.state.entries[item.id] && Array.isArray(item.bookmarks) && !this.hasMarks(item.id)) {
        this.knownMarks[item.id] = item.bookmarks
        write(KNOWN_MARKS_KEY, this.knownMarks)
      }
    } else if (/^\/api\/(items\/\d+\/)?bookmarks(\/\d+)?$/.test(base)) this.seenMark(method, base, data as Bookmark)
    else if (method === 'PUT' && /^\/api\/items\/\d+\/progress$/.test(base)) {
      const id = Number(base.split('/')[3])
      if (this.state.entries[id]) { this.known[id] = data as Progress; changed = true }
    }
    if (changed) write(KNOWN_KEY, this.known)
  }

  private seenMark(method: string, base: string, data: Bookmark): void {
    const parts = base.split('/')
    const item = parts[2] === 'items' ? Number(parts[3]) : -1
    let changed = false
    if (method === 'POST' && this.state.entries[item]) {
      this.knownMarks[item] = [...this.marksBase(item).filter((b) => b.id !== data.id), data]
      changed = true
    } else if (method === 'PUT' && this.state.entries[item]) {
      this.knownMarks[item] = this.marksBase(item).map((b) => (b.id === data.id ? data : b))
      changed = true
    } else if (method === 'DELETE') {
      const gone = Number(parts[parts.length - 1])
      for (const key of Object.keys(this.state.entries).map(Number)) {
        const list = this.marksBase(key)
        if (list.some((b) => b.id === gone)) { this.knownMarks[key] = list.filter((b) => b.id !== gone); changed = true }
      }
    }
    if (changed) write(KNOWN_MARKS_KEY, this.knownMarks)
  }

  /** The service answers (`true`) or not; when it comes back, what was read offline is sent. */
  online(ok: boolean): void {
    const was = this.state.online
    this.state.online = ok
    if (ok && (!was || Object.keys(this.pending).length || this.marksPending())) this.flush()
  }

  async flush(): Promise<void> {
    if (this.flushing || !this.api || (!Object.keys(this.pending).length && !this.marksPending())) return
    this.flushing = true
    try {
      if (!(await this.flushMarks())) return
      for (const [key, p] of Object.entries(this.pending)) {
        const id = Number(key)
        try {
          if (p.clear) await this.api.clearProgress(id)
          else await this.api.setProgress(id, p.body as any)
          if (this.pending[id]?.at === p.at) delete this.pending[id]
        } catch (err: any) {
          if (err?.offline) break                   // still without connection: next time
          if (err?.status === 404) delete this.pending[id]
        }
      }
      this.save()
    } finally { this.flushing = false }
  }

  /** Sends the bookmarks made offline, then the changes; false if the service went away again. */
  private async flushMarks(): Promise<boolean> {
    const api = this.api!
    try {
      for (const [key, c] of Object.entries(this.marks.creates).sort((a, b) => a[1].at - b[1].at)) {
        const temp = Number(key)
        try {
          this.marks.resolved[temp] = (await api.addBookmark(c.item, c.body)).id
        } catch (err: any) {
          if (err?.offline) throw err
          // the item is gone (404) or the service will not take it: nothing left to send
        }
        delete this.marks.creates[temp]
        this.saveMarks()
      }
      for (const [key, c] of Object.entries(this.marks.changes)) {
        const id = Number(key)
        try {
          if (c.change === null) await api.deleteBookmark(id)
          else await api.changeBookmark(c.item, id, c.change)
        } catch (err: any) {
          if (err?.offline) throw err
        }
        if (this.marks.changes[id]?.at === c.at) delete this.marks.changes[id]
        this.saveMarks()
      }
      return true
    } catch (_) {
      this.saveMarks()
      return false
    }
  }

  private saveMarks(): void {
    // temporary ids are only needed while a view may still hold them: keep the newest (the lowest)
    const resolved = Object.entries(this.marks.resolved)
    if (resolved.length > 200) this.marks.resolved = Object.fromEntries(resolved.sort((a, b) => Number(a[0]) - Number(b[0])).slice(0, 200))
    write(MARKS_KEY, this.marks)
  }

  private save(): void {
    write(PENDING_KEY, this.pending)
    write(KNOWN_KEY, this.known)
  }
}

function queryOf(params: URLSearchParams) {
  const get = (k: string) => params.get(k) ?? undefined
  return { q: get('q'), series: get('series'), kind: get('kind') as any, sort: get('sort') as any, source: get('source'),
           folder: params.has('folder') ? params.get('folder')! : undefined, direct: params.get('direct') === 'true',
           limit: params.has('limit') ? Number(params.get('limit')) : undefined, offset: params.has('offset') ? Number(params.get('offset')) : undefined }
}
