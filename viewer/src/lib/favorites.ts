/**
 * Favourites: series of the shelf, single files and series of a catalog, each marked with a star and seen
 * together in «Favoritos». They are records of sync.ts, so with a server of one's own every device has them;
 * a file of this device alone (not on the server) stays a favourite of this device.
 *
 * Keys, so the same thing is the same favourite on every device: `series:<name>`, `item:<its path on the
 * server>`, `local:<its id here>` and `catalog:<catalog>:<address of the series there>`.
 */
import { computed, watch } from 'vue'
import type { Item } from './api.ts'
import { isLocal } from './local.ts'
import { deviceName, type Store } from './store.ts'
import { attachSync, detachSync, setSyncDevice, syncGet, syncPut, syncRecords } from './sync.ts'
import type { Api } from './api.ts'
import { syncedPrefs, useLocalPrefs, usePrefs } from './prefs.ts'
import { t } from './i18n.ts'

export type FavoriteType = 'series' | 'item' | 'catalog'

export interface Favorite {
  type: FavoriteType
  title: string
  /** seconds since 1970 */
  added: number
  /** series: its name */
  series?: string
  /** item: its id (on the server, or here) and what shows it */
  id?: number
  path?: string
  kind?: Item['kind']
  format?: string
  cover?: boolean
  /** catalog: which one, where in it and its cover */
  catalog?: string
  address?: string
  image?: string | null
}

export function seriesFavorite(name: string): { key: string; value: Favorite } {
  return { key: `series:${name}`, value: { type: 'series', title: name, series: name, added: Date.now() / 1000 } }
}
export function itemFavorite(item: Item): { key: string; value: Favorite; onlyHere: boolean } {
  const here = isLocal(item.id)
  return { key: here ? `local:${item.id}` : `item:${item.path}`, onlyHere: here,
           value: { type: 'item', title: item.title, id: item.id, path: item.path, kind: item.kind, format: item.format, cover: item.cover,
                    series: item.series || undefined, added: Date.now() / 1000 } }
}
export function catalogFavorite(catalog: string, address: string, title: string, image?: string | null): { key: string; value: Favorite } {
  return { key: `catalog:${catalog}:${address}`, value: { type: 'catalog', title, catalog, address, image: image || null, added: Date.now() / 1000 } }
}

export function isFavorite(key: string): boolean { return !!syncGet('favorite', key) }
export function setFavorite(key: string, value: Favorite | null, onlyHere = false) { syncPut('favorite', key, value, onlyHere) }

/** Every favourite of a type, the newest first. */
export function favoritesOf(type: FavoriteType): { key: string; value: Favorite }[] {
  return syncRecords<Favorite>('favorite').filter((r) => r.value?.type === type)
    .map((r) => ({ key: r.key, value: r.value! })).sort((a, b) => b.value.added - a.value.added)
}

let prefsFrom: Api | null = null

/** Keeps what is shared in step with the store's server (call it from the pages that show it): connected to it
 * while there is one with the full API (the favourites, and in an app the libraries and catalogs too: the web has
 * them from the server already), this device's own alone without. */
export function useSync(store: Store) {
  setSyncDevice(deviceName(store))
  const app = store.platform !== 'web'
  const target = computed(() => (store.state.server && store.state.connected && !store.api.standalone ? store.api : null))
  watch(target, async (api) => {
    if (api) {
      attachSync(api, app)
      if (app && prefsFrom !== api) {
        prefsFrom = api
        try {
          usePrefs(await syncedPrefs(api, (err: any) => store.notify(t('No se pudieron guardar tus bibliotecas y catálogos: {error}', { error: err?.message || String(err) }), true)))
        } catch (_) { prefsFrom = null }        // offline: this device's own, and again next time
      }
    } else if (store.state.connected) {
      detachSync()
      if (app && prefsFrom) { prefsFrom = null; useLocalPrefs() }
    }
  }, { immediate: true })
}
