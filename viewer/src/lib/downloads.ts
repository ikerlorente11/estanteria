import { catalogItemIds, forgetCatalogItems } from './catalogdownloads.ts'
import type { Store } from './store.ts'

/**
 * Everything downloaded to this device, as one: the copies kept to read offline, what came from the
 * catalogs (files on the shelf) and the files the app saved before (Android's «descargas»).
 */
export function downloadsCount(store: Store): number {
  const kept = store.offline?.count || 0
  const fromCatalogs = store.shelf ? catalogItemIds().filter((id) => store.shelf!.has(id)).length : 0
  const saved = store.downloads ? Object.keys(store.downloads).length : 0
  return kept + fromCatalogs + saved
}

/** Deletes all of it; how many went. */
export async function clearAllDownloads(store: Store): Promise<number> {
  let gone = 0
  const offline = store.offline
  if (offline) {
    const ids = Object.keys(offline.state.entries).map(Number)
    await offline.removeAll(ids)
    gone += ids.length
  }
  const shelf = store.shelf
  if (shelf) {
    const ids = catalogItemIds()
    for (const id of ids) {
      if (!shelf.has(id)) continue
      await shelf.removeFile(id)          // a catalog download is deleted with it (it lives in the app's folder)
      gone += 1
    }
    forgetCatalogItems(ids)
  }
  if (store.downloads && store.removeDownload) {
    for (const path of Object.keys(store.downloads)) { store.removeDownload(path); gone += 1 }
  }
  return gone
}
