/** La Estantería's API (see service/app.py). The host says how each call is authorised: the OpenCloud web
 * app with its session's bearer token, the desktop and Android apps with HTTP basic (user + app token). */

export type Kind = 'comic' | 'pdf' | 'book'
export type Format = 'cbz' | 'cbr' | 'cb7' | 'folder' | 'pdf' | 'epub' | 'mobi' | 'fb2'
export type Direction = 'ltr' | 'rtl'

export interface Progress {
  page: number | null
  /** a book: where in the text (EPUB CFI) */
  location: string | null
  percent: number
  finished: boolean
  device: string | null
  updated: number
}

export interface Item {
  id: number
  /** null: the user's own Archivador; else one of their outside libraries */
  source_id: number | null
  path: string
  folder: string
  name: string
  format: Format
  kind: Kind
  size: number
  modified: number
  title: string
  series: string | null
  number: number | null
  author: string | null
  year: number | null
  summary: string | null
  pages: number
  direction: Direction
  cover: boolean
  state: 'listed' | 'ready' | 'error'
  error: string | null
  added: number
  updated: number
  meta: Record<string, unknown>
  progress: Progress | null
}

export type BookmarkKind = 'bookmark' | 'note' | 'highlight'

export interface Bookmark {
  id: number
  /** a bookmark (a page or a point), a note (on a page or a passage) or a highlight (a passage) */
  kind: BookmarkKind
  page: number | null
  /** a book: an EPUB CFI (a point) or a CFI range (a passage) */
  location: string | null
  /** the passage's text, or the chapter's name */
  excerpt: string
  note: string
  created: number
  updated: number | null
}

export interface ItemDetail extends Item {
  /** [width, height] of every page, to plan double pages before loading them (empty when unknown) */
  page_sizes: [number, number][]
  bookmarks: Bookmark[]
}

export interface Series {
  series: string
  items: number
  finished: number
  cover_item: number
  cover: boolean
  modified: number
  added: number
  last_read: number | null
}

export type SourceKind = 'komga' | 'kavita' | 'opds' | 'opds2' | 'audiobookshelf' | 'suwayomi' | 'webdav' | 'local'

export interface Source {
  id: number
  kind: SourceKind | CatalogKind
  /** true: what the user kept from a public catalogue (not a server of their own) */
  catalog: boolean
  label: string
  name: string
  url: string
  username: string
  config: Record<string, unknown>
  enabled: boolean
  scanned: number | null
  scan_error: string | null
  info: { name?: string; version?: string }
  items: number
  supports_progress: boolean
  created: number
  updated: number
}

export interface SourceKindInfo {
  kind: SourceKind
  label: string
  fields: ('url' | 'username' | 'secret')[]
  secret_label: string
  supports_progress: boolean
}

/** A public catalogue (Project Gutenberg, the Internet Archive, MangaDex): browsed, never indexed. */
export type CatalogKind = 'gutenberg' | 'archive' | 'mangadex'

export interface Catalog {
  kind: CatalogKind
  label: string
  description: string
  home: string
  /** the source that holds what the user kept from it (null until they keep something) */
  source_id: number | null
  items: number
}

/** Somewhere to go inside a catalogue: a shelf, a search, a series (then it has a cover). */
export interface CatalogSection {
  title: string
  path: string
  subtitle: string | null
  /** a cover id for `catalogCoverPath`, or null */
  cover: string | null
  summary: string | null
}

/** Something to keep or read from a catalogue. */
export interface CatalogEntry {
  id: string
  title: string
  series: string | null
  number: number | null
  author: string | null
  year: number | null
  summary: string | null
  format: Format
  kind: Kind
  pages: number
  size: number
  cover: boolean
  language: string | null
  /** the item it already is on the user's shelf, or null */
  item: number | null
}

export interface CatalogListing {
  path: string
  title: string
  subtitle: string | null
  summary: string | null
  cover: string | null
  /** the path of the following page, when there is one */
  next: string | null
  sections: CatalogSection[]
  entries: CatalogEntry[]
}

export interface LibraryStatus {
  connected: boolean
  username: string
  scanned: number | null
  scan_error: string | null
  total: number
  pending: number
  errors: number
  folders: string[]
  archivador: { total: number; pending: number; errors: number }
  sources: Source[]
  /** the folders of each library of this device, by its source id (the desktop) */
  local_folders?: Record<string, string[]>
}

export interface ItemQuery {
  q?: string
  series?: string
  folder?: string
  kind?: Kind
  sort?: 'series' | 'title' | 'added' | 'modified'
  limit?: number
  offset?: number
  /** 'archivador', 'external' (every outside library and catalogue), or a source id */
  source?: string
  /** only what is right in `folder`, not in its subfolders */
  direct?: boolean
}

export interface ProgressUpdate {
  page?: number | null
  location?: string | null
  percent?: number
  finished?: boolean
  device?: string
}

/** What an app that keeps items for reading offline plugs into the API (see offline.ts). */
export interface ApiOffline {
  /** a URL of a kept image or file, fetched instead of the service's */
  local(path: string): string | null
  /** the answer to a GET when the service does not answer (undefined: none) */
  fallback(path: string): unknown
  /** a change made when the service does not answer, kept for later (undefined: cannot) */
  write(method: string, path: string, body: unknown): unknown
  /** what the service answered */
  seen(method: string, path: string, data: unknown): void
  /** whether the service answers */
  online(ok: boolean): void
  /** the id the service gave a bookmark made offline (temporary ids are below 0) */
  bookmarkId?(id: number): number
  /** the answer for what only this device has (the files of this device), with or without connection */
  own?(method: string, path: string, body: unknown): unknown
  /** the answer with what this device adds to it (its own files) */
  merge?(method: string, path: string, data: unknown): unknown
}

/** Answers that mean the service is not there (the proxy in front answers instead). */
const UNREACHABLE = new Set([502, 503, 504, 520, 521, 522, 523, 524, 530])

function unreachable(cause?: unknown): Error {
  const err: any = new Error('Sin conexión con La Estantería')
  err.offline = true
  err.status = 0
  err.cause = cause
  return err
}

export class Api {
  /** Set by an app that keeps items for reading offline. */
  offline?: ApiOffline

  /** `authorization`: the Authorization header to send; `mintAppToken`: how to get an app token of the
   * user for the indexer (only the OpenCloud web app can; the others already hold one). */
  readonly baseUrl: string
  private authorization: () => string
  private mintAppToken?: () => Promise<string>

  constructor(baseUrl: string, authorization: () => string, mintAppToken?: () => Promise<string>) {
    this.baseUrl = baseUrl
    this.authorization = authorization
    this.mintAppToken = mintAppToken
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: this.authorization(), ...extra }
  }

  /** Without the service: the answer kept for it, if there is one. */
  private withoutService<T>(path: string, init: RequestInit, cause: unknown): T {
    this.offline?.online(false)
    const method = (init.method || 'GET').toUpperCase()
    const kept = !this.offline ? undefined
      : method === 'GET' ? this.offline.fallback(path)
      : this.offline.write(method, path, init.body ? JSON.parse(String(init.body)) : undefined)
    if (kept !== undefined) return (this.offline?.merge ? this.offline.merge(method, path, kept) : kept) as T
    throw unreachable(cause)
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const mine = this.offline?.own?.((init.method || 'GET').toUpperCase(), path, init.body ? JSON.parse(String(init.body)) : undefined)
    if (mine !== undefined) return mine as T
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, { ...init, headers: this.headers({ 'Content-Type': 'application/json', ...((init.headers as any) || {}) }) })
    } catch (err) {
      return this.withoutService<T>(path, init, err)
    }
    if (UNREACHABLE.has(res.status)) return this.withoutService<T>(path, init, res.status)
    this.offline?.online(true)
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
      const err: any = new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : res.statusText)
      err.status = res.status
      throw err
    }
    const data = await res.json()
    const method = (init.method || 'GET').toUpperCase()
    this.offline?.seen(method, path, data)
    return (this.offline?.merge ? this.offline.merge(method, path, data) : data) as T
  }

  /** A binary answer (a page, a cover, a book): the copy kept on this device if there is one, else
   * fetched with the session's credential. */
  async blob(path: string, signal?: AbortSignal): Promise<Blob> {
    const local = this.offline?.local(path)
    if (local) {
      try {
        const kept = await fetch(local, { signal })
        if (kept.ok) return kept.blob()
      } catch (err) { if ((err as any)?.name === 'AbortError') throw err }
    }
    let res: Response
    try {
      res = await fetch(this.baseUrl + path, { headers: this.headers(), signal })
    } catch (err) {
      if ((err as any)?.name === 'AbortError') throw err
      this.offline?.online(false)
      throw unreachable(err)
    }
    if (UNREACHABLE.has(res.status)) { this.offline?.online(false); throw unreachable(res.status) }
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
      const err: any = new Error(typeof detail === 'string' ? detail : res.statusText)
      err.status = res.status
      throw err
    }
    return res.blob()
  }

  /** Makes sure the service holds an app token of this user (so its indexer can work alone): mints
   * one in OpenCloud the first time, when the host can; else just checks the credential works. */
  async ensureConnected(): Promise<void> {
    const status = await this.call<{ connected: boolean }>('/api/cloud')
    if (status.connected || !this.mintAppToken) return
    const token = await this.mintAppToken()
    await this.call('/api/cloud/connect', { method: 'POST', body: JSON.stringify({ token }) })
  }

  /** The credential the host gives, as the service wants it. */
  static bearer(token: string): string { return `Bearer ${token}` }
  static basic(username: string, password: string): string {
    return 'Basic ' + btoa(unescape(encodeURIComponent(`${username}:${password}`)))
  }

  library() { return this.call<LibraryStatus>('/api/library') }
  scan() { return this.call<LibraryStatus & { files: number; new: number; changed: number; removed: number }>('/api/library/scan', { method: 'POST' }) }

  items(query: ItemQuery = {}) {
    const params = new URLSearchParams()
    // an empty folder is the top of Lectura, so it travels; any other empty value means «no filter»
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && (v !== '' || k === 'folder')) params.set(k, String(v))
    const qs = params.toString()
    return this.call<Item[]>(`/api/items${qs ? `?${qs}` : ''}`)
  }
  series() { return this.call<Series[]>('/api/series') }
  continueReading(limit = 20) { return this.call<Item[]>(`/api/continue?limit=${limit}`) }
  recent(limit = 20) { return this.call<Item[]>(`/api/recent?limit=${limit}`) }
  item(id: number) { return this.call<ItemDetail>(`/api/items/${id}`) }

  coverPath(id: number) { return `/api/items/${id}/cover` }
  pagePath(id: number, n: number, width?: number) { return `/api/items/${id}/pages/${n}${width ? `?w=${width}` : ''}` }
  filePath(id: number) { return `/api/items/${id}/file` }

  setProgress(id: number, update: ProgressUpdate) {
    return this.call<Progress>(`/api/items/${id}/progress`, { method: 'PUT', body: JSON.stringify(update) })
  }
  clearProgress(id: number) { return this.call<{ ok: boolean }>(`/api/items/${id}/progress`, { method: 'DELETE' }) }
  addBookmark(id: number, bookmark: { kind?: BookmarkKind; page?: number | null; location?: string | null; excerpt?: string; note?: string }) {
    return this.call<Bookmark>(`/api/items/${id}/bookmarks`, { method: 'POST', body: JSON.stringify(bookmark) })
  }
  changeBookmark(id: number, bookmarkId: number, change: { kind?: BookmarkKind; note?: string }) {
    const path = `/api/items/${id}/bookmarks/${this.bookmarkId(bookmarkId)}`
    return this.markCall<Bookmark>(path, { method: 'PUT', body: JSON.stringify(change) })
  }
  deleteBookmark(bookmarkId: number) {
    return this.markCall<{ ok: boolean }>(`/api/bookmarks/${this.bookmarkId(bookmarkId)}`, { method: 'DELETE' })
  }

  /** A bookmark made offline keeps a temporary id (below 0) until it is sent: the one the service gave it. */
  private bookmarkId(id: number): number { return this.offline?.bookmarkId ? this.offline.bookmarkId(id) : id }

  /** A change to a bookmark not sent yet stays on this device (it changes what will be sent). */
  private async markCall<T>(path: string, init: RequestInit): Promise<T> {
    const mine = this.offline?.own?.(String(init.method), path, init.body ? JSON.parse(String(init.body)) : undefined)
    if (mine !== undefined) return mine as T
    if (/\/-\d+$/.test(path) && this.offline) {
      const kept = this.offline.write(String(init.method), path, init.body ? JSON.parse(String(init.body)) : undefined)
      if (kept !== undefined) return Promise.resolve(kept as T)
    }
    return this.call<T>(path, init)
  }

  sourceKinds() { return this.call<SourceKindInfo[]>('/api/sources/kinds') }
  sources() { return this.call<Source[]>('/api/sources') }
  addSource(source: { kind: SourceKind; name: string; url: string; username?: string; secret?: string; config?: Record<string, unknown> }) {
    return this.call<Source>('/api/sources', { method: 'POST', body: JSON.stringify(source) })
  }
  changeSource(id: number, change: { name?: string; url?: string; username?: string; secret?: string; config?: Record<string, unknown>; enabled?: boolean }) {
    return this.call<Source>(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(change) })
  }
  deleteSource(id: number) { return this.call<{ ok: boolean }>(`/api/sources/${id}`, { method: 'DELETE' }) }
  scanSource(id: number) { return this.call<{ files: number; new: number; changed: number; removed: number }>(`/api/sources/${id}/scan`, { method: 'POST' }) }

  // ---- public catalogues ----
  catalogs() { return this.call<Catalog[]>('/api/catalogs') }
  browseCatalog(kind: string, path = '') { return this.call<CatalogListing>(`/api/catalogs/${kind}?path=${encodeURIComponent(path)}`) }
  searchCatalog(kind: string, q: string, path = '') {
    return this.call<CatalogListing>(`/api/catalogs/${kind}/search?q=${encodeURIComponent(q)}&path=${encodeURIComponent(path)}`)
  }
  catalogCoverPath(kind: string, coverId: string) { return `/api/catalogs/${kind}/cover/${encodeURIComponent(coverId)}` }
  /** Keeps an entry on the shelf (it becomes an item) and, with 'archivador', copies its file to the cloud too. */
  keepEntry(kind: string, id: string, to: 'library' | 'archivador' = 'library') {
    return this.call<Item & { saved_to?: string }>(`/api/catalogs/${kind}/entries/${encodeURIComponent(id)}/save`, { method: 'POST', body: JSON.stringify({ to }) })
  }
  /** Keeps every entry of a listing (a series, a shelf, a search), page after page. */
  keepListing(kind: string, path: string, q = '') {
    return this.call<{ saved: number; source_id: number; complete: boolean }>(`/api/catalogs/${kind}/save-all`, { method: 'POST', body: JSON.stringify({ path, q }) })
  }
  /** Copies an item of an outside library or a catalogue into the reading folder of the cloud. */
  saveItem(id: number) { return this.call<{ path: string }>(`/api/items/${id}/save`, { method: 'POST' }) }
  /** Rebuilds a PDF with text as an EPUB, or lays a book out as a PDF, next to it (the new item comes back already listed). */
  convertToEpub(id: number) {
    return this.call<{ path: string; stats: { to: 'epub' | 'pdf'; chapters: number; pages?: number; paragraphs?: number; images?: number; title: string }; item: Item | null }>(
      `/api/items/${id}/convert`, { method: 'POST' })
  }
  /** Takes an entry kept from a catalogue off the shelf. */
  removeItem(id: number) { return this.call<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }) }
}
