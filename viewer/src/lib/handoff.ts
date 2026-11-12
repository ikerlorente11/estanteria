/**
 * Reading on several devices: a reader open here, left a while, may be behind what was read since on another
 * device (the phone in bed, the desktop now). Coming back to it (the page shown again, the window focused, now
 * and then while open), it asks the server where the item is read up to; if another device read on after this
 * one last saved, it offers to go there («Ibas por la página 45 en el móvil · Ir allí»).
 */
import { onBeforeUnmount, ref } from 'vue'
import type { Progress, ProgressUpdate } from './api.ts'
import { syncGet, syncPut } from './sync.ts'
import { t } from './i18n.ts'
import { isLocal } from './local.ts'
import { deviceName, type Store } from './store.ts'

/** «en el móvil», «en el escritorio», «en la web», «en Komga» */
export function deviceWhere(device: string | null | undefined): string {
  if (device === 'móvil') return t('en el móvil')
  if (device === 'escritorio') return t('en el escritorio')
  if (device === 'web') return t('en la web')
  return device ? t('en {device}', { device }) : t('en otro dispositivo')
}

export function useHandoff(store: Store, itemId: number) {
  const offer = ref<Progress | null>(null)
  const me = deviceName(store)
  let mine = Date.now() / 1000          // what this reader showed or saved last: the server's is newer only if read on after
  let asking = false
  async function look() {
    if (asking || isLocal(itemId) || !store.state.server || document.visibilityState !== 'visible') return
    asking = true
    try {
      const p = (await store.api.item(itemId)).progress
      if (p && p.updated && p.updated > mine + 2 && p.device && p.device !== me) offer.value = p
    } catch (_) { /* offline: nothing to offer */ } finally { asking = false }
  }
  const onShow = () => { if (document.visibilityState === 'visible') look() }
  document.addEventListener('visibilitychange', onShow)
  window.addEventListener('focus', look)
  const timer = setInterval(look, 120000)
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', onShow)
    window.removeEventListener('focus', look)
    clearInterval(timer)
  })
  return {
    offer,
    /** this reader saved (or went to) where it is now */
    saved() { mine = Date.now() / 1000; offer.value = null },
    dismiss() { mine = Math.max(mine, offer.value?.updated || 0); offer.value = null },
  }
}

// ---- what was read of a file wherever it is: a copy on this device, the same on another, the server's ----
/** The same file on every device (not only the server's): its name and size; a chapter read online, its key in
 * the catalog (`chapter:<catalog>:<chapter>`). Null when there is nothing to know it by. */
export function progressKey(item: { path?: string; name?: string; size?: number }): string | null {
  if (item.path?.startsWith('chapter:')) return item.path
  if (!item.size || !item.name) return null
  return `file:${item.size}:${item.name.toLowerCase()}`
}

/** Notes where it was read up to, for the other devices (through sync.ts): what has no progress on the server
 * (a file of a device, a chapter read online) is read on elsewhere from here. */
export function recordProgress(item: { path?: string; name?: string; size?: number; title?: string }, p: ProgressUpdate) {
  const key = progressKey(item)
  if (!key) return
  syncPut('progress', key, { page: p.page ?? null, location: p.location ?? null, percent: p.percent ?? 0, finished: !!p.finished,
                             device: p.device || null, updated: p.updated || Date.now() / 1000, title: item.title || item.name || '' })
}

/** What another device (or this one) read of this file or chapter, if anything. */
export function sharedProgress(item: { path?: string; name?: string; size?: number }): Progress | null {
  const key = progressKey(item)
  return key ? syncGet<Progress>('progress', key) : null
}

/** The one read later of the two. */
export function newestProgress(a: Progress | null | undefined, b: Progress | null | undefined): Progress | null {
  if (!a) return b || null
  if (!b) return a
  return (b.updated || 0) > (a.updated || 0) ? b : a
}
