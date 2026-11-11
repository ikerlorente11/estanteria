/** The app's lock: when it is on (in the settings) and the device can, the app is locked when it opens and
 * when it comes back after a while away; the shell shows LockScreen while `locked` is true. */
import { ref, watch } from 'vue'
import { appSettings } from './appsettings.ts'
import type { NativeFeatures } from './native.ts'

/** how long the app may be away before it locks again */
const AWAY_MS = 30_000

export function useAppLock(native: () => NativeFeatures | undefined) {
  const locked = ref(false)
  let hiddenAt = 0

  async function lockIfAsked() {
    const lock = native()?.lock
    if (appSettings.lock && lock && (await lock.available().catch(() => false))) locked.value = true
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) lockIfAsked()
  })
  // turning the lock off unlocks at once
  watch(() => appSettings.lock, (on) => { if (!on) locked.value = false })

  return { locked, lockIfAsked, unlocked: () => { locked.value = false } }
}
