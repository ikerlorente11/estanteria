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
  /** the one going now, and how much of it */
  current: string
  sent: number
  size: number
  /** where it was started from: its local source and folder */
  source: string
  folder: string
}
export const uploads = reactive<{ run: UploadRun | null }>({ run: null })

/** The share of the whole run that went (by files, the current one by its bytes). */
export function uploadPercent(r: UploadRun): number {
  const current = r.size ? r.sent / r.size : 0
  return Math.round(((r.done + Math.min(1, current)) / Math.max(1, r.files)) * 100)
}

/** Uploads these files of the shelf, each where the rest is on the server (see LocalShelf.uploadPath). */
export async function uploadFiles(store: Store, items: Item[], where: { title: string; source: string; folder: string }): Promise<void> {
  const shelf = store.shelf
  if (!shelf || uploads.run) return
  const folders = store.state.status?.folders || []
  const run: UploadRun = reactive({ title: where.title, files: items.length, done: 0, failed: 0, current: '', sent: 0, size: 0, source: where.source, folder: where.folder })
  uploads.run = run
  let firstError = ''
  for (const item of items) {
    run.current = item.name
    run.sent = 0
    run.size = item.size
    try {
      await shelf.backend.upload(item.id, shelf.uploadPath(item.id, folders), (sent, total) => { run.sent = sent; run.size = total })
    } catch (err: any) {
      run.failed++
      firstError ||= err?.message || String(err)
    }
    run.done++
  }
  uploads.run = null
  const ok = run.files - run.failed
  store.notify(run.failed
    ? t('{ok} de {n} subidos; fallaron {failed} ({error}).', { ok, n: run.files, failed: run.failed, error: firstError })
    : plural(ok, '{n} archivo subido a {server}.', '{n} archivos subidos a {server}.', { server: serverLabel(store) }), run.failed > 0)
  store.refresh()
}
