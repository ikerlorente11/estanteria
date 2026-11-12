import { reactive } from 'vue'
import type { Item } from './api.ts'
import { plural, t } from './i18n.ts'
import { serverLabel, type Store } from './store.ts'

/** A folder of this device going up to the server, file by file (for all the app: it goes on while one
 * looks at something else, and the folder's page shows how it goes when one comes back). */
export interface UploadRun {
  /** what goes up (the folder's name) */
  title: string
  files: number
  /** how many went already (well or not) */
  done: number
  failed: number
  /** the ones going now (a few at once), and how much of the whole run went, in bytes */
  current: string
  sent: number
  size: number
  /** where it was started from: its local source and folder */
  source: string
  folder: string
  /** asked to stop: no more start, the ones going are cut */
  cancelled?: boolean
}
export const uploads = reactive<{ run: UploadRun | null }>({ run: null })

/** The share of the whole run that went, by its bytes (by files when the sizes are not known). */
export function uploadPercent(r: UploadRun): number {
  if (r.size > 0) return Math.round(Math.min(1, r.sent / r.size) * 100)
  return Math.round((r.done / Math.max(1, r.files)) * 100)
}

/** the shelf's files going up now, to cut them when cancelled */
const goingNow = new Set<number>()
let shelfNow: Store['shelf'] | undefined

/** Stops the run: those waiting do not go, those going are cut (where the host can; else they end). */
export function cancelUploads(): void {
  const run = uploads.run
  if (!run || run.cancelled) return
  run.cancelled = true
  run.current = t('Cancelando…')
  for (const id of goingNow) shelfNow?.backend.cancelUpload?.(id).catch(() => {})
}

/** Files going up at once: each one waits for the server to take it into the cloud when it ends, so one at a
 * time leaves the line idle; a few overlap those waits (more would only split the same bandwidth). */
const AT_ONCE = 3

/**
 * Which of these files of the shelf the server has already, where they would go (see LocalShelf.uploadPath):
 * a file of that name in that folder (case does not matter). It asks the server's index, folder by folder;
 * `fresh` first has it look at the cloud again, so what was deleted there is not taken for being there.
 */
export async function alreadyOnServer(store: Store, items: Item[], fresh = false): Promise<Set<number>> {
  const shelf = store.shelf
  const there = new Set<number>()
  if (!shelf || !store.state.server || !items.length) return there
  if (fresh) { await store.api.scan(); await store.refresh() }
  const folders = store.state.status?.folders || []
  const byFolder = new Map<string, { id: number; name: string }[]>()
  for (const item of items) {
    const dest = shelf.uploadPath(item.id, folders)
    if (!dest) continue
    const cut = dest.lastIndexOf('/')
    const folder = cut < 0 ? '' : dest.slice(0, cut)
    byFolder.set(folder, [...(byFolder.get(folder) || []), { id: item.id, name: dest.slice(cut + 1).toLowerCase() }])
  }
  await Promise.all([...byFolder].map(async ([folder, files]) => {
    const names = new Set<string>()
    for (let offset = 0; ; offset += 1000) {
      const got = await store.api.items({ folder, direct: true, source: 'archivador', limit: 1000, offset })
      for (const i of got) names.add((i.name || '').toLowerCase())
      if (got.length < 1000) break
    }
    for (const f of files) if (names.has(f.name)) there.add(f.id)
  }))
  return there
}

/** Uploads these files of the shelf, each where the rest is on the server (see LocalShelf.uploadPath); those
 * the server has already are left out (it is asked first, after looking at the cloud again). */
export async function uploadFiles(store: Store, items: Item[], where: { title: string; source: string; folder: string }): Promise<void> {
  const shelf = store.shelf
  if (!shelf || uploads.run) return
  const folders = store.state.status?.folders || []
  const run: UploadRun = reactive({ title: where.title, files: items.length, done: 0, failed: 0, current: t('Mirando qué tiene ya {server}…', { server: serverLabel(store) }),
                                    sent: 0, size: 0, source: where.source, folder: where.folder })
  uploads.run = run
  let there = new Set<number>()
  shelfNow = shelf
  try { there = await alreadyOnServer(store, items, true) } catch (_) { /* it is asked again by each upload */ }
  if (run.cancelled) { uploads.run = null; store.notify(t('Subida cancelada.')); return }
  if (there.size) {
    items = items.filter((i) => !there.has(i.id))
    run.files = items.length
    if (!items.length) {
      uploads.run = null
      store.notify(t('Ya estaba todo en {server}: no hacía falta subir nada.', { server: serverLabel(store) }))
      store.refresh()
      return
    }
  }
  run.current = ''
  let firstError = ''
  const sentOf = new Map<number, number>()
  const going = new Set<number>()
  const tally = () => {
    let sent = 0
    for (const v of sentOf.values()) sent += v
    run.sent = sent
    run.current = items.filter((i) => going.has(i.id)).map((i) => i.name).join(' · ')
  }
  const queue = [...items]
  run.size = items.reduce((sum, i) => sum + (i.size || 0), 0)
  async function one(it: Item) {
    if (run.cancelled) return
    going.add(it.id)
    goingNow.add(it.id)
    sentOf.set(it.id, 0)
    tally()
    try {
      await shelf!.backend.upload(it.id, shelf!.uploadPath(it.id, folders), (sent) => { sentOf.set(it.id, sent); tally() })
      run.done++
    } catch (err: any) {
      if (!run.cancelled) {
        run.failed++
        run.done++
        firstError ||= err?.message || String(err)
      }
    }
    sentOf.set(it.id, it.size || 0)       // done or given up: it counts as gone, so the bar keeps moving
    going.delete(it.id)
    goingNow.delete(it.id)
    tally()
  }
  async function worker() {
    for (let it = queue.shift(); it && !run.cancelled; it = queue.shift()) await one(it)
  }
  // the first one alone: it makes the folders on the server, which the others would otherwise race to make
  const first = queue.shift()
  if (first) await one(first)
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, queue.length) }, worker))
  uploads.run = null
  if (run.cancelled) {
    store.notify(t('Subida cancelada: {ok} de {n} subidos.', { ok: run.done - run.failed, n: run.files }))
    store.refresh()
    return
  }
  const ok = run.files - run.failed
  const skipped = there.size ? ` ${plural(there.size, '({n} ya estaba).', '({n} ya estaban).')}` : ''
  store.notify((run.failed
    ? t('{ok} de {n} subidos; fallaron {failed} ({error}).', { ok, n: run.files, failed: run.failed, error: firstError })
    : plural(ok, '{n} archivo subido a {server}.', '{n} archivos subidos a {server}.', { server: serverLabel(store) })) + skipped, run.failed > 0)
  store.refresh()
}
