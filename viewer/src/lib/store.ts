/** What every page of the app shares: the API, the images, the library's state and how to move around. */
import { inject, reactive, type InjectionKey } from 'vue'
import type { Api, Item, LibraryStatus, Series, Source } from './api.ts'
import type { ImageCache } from './images.ts'
import type { LocalShelf } from './local.ts'
import type { Offline } from './offline.ts'
import type { View } from './views.ts'

export { queryFromView, viewFromQuery, type View } from './views.ts'

export interface Store {
  api: Api
  covers: ImageCache
  pages: ImageCache
  readingRoot: string
  state: { status: LibraryStatus | null; series: Series[]; loaded: boolean; connected: boolean; error: string }
  refresh: () => Promise<void>
  go: (view: View, replace?: boolean) => void
  back: () => void
  notify: (text: string, error?: boolean) => void
  /** Opens a comic or a book where it was left. */
  read: (item: Item) => void
  /** Reading without connection, when the app can keep files (the desktop, Android); not on the web. */
  offline?: Offline
  /** The files and folders of this device, when the app can read them (the desktop). */
  shelf?: LocalShelf
  /** Saves a file of the service where the host wants (Android: through the app); without it, the browser downloads it. */
  saveFile?: (path: string, name: string) => void
}

export const STORE: InjectionKey<Store> = Symbol('estanteria')

export function createState(): Store['state'] {
  return reactive({ status: null, series: [], loaded: false, connected: false, error: '' })
}

export function useStore(): Store {
  const store = inject(STORE)
  if (!store) throw new Error('La Estantería: store not provided')
  return store
}

/** `Serie 12` or the title, for a card. */
export function shortTitle(item: Item): string {
  if (item.series && item.number !== null && item.number !== undefined) return `${item.series} ${numberLabel(item.number)}`
  return item.title
}

export function numberLabel(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n)
}

export function kindLabel(item: Item): string {
  if (item.kind === 'book') return item.format === 'epub' ? 'EPUB' : item.format.toUpperCase()
  if (item.kind === 'pdf') return 'PDF'
  return item.format === 'folder' ? 'Carpeta' : item.format.toUpperCase()
}

export function percentOf(item: Item): number {
  const p = item.progress
  if (!p) return 0
  if (p.finished) return 1
  return Math.max(0, Math.min(1, p.percent || 0))
}

/** The name of the library an item comes from ('' for the user's own Archivador). */
export function sourceName(item: Item, sources: Source[] | undefined): string {
  if (!item.source_id) return ''
  return sources?.find((s) => s.id === item.source_id)?.name || 'Biblioteca externa'
}

export function sizeLabel(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`
  return `${Math.round(bytes / 1e3)} KB`
}

/** Settings of the reader, kept in this browser. */
export interface ReaderSettings {
  mode: 'single' | 'double' | 'strip'
  fit: 'width' | 'height' | 'best' | 'original'
  coverAlone: boolean
  /** per item: the reading direction chosen by hand (else the one the file says) */
  directions: Record<string, 'ltr' | 'rtl'>
  background: 'black' | 'dark' | 'white'
  /** how a page gives way to the next */
  animation: Animation
  /** how a PDF opens: its pages as images in the comic reader, or as a document (text, zoom without blur) */
  pdf: 'pages' | 'doc'
}
export type Animation = 'none' | 'fade' | 'slide'

const SETTINGS_KEY = 'estanteria.reader'
export function loadSettings(): ReaderSettings {
  const base: ReaderSettings = { mode: 'single', fit: 'best', coverAlone: true, directions: {}, background: 'black', animation: 'fade', pdf: 'pages' }
  try { return { ...base, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') } } catch (_) { return base }
}
export function saveSettings(settings: ReaderSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch (_) {}
}

export interface BookSettings {
  flow: 'paginated' | 'scrolled'
  theme: 'light' | 'sepia' | 'dark'
  /** per cent of the book's own size */
  fontSize: number
  /** an id of FONTS, 'publisher' (the book's own) or 'custom' (customFont) */
  font: string
  customFont: string
  lineHeight: number
  /** per cent of the width, each side */
  margin: number
  animation: Animation
}
/** Type faces to read with: what the device has (a missing one falls back to the next of its kind). */
export const FONTS: { id: string; label: string; stack: string; kind: 'serif' | 'sans' | 'otras' }[] = [
  { id: 'georgia', label: 'Georgia', stack: 'Georgia, "Noto Serif", serif', kind: 'serif' },
  { id: 'times', label: 'Times New Roman', stack: '"Times New Roman", Times, "Liberation Serif", serif', kind: 'serif' },
  { id: 'palatino', label: 'Palatino / Book Antiqua', stack: '"Palatino Linotype", Palatino, "Book Antiqua", "URW Palladio L", serif', kind: 'serif' },
  { id: 'garamond', label: 'Garamond', stack: 'Garamond, "EB Garamond", "Cormorant Garamond", serif', kind: 'serif' },
  { id: 'cambria', label: 'Cambria', stack: 'Cambria, Caladea, serif', kind: 'serif' },
  { id: 'constantia', label: 'Constantia', stack: 'Constantia, serif', kind: 'serif' },
  { id: 'baskerville', label: 'Baskerville', stack: 'Baskerville, "Libre Baskerville", "Baskerville Old Face", serif', kind: 'serif' },
  { id: 'charter', label: 'Charter', stack: 'Charter, "Bitstream Charter", "Source Serif Pro", serif', kind: 'serif' },
  { id: 'literata', label: 'Literata', stack: 'Literata, "Noto Serif", serif', kind: 'serif' },
  { id: 'bookerly', label: 'Bookerly', stack: 'Bookerly, Georgia, serif', kind: 'serif' },
  { id: 'merriweather', label: 'Merriweather', stack: 'Merriweather, Georgia, serif', kind: 'serif' },
  { id: 'notoserif', label: 'Noto Serif', stack: '"Noto Serif", "Droid Serif", serif', kind: 'serif' },
  { id: 'segoe', label: 'Segoe UI', stack: '"Segoe UI", system-ui, sans-serif', kind: 'sans' },
  { id: 'roboto', label: 'Roboto', stack: 'Roboto, "Noto Sans", sans-serif', kind: 'sans' },
  { id: 'system', label: 'La del sistema', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif', kind: 'sans' },
  { id: 'arial', label: 'Arial', stack: 'Arial, "Liberation Sans", sans-serif', kind: 'sans' },
  { id: 'helvetica', label: 'Helvetica', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif', kind: 'sans' },
  { id: 'verdana', label: 'Verdana', stack: 'Verdana, "DejaVu Sans", sans-serif', kind: 'sans' },
  { id: 'tahoma', label: 'Tahoma', stack: 'Tahoma, sans-serif', kind: 'sans' },
  { id: 'trebuchet', label: 'Trebuchet MS', stack: '"Trebuchet MS", sans-serif', kind: 'sans' },
  { id: 'calibri', label: 'Calibri', stack: 'Calibri, Carlito, sans-serif', kind: 'sans' },
  { id: 'candara', label: 'Candara', stack: 'Candara, sans-serif', kind: 'sans' },
  { id: 'opensans', label: 'Open Sans', stack: '"Open Sans", "Noto Sans", sans-serif', kind: 'sans' },
  { id: 'notosans', label: 'Noto Sans', stack: '"Noto Sans", sans-serif', kind: 'sans' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible', stack: '"Atkinson Hyperlegible", sans-serif', kind: 'otras' },
  { id: 'opendyslexic', label: 'OpenDyslexic', stack: 'OpenDyslexic, "Comic Sans MS", sans-serif', kind: 'otras' },
  { id: 'comic', label: 'Comic Sans', stack: '"Comic Sans MS", "Comic Neue", cursive', kind: 'otras' },
  { id: 'consolas', label: 'Consolas (monoespaciada)', stack: 'Consolas, "Courier New", monospace', kind: 'otras' }
]
export function fontStack(settings: BookSettings): string {
  if (settings.font === 'publisher') return ''
  if (settings.font === 'custom') return settings.customFont.trim() ? `"${settings.customFont.trim().replace(/"/g, '')}", serif` : ''
  return FONTS.find((f) => f.id === settings.font)?.stack || ''
}
const BOOK_KEY = 'estanteria.book'
export function loadBookSettings(): BookSettings {
  const base: BookSettings = { flow: 'paginated', theme: 'light', fontSize: 100, font: 'publisher', customFont: '', lineHeight: 1.5, margin: 6, animation: 'fade' }
  try {
    const saved = JSON.parse(localStorage.getItem(BOOK_KEY) || '{}')
    if (saved.margin !== undefined && saved.margin <= 3 && !saved.animation) saved.margin = saved.margin * 4   // the old 0–3 steps
    return { ...base, ...saved }
  } catch (_) { return base }
}
export function saveBookSettings(settings: BookSettings): void {
  try { localStorage.setItem(BOOK_KEY, JSON.stringify(settings)) } catch (_) {}
}
