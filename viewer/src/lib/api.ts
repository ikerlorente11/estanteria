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

export type SourceKind = 'komga' | 'kavita' | 'opds' | 'webdav'

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

export class Api {
  /** `authorization`: the Authorization header to send; `mintAppToken`: how to get an app token of the
   * user for the indexer (only the OpenCloud web app can; the others already hold one). */
  constructor(readonly baseUrl: string, private authorization: () => string, private mintAppToken?: () => Promise<string>) {}

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: this.authorization(), ...extra }
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(this.baseUrl + path, { ...init, headers: this.headers({ 'Content-Type': 'application/json', ...((init.headers as any) || {}) }) })
    if (!res.ok) {
      const detail = await res.json().then((b) => b.detail).catch(() => res.statusText)
      const err: any = new Error(typeof detail === 'string' ? detail : Array.isArray(detail) ? detail.map((d) => d.msg).join('; ') : res.statusText)
      err.status = res.status
      throw err
    }
    return res.json()
  }

  /** A binary answer (a page, a cover, a book) fetched with the session's credential. */
  async blob(path: string, signal?: AbortSignal): Promise<Blob> {
    const res = await fetch(this.baseUrl + path, { headers: this.headers(), signal })
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
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
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
    return this.call<Bookmark>(`/api/items/${id}/bookmarks/${bookmarkId}`, { method: 'PUT', body: JSON.stringify(change) })
  }
  deleteBookmark(bookmarkId: number) { return this.call<{ ok: boolean }>(`/api/bookmarks/${bookmarkId}`, { method: 'DELETE' }) }

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
  /** Takes an entry kept from a catalogue off the shelf. */
  removeItem(id: number) { return this.call<{ ok: boolean }>(`/api/items/${id}`, { method: 'DELETE' }) }
}
