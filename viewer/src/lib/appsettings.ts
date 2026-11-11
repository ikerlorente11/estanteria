/** The app's own settings (not a reader's): where it opens, how the shelf looks and what it lists, and
 * the backup of everything this device keeps. Kept in this device. */
import { reactive, watch } from 'vue'
import type { Format } from './api.ts'
import { setLanguage, t, type LanguageChoice } from './i18n.ts'

export interface AppSettings {
  /** the page the app opens at */
  start: 'home' | 'library'
  /** the screen stays on while reading (Android) */
  keepAwake: boolean
  /** how big the covers are in the grids */
  covers: 'small' | 'medium' | 'large'
  /** what was read to the end is not shown in the lists */
  hideFinished: boolean
  /** this device's folders are looked at again when the app opens */
  scanOnStart: boolean
  /** formats of this device's folders that are not listed (a folder full of .txt notes, say) */
  hiddenFormats: Format[]
  /** the app's language */
  language: LanguageChoice
  /** the volume keys turn pages while reading (Android) */
  volumeKeys: boolean
  /** downloads only on Wi-Fi, never on mobile data (Android) */
  wifiOnly: boolean
  /** the app asks for the fingerprint, the face or the device's PIN when it opens and when it comes back */
  lock: boolean
}

const KEY = 'estanteria.app'
const BASE: AppSettings = { start: 'home', keepAwake: true, covers: 'medium', hideFinished: false, scanOnStart: false, hiddenFormats: [], language: 'system', volumeKeys: false, wifiOnly: false, lock: false }

function load(): AppSettings {
  try { return { ...BASE, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch (_) { return { ...BASE } }
}

/** The settings, shared by every page; changes are kept at once. */
export const appSettings = reactive<AppSettings>(load())
watch(appSettings, () => {
  try { localStorage.setItem(KEY, JSON.stringify(appSettings)) } catch (_) { /* private mode */ }
  applyLook()
}, { deep: true })

const COVER_SCALE = { small: 0.8, medium: 1, large: 1.3 }
/** What the settings change in the page's look (the covers' size). */
export function applyLook(): void {
  try { document.documentElement.style.setProperty('--es-cards', String(COVER_SCALE[appSettings.covers] || 1)) } catch (_) { /* no page */ }
  setLanguage(appSettings.language)
}
applyLook()

// ---- the backup: everything this device keeps for the app (never passwords: those are the app's own) ----
const PREFIX = 'estanteria.'

export interface Backup {
  app: 'la-estanteria'
  version: 1
  made: string
  data: Record<string, string>
}

export function makeBackup(): Backup {
  const data: Record<string, string> = {}
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)!
      // a library's password stays on this device: never in a file
      if (key.startsWith(PREFIX) && !key.startsWith(PREFIX + 'secret.')) data[key] = localStorage.getItem(key)!
    }
  } catch (_) { /* nothing kept */ }
  return { app: 'la-estanteria', version: 1, made: new Date().toISOString(), data }
}

/** Puts a backup back (what it has replaces what is here); the page must be reloaded after. */
export function restoreBackup(text: string): number {
  let backup: Backup
  try { backup = JSON.parse(text) } catch (_) { throw new Error(t('Ese archivo no es una copia de seguridad (no es JSON).')) }
  if (backup?.app !== 'la-estanteria' || typeof backup.data !== 'object') throw new Error(t('Ese archivo no es una copia de seguridad de La Estantería.'))
  let n = 0
  for (const [key, value] of Object.entries(backup.data)) {
    if (!key.startsWith(PREFIX) || key.startsWith(PREFIX + 'secret.') || typeof value !== 'string') continue
    localStorage.setItem(key, value)
    n++
  }
  return n
}

/** The open source this app is made with, for «Acerca de». */
export const LICENSES: { name: string; license: string; url: string }[] = [
  { name: 'Vue', license: 'MIT', url: 'https://vuejs.org' },
  { name: 'foliate-js (libros)', license: 'MIT', url: 'https://github.com/johnfactotum/foliate-js' },
  { name: 'pdf.js (PDF)', license: 'Apache-2.0', url: 'https://mozilla.github.io/pdf.js/' },
  { name: 'djvu-rs (DjVu)', license: 'MIT', url: 'https://github.com/matyushkin/djvu-rs' },
  { name: 'Remix Icon (iconos)', license: 'Apache-2.0', url: 'https://remixicon.com' },
]
