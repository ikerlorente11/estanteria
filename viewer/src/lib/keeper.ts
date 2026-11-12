/**
 * Where what is downloaded from a catalog goes (a book, a comic, a chapter packed as a CBZ):
 *  - an app (it has a shelf and a network of its own): this device's shelf, as always; with a server of its own
 *    connected, it goes up to the server's reading folder too (where the rest is), so every device has it;
 *  - the web of a server (no device): the service fetches it into the person's reading folder itself (keep.py),
 *    and what is there is known by the server, not by this browser.
 * Either way the answer is the id of an item that opens with the readers of always.
 */
import type { Api, Item } from './api.ts'
import { reactive } from 'vue'
import { cancelled, catalogGot, catalogGotFrom, type CatalogMeta } from './catalogdownloads.ts'
import { t } from './i18n.ts'
import { catalogFolder, isLocal, seriesOfTitle } from './local.ts'
import { authOf } from './netimages.ts'
import type { Store } from './store.ts'
import { storeZip } from './zipstore.ts'

export type KeepProgress = (done: number, total: number) => void

export interface ChapterToKeep {
  /** the pages' addresses, in order */
  pages: string[]
  /** the ComicInfo.xml that says what it is */
  comicInfo: string
  /** the CBZ's file name */
  name: string
}

export interface Keeper {
  /** the device's shelf, or the server's reading folder (for what the buttons say) */
  where: 'device' | 'server'
  /** what was kept with this id is still there */
  has(id: number | undefined): boolean
  /** the item kept for an entry of a catalog (its key), if there is one now: this device's copy, else the server's */
  gotOf(key: string): number | undefined
  item(id: number): Promise<Item | null>
  /** the file at `url`, kept as `name`; `key`: the entry's in its catalog */
  file(key: string, url: string, name: string, meta: CatalogMeta, progress: KeepProgress, signal: AbortSignal): Promise<number>
  chapter(key: string, chapter: ChapterToKeep, meta: CatalogMeta, progress: KeepProgress, signal: AbortSignal): Promise<number>
  /** asks again what was kept (the server's keeper: what it fetched by itself meanwhile) */
  load?(): Promise<void>
}

const seriesFolder = (meta: CatalogMeta) => meta.series || seriesOfTitle(meta.title)

// ---- an app: this device's shelf (and the server, when one is connected) ----
const devices = new WeakMap<object, Keeper>()

function deviceKeeper(store: Store): Keeper {
  const shelf = store.shelf!
  const net = store.net!
  // up to the server one after another, behind the downloads (the folders of a new series are made once)
  let ups: Promise<void> = Promise.resolve()
  let told = false
  function toServer(item: Item, meta: CatalogMeta) {
    if (!store.state.server) return
    ups = ups.then(async () => {
      if (!store.state.server) return
      const dest = `${catalogFolder(meta, store.state.status?.folders || [])}/${item.name}`
      try {
        await shelf.backend.upload(item.id, dest, () => {})
      } catch (err: any) {
        if (err?.status === 409 || /ya hay/i.test(String(err?.message || err))) return      // it is there already
        if (!told) store.notify(t('No se pudo subir «{title}» a {server}: {error}', { title: meta.title, server: store.serverName || t('tu servidor'), error: err?.message || String(err) }), true)
        told = true
      }
    })
  }
  // what the server kept (by hand on another device, or a followed series): its items, openable while connected
  const serverGot = reactive<Record<string, number>>({})
  return {
    where: 'device',
    has: (id) => id !== undefined && shelf.has(id),
    gotOf(key) {
      const here = catalogGot[key]
      if (here !== undefined && shelf.has(here)) return here
      return store.state.server ? serverGot[key] : undefined
    },
    item: async (id) => (isLocal(id) ? (shelf.item(id) as Item) || null : store.api.item(id).catch(() => null)),
    async load() {
      if (!store.state.server || store.api.standalone) return
      const got = await store.api.keptFromCatalogs()
      for (const k of Object.keys(serverGot)) delete serverGot[k]
      Object.assign(serverGot, got)
    },
    async file(_key, url, name, meta, progress, signal) {
      const uri = await net.download(url, name, authOf(url), progress, seriesFolder(meta), signal)
      const [item] = await shelf.addFiles([uri])
      toServer(item, meta)
      return item.id
    },
    async chapter(_key, chapter, meta, progress, signal) {
      const files: { name: string; data: Uint8Array }[] = []
      progress(0, chapter.pages.length)
      for (const [i, url] of chapter.pages.entries()) {
        if (signal.aborted) throw cancelled()
        const res = await net.fetch(url, { headers: { Accept: 'image/*', ...authOf(url) } })
        if (!res.ok) throw new Error(t('la página {n} respondió {status}', { n: i + 1, status: res.status }))
        const ext = (url.match(/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase()
        files.push({ name: `${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) })
        progress(i + 1, chapter.pages.length)
      }
      if (signal.aborted) throw cancelled()
      files.unshift({ name: 'ComicInfo.xml', data: new TextEncoder().encode(chapter.comicInfo) })
      const zip = storeZip(files)
      const uri = await net.save(chapter.name, new Blob([zip.buffer as ArrayBuffer], { type: 'application/vnd.comicbook+zip' }), seriesFolder(meta))
      const [item] = await shelf.addFiles([uri])
      toServer(item, meta)
      return item.id
    },
  }
}

// ---- the web of a server: the service keeps it in the reading folder ----
/** The keeper of the web: `load` asks the server what was kept already (call it once connected). */
export function serverKeeper(api: Api, state: Store['state']): Keeper & { load(): Promise<void> } {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  async function follow(start: Promise<import('./api.ts').KeepJob>, progress: KeepProgress, signal: AbortSignal): Promise<number> {
    let job = await start
    const stop = () => { api.cancelKeepJob(job.id).catch(() => {}) }
    signal.addEventListener('abort', stop, { once: true })
    try {
      for (;;) {
        if (job.state === 'done' && job.item) return job.item
        if (job.state === 'error') throw new Error(job.error || t('No se pudo guardar'))
        if (job.state === 'cancelled' || signal.aborted) throw cancelled()
        progress(job.done, job.total)
        await sleep(900)
        job = await api.keepJob(job.id)
      }
    } finally {
      signal.removeEventListener('abort', stop)
    }
  }
  const folders = () => state.status?.folders || []
  return {
    where: 'server',
    has: (id) => id !== undefined,
    gotOf: (key) => catalogGot[key],
    item: (id) => api.item(id).catch(() => null),
    async load() { catalogGotFrom(await api.keptFromCatalogs()) },
    file(key, url, name, meta, progress, signal) {
      return follow(api.keepFile({ key, url, headers: authOf(url), folder: catalogFolder(meta, folders()), name, title: meta.title }), progress, signal)
    },
    chapter(key, chapter, meta, progress, signal) {
      return follow(api.keepChapter({ key, pages: chapter.pages.map((url) => ({ url, headers: authOf(url) })), comic_info: chapter.comicInfo,
                                      folder: catalogFolder(meta, folders()), name: chapter.name, title: meta.title }), progress, signal)
    },
  }
}

/** Where this app keeps what comes from catalogs, or null when it cannot keep anything. */
export function keeperOf(store: Store): Keeper | null {
  if (store.keeper) return store.keeper
  if (!store.shelf || !store.net) return null
  const key = store.shelf as object
  let k = devices.get(key)
  if (!k) devices.set(key, (k = deviceKeeper(store)))
  return k
}
