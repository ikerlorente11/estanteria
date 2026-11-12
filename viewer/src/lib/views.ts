/** The pages of the app and how each is written in the route's query (pure, for tests too). */

export type View =
  | { v: 'home' }
  | { v: 'library'; q?: string; kind?: string; sort?: string; folder?: string; source?: string }
  | { v: 'series'; name: string }
  | { v: 'read'; id: number; page?: number; as?: 'doc' | 'pages' }
  | { v: 'item'; id: number }
  | { v: 'sources'; add?: boolean }
  | { v: 'catalogs' }
  | { v: 'downloads' }
  /** what was marked with the star */
  | { v: 'favorites' }
  | { v: 'catalog'; kind: string; path?: string; q?: string }
  /** a chapter of a catalog read page by page, without downloading it */
  | { v: 'chapter'; catalog: string; chapter: string; title?: string }
  /** the extensions of a Suwayomi library */
  | { v: 'extensions'; library: string }

/** The view a route's query stands for (the app keeps its place in the URL). */
export function viewFromQuery(query: Record<string, unknown>): View {
  const v = String(query.v || 'home')
  const id = Number(query.id)
  if (v === 'catalogs' || v === 'downloads' || v === 'favorites') return { v }
  if (v === 'catalog' && query.kind) {
    const view: View = { v, kind: String(query.kind) }
    if (query.path) view.path = String(query.path)
    if (query.q) view.q = String(query.q)
    return view
  }
  if (v === 'library') {
    const view: View = { v }
    if (query.q) view.q = String(query.q)
    if (query.kind) view.kind = String(query.kind)
    if (query.sort) view.sort = String(query.sort)
    if (query.folder !== undefined && query.folder !== null) view.folder = String(query.folder)
    if (query.source) view.source = String(query.source)
    return view
  }
  if (v === 'series' && query.name) return { v, name: String(query.name) }
  if (v === 'read' && id > 0) {
    const page = Number(query.page)
    const view: View = page >= 0 && query.page !== undefined ? { v, id, page } : { v, id }
    if (query.as === 'doc' || query.as === 'pages') view.as = query.as
    return view
  }
  if (v === 'item' && id > 0) return { v, id }
  if (v === 'extensions' && query.library) return { v, library: String(query.library) }
  if (v === 'chapter' && query.catalog && query.chapter) {
    const view: View = { v, catalog: String(query.catalog), chapter: String(query.chapter) }
    if (query.title) view.title = String(query.title)
    return view
  }
  if (v === 'sources') return query.add ? { v, add: true } : { v }
  return { v: 'home' }
}

export function queryFromView(view: View): Record<string, string> {
  if (view.v === 'home') return {}
  if (view.v === 'library') {
    const q: Record<string, string> = { v: 'library' }
    if (view.q) q.q = view.q
    if (view.kind) q.kind = view.kind
    if (view.sort) q.sort = view.sort
    if (view.folder !== undefined) q.folder = view.folder
    if (view.source) q.source = view.source
    return q
  }
  if (view.v === 'series') return { v: 'series', name: view.name }
  if (view.v === 'read') {
    const q: Record<string, string> = { v: 'read', id: String(view.id) }
    if (view.page !== undefined) q.page = String(view.page)
    if (view.as) q.as = view.as
    return q
  }
  if (view.v === 'item') return { v: 'item', id: String(view.id) }
  if (view.v === 'extensions') return { v: 'extensions', library: view.library }
  if (view.v === 'chapter') return view.title ? { v: 'chapter', catalog: view.catalog, chapter: view.chapter, title: view.title } : { v: 'chapter', catalog: view.catalog, chapter: view.chapter }
  if (view.v === 'sources') return view.add ? { v: 'sources', add: '1' } : { v: 'sources' }
  if (view.v === 'catalog') {
    const q: Record<string, string> = { v: 'catalog', kind: view.kind }
    if (view.path) q.path = view.path
    if (view.q) q.q = view.q
    return q
  }
  return { v: view.v }
}
