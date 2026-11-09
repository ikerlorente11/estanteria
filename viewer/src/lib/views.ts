/** The pages of the app and how each is written in the route's query (pure, for tests too). */

export type View =
  | { v: 'home' }
  | { v: 'library'; q?: string; kind?: string; sort?: string; folder?: string }
  | { v: 'series'; name: string }
  | { v: 'read'; id: number; page?: number }
  | { v: 'item'; id: number }
  | { v: 'sources' }

/** The view a route's query stands for (the app keeps its place in the URL). */
export function viewFromQuery(query: Record<string, unknown>): View {
  const v = String(query.v || 'home')
  const id = Number(query.id)
  if (v === 'library') {
    const view: View = { v }
    if (query.q) view.q = String(query.q)
    if (query.kind) view.kind = String(query.kind)
    if (query.sort) view.sort = String(query.sort)
    if (query.folder !== undefined && query.folder !== null) view.folder = String(query.folder)
    return view
  }
  if (v === 'series' && query.name) return { v, name: String(query.name) }
  if (v === 'read' && id > 0) {
    const page = Number(query.page)
    return page >= 0 && query.page !== undefined ? { v, id, page } : { v, id }
  }
  if (v === 'item' && id > 0) return { v, id }
  if (v === 'sources') return { v }
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
    return q
  }
  if (view.v === 'series') return { v: 'series', name: view.name }
  if (view.v === 'read') return view.page !== undefined ? { v: 'read', id: String(view.id), page: String(view.page) } : { v: 'read', id: String(view.id) }
  if (view.v === 'item') return { v: 'item', id: String(view.id) }
  return { v: view.v }
}
