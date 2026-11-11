import { reactive } from 'vue'
import { t } from './i18n.ts'

/**
 * What is downloaded from the catalogs, for all the app (not one page): what is going on now (so leaving
 * the page and coming back still shows it, and a second tap does not download it twice), what was
 * downloaded (the shelf's item of each), and what each one is — its series and whether it is manga,
 * a comic or a book — so that uploading it to a server puts it where the rest is.
 */
const GOT_KEY = 'estanteria.catalogs.got'
const META_KEY = 'estanteria.catalogs.meta'

export type CatalogKind = 'manga' | 'comic' | 'book'
export interface CatalogMeta { series: string | null; kind: CatalogKind; title: string }

export interface CatalogJob {
  key: string
  title: string
  done: number
  total: number
  /** what done and total count: pages (a chapter, page by page) or bytes (a file) */
  unit: 'pages' | 'bytes'
  /** waiting its turn (a whole series goes a few at a time) */
  waiting: boolean
}

function read<T>(key: string): T {
  try { return JSON.parse(localStorage.getItem(key) || '{}') } catch (_) { return {} as T }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch (_) { /* storage off: this session only */ }
}

/** the shelf's item of what was downloaded, by the key of the catalog's entry */
export const catalogGot = reactive<Record<string, number>>(read(GOT_KEY))
/** what each downloaded item is, by its shelf id */
export const catalogMeta = reactive<Record<number, CatalogMeta>>(read(META_KEY))
/** what is downloading now, by the key of the catalog's entry */
export const catalogJobs = reactive<Record<string, CatalogJob>>({})
const running = new Map<string, Promise<number>>()
/** how many go at once; the rest wait their turn */
const AT_ONCE = 2
let busy = 0
const turns: (() => void)[] = []
async function turn(): Promise<void> {
  if (busy < AT_ONCE) { busy++; return }
  await new Promise<void>((r) => turns.push(r))
  busy++
}
function done() {
  busy--
  turns.shift()?.()
}

/** How far it went, for a button: «34 %», «12/40». */
export function jobLabel(job: CatalogJob | undefined): string {
  if (!job) return ''
  if (job.waiting) return t('En cola')
  if (job.unit === 'pages') return job.total ? `${job.done}/${job.total}` : ''
  return job.total ? `${Math.round((job.done / job.total) * 100)} %` : job.done ? `${Math.round(job.done / 1e6)} MB` : ''
}

/**
 * Downloads it once: asked again while it goes, the same download answers (no second copy). `work` does
 * it, telling how it goes, and answers the shelf's item; that is kept with what it is (`meta`).
 */
export function runCatalogDownload(key: string, title: string, meta: CatalogMeta, unit: CatalogJob['unit'],
                                   work: (progress: (done: number, total: number) => void) => Promise<number>): Promise<number> {
  const going = running.get(key)
  if (going) return going
  catalogJobs[key] = { key, title, done: 0, total: 0, unit, waiting: true }
  const p = turn().then(() => {
    const job = catalogJobs[key]
    if (job) job.waiting = false
    return work((got, total) => {
      const j = catalogJobs[key]
      if (j) { j.done = got; j.total = total }
    }).finally(done)
  }).then((id) => {
    catalogGot[key] = id
    catalogMeta[id] = meta
    write(GOT_KEY, catalogGot)
    write(META_KEY, catalogMeta)
    return id
  }).finally(() => {
    delete catalogJobs[key]
    running.delete(key)
  })
  running.set(key, p)
  return p
}

/** Forgets what was downloaded (its item is gone from the shelf). */
export function forgetCatalogItems(ids: number[]) {
  const gone = new Set(ids)
  for (const [k, id] of Object.entries(catalogGot)) if (gone.has(id)) delete catalogGot[k]
  for (const id of ids) delete catalogMeta[id]
  write(GOT_KEY, catalogGot)
  write(META_KEY, catalogMeta)
}

/** The shelf ids of everything downloaded from the catalogs. */
export function catalogItemIds(): number[] {
  return [...new Set(Object.values(catalogGot))]
}
