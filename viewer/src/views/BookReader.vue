<template>
  <div ref="root" class="es-reader es-book" :class="[`es-book-${settings.theme}`, { 'es-ui-hidden': !uiShown }]" tabindex="0" @keydown="onKey">
    <header class="es-rtop" :inert="!uiShown">
      <button class="es-rbtn" :title="t('Volver (Esc)')" @click="leave"><i class="es-i es-i-back" aria-hidden="true"></i></button>
      <div class="es-rtitle">
        <strong class="es-ellipsis">{{ item.title }}</strong>
        <small class="es-ellipsis es-muted">{{ chapter || item.author || '' }}</small>
      </div>
      <div class="es-rtools">
        <button class="es-rbtn" :class="{ on: panel === 'toc' }" :title="t('Índice')" @click="toggle('toc')"><i class="es-i es-i-list" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: bookmarked }" :title="bookmarked ? t('Quitar el marcador (b)') : t('Marcar este punto (b)')" @click="toggleBookmark"><i class="es-i" :class="bookmarked ? 'es-i-bookmark-fill' : 'es-i-bookmark'" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: panel === 'notes' }" :title="t('Notas y marcadores ({n})', { n: bookmarks.length })" @click="toggle('notes')"><i class="es-i es-i-note" aria-hidden="true"></i><span v-if="bookmarks.length" class="es-rbadge">{{ bookmarks.length }}</span></button>
        <button v-if="!fixedLayout" class="es-rbtn" :class="{ on: panel === 'settings' }" :title="t('Texto y aspecto')" @click="toggle('settings')"><i class="es-i es-i-font" aria-hidden="true"></i></button>
        <button v-if="store.canFullscreen !== false" class="es-rbtn" :title="fullscreen ? t('Salir de pantalla completa (f)') : t('Pantalla completa (f)')" @click="toggleFullscreen"><i class="es-i" :class="fullscreen ? 'es-i-fs-exit' : 'es-i-fs'" aria-hidden="true"></i></button>
      </div>
    </header>

    <!-- a click here never comes from the page itself (that one stays in its frame): it is the blank around it -->
    <div class="es-bstage" @click="onStageClick">
      <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> {{ t('Abriendo el libro…') }}</div>
      <div v-if="error" class="es-reader-loading">{{ error }}</div>
      <div ref="stage" class="es-bview" :class="turnClass" :style="{ left: `${settings.margin}%`, right: `${settings.margin}%` }"></div>
      <!-- what to do with a selected passage -->
      <div v-if="selection" class="es-selbar" :style="{ left: `${selection.x}px`, top: `${selection.y}px` }" @click.stop>
        <button class="es-chip" @click="highlight()"><i class="es-i es-i-marker" aria-hidden="true"></i> {{ t('Subrayar') }}</button>
        <button class="es-chip" @click="startNote()"><i class="es-i es-i-note" aria-hidden="true"></i> {{ t('Nota') }}</button>
        <button class="es-chip" @click="clearSelection()"><i class="es-i es-i-close" aria-hidden="true"></i></button>
      </div>
    </div>

    <footer class="es-rbottom" :inert="!uiShown">
      <button class="es-rbtn" :title="t('Anterior')" @click.stop="prev"><i class="es-i es-i-prev" aria-hidden="true"></i></button>
      <span class="es-rslider-wrap">
        <input class="es-rslider" type="range" min="0" max="1000" :value="Math.round(percent * 1000)" :aria-label="t('Posición en el libro')" :disabled="!ready"
               @change="goPercent(Number(($event.target as HTMLInputElement).value) / 1000)" />
        <span v-for="t in ticks" :key="t.id" class="es-rtick" :class="`es-rtick-${t.kind}`" :style="{ left: `${t.at}%` }" :title="t.title" @click.stop="goToBookmark(t.bookmark)"></span>
      </span>
      <span class="es-rcount es-rcount-wide">
        <template v-if="ready && total">{{ t('pág. {page} / {total}', { page: location + 1, total }) }} · </template>{{ Math.round(percent * 100) }} %
      </span>
      <button class="es-rbtn" :title="t('Siguiente')" @click.stop="next"><i class="es-i es-i-next" aria-hidden="true"></i></button>
    </footer>

    <aside v-if="panel === 'toc'" class="es-rpanel" @click.stop>
      <h3>{{ t('Índice') }}</h3>
      <p v-if="!toc.length" class="es-muted es-small">{{ t('Este libro no trae índice.') }}</p>
      <ul class="es-toc">
        <li v-for="(t, i) in toc" :key="`${i}-${t.href}`" :class="{ on: t.href === chapterHref }" :style="{ paddingLeft: `${t.depth * 14}px` }"><a href="#" @click.prevent="goTo(t.href)">{{ t.label }}</a></li>
      </ul>
    </aside>

    <aside v-if="panel === 'notes'" class="es-rpanel" @click.stop>
      <h3>{{ t('Notas y marcadores') }}</h3>
      <form v-if="noting" class="es-noteform" @submit.prevent="saveNote">
        <q v-if="noting.excerpt" class="es-note-excerpt">{{ noting.excerpt }}</q>
        <textarea v-model="noting.text" class="es-note-edit" rows="4" :placeholder="t('Tu nota')" autofocus @keydown.esc="noting = null" @keydown.ctrl.enter="saveNote"></textarea>
        <div class="es-note-actions">
          <button class="es-chip" type="submit">{{ t('Guardar') }}</button>
          <button class="es-chip" type="button" @click="noting = null">{{ t('Cancelar') }}</button>
        </div>
      </form>
      <NotesPanel :items="bookmarks" :hint="t('Selecciona un trozo de texto para subrayarlo o anotarlo; el marcador (b) guarda el punto exacto.')" :place="placeOf"
                  @go="goToBookmark" @remove="removeBookmark" @save="saveBookmarkNote" />
    </aside>

    <aside v-if="panel === 'settings'" class="es-rpanel" @click.stop>
      <h3>{{ t('Texto') }}</h3>
      <NumberField :model-value="settings.fontSize" :label="t('Tamaño')" unit="%" :min="50" :max="300" :step="5" :presets="[80, 100, 120, 140, 170]" @update:model-value="set('fontSize', $event)" />
      <NumberField :model-value="settings.lineHeight" :label="t('Interlineado')" :min="0.9" :max="3" :step="0.05" :presets="[1.2, 1.4, 1.6, 1.8, 2]" @update:model-value="set('lineHeight', $event)" />
      <NumberField :model-value="settings.margin" :label="t('Márgenes')" :unit="t('% a cada lado')" :min="0" :max="25" :step="1" :presets="[0, 4, 8, 12]" @update:model-value="set('margin', $event)" />
      <div class="es-rfield">
        <span>{{ t('Letra') }}</span>
        <select class="es-rselect" :value="settings.font" @change="set('font', ($event.target as HTMLSelectElement).value)">
          <option value="publisher">{{ t('La del libro') }}</option>
          <optgroup v-for="group in FONT_GROUPS" :key="group.kind" :label="t(group.label)">
            <option v-for="f in group.fonts" :key="f.id" :value="f.id">{{ t(f.label) }}</option>
          </optgroup>
          <option value="custom">{{ t('Otra (escríbela)…') }}</option>
        </select>
        <input v-if="settings.font === 'custom'" class="es-rtext" :value="settings.customFont" :placeholder="t('Nombre de la fuente instalada, p. ej. Bookerly')"
               @change="set('customFont', ($event.target as HTMLInputElement).value)" />
        <small class="es-muted es-tiny">{{ t('Se usan las fuentes que tenga este dispositivo; si falta una, se toma la más parecida.') }}</small>
      </div>
      <h3>{{ t('Aspecto') }}</h3>
      <div class="es-rfield">
        <span>{{ t('Tema') }}</span>
        <div class="es-chips">
          <button v-for="th in THEMES" :key="th.id" class="es-chip" :class="{ on: settings.theme === th.id }" @click="set('theme', th.id)">{{ t(th.label) }}</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>{{ t('Modo') }}</span>
        <div class="es-chips">
          <button class="es-chip" :class="{ on: settings.flow === 'paginated' }" @click="set('flow', 'paginated')">{{ t('Páginas') }}</button>
          <button class="es-chip" :class="{ on: settings.flow === 'scrolled' }" @click="set('flow', 'scrolled')">{{ t('Desplazamiento') }}</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>{{ t('Al pasar página') }}</span>
        <div class="es-chips">
          <button v-for="a in ANIMATIONS" :key="a.id" class="es-chip" :class="{ on: settings.animation === a.id }" @click="set('animation', a.id)">{{ t(a.label) }}</button>
        </div>
      </div>
      <p class="es-muted es-tiny es-rkeys">{{ t('Teclas: ← → espacio · b marcador · n nota · f pantalla completa · Esc volver') }}</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import { TURN_EVENT } from '../lib/native'
import type { Bookmark, ItemDetail } from '../lib/api'
import { openBook } from '../lib/books'
import { t } from '../lib/i18n'
import { FONTS, fontStack, loadBookSettings, saveBookSettings, useStore, type BookSettings } from '../lib/store'
import NotesPanel from './NotesPanel.vue'
import NumberField from './NumberField.vue'

/**
 * The book reader: EPUB, MOBI, AZW/AZW3, FB2, FBZ and TXT, laid out by foliate-js (see lib/books.ts),
 * paginated or scrolled, with the reader's own type, theme and margins (a fixed-layout EPUB, a manga
 * or a picture book, keeps its own pages). The file comes whole (from the service, the shelf of this
 * device or a download). A selected passage can be highlighted or annotated (kept as an EPUB CFI
 * range); the place (a CFI) is saved a moment after every move and when leaving.
 */
const props = defineProps<{ item: ItemDetail }>()
const emit = defineEmits<{ changed: [] }>()
const store = useStore()
const { item } = props

const THEMES = [{ id: 'light', label: 'Claro' }, { id: 'sepia', label: 'Sepia' }, { id: 'dark', label: 'Oscuro' }] as const
const ANIMATIONS = [{ id: 'none', label: 'De golpe' }, { id: 'fade', label: 'Fundido' }, { id: 'slide', label: 'Deslizar' }] as const
const FONT_GROUPS = [
  { kind: 'serif', label: 'Con remates (serif)', fonts: FONTS.filter((f) => f.kind === 'serif') },
  { kind: 'sans', label: 'Sin remates (sans)', fonts: FONTS.filter((f) => f.kind === 'sans') },
  { kind: 'otras', label: 'Otras', fonts: FONTS.filter((f) => f.kind === 'otras') }
]
const THEME_COLORS: Record<BookSettings['theme'], { bg: string; fg: string; link: string; scheme: string }> = {
  light: { bg: '#ffffff', fg: '#1b1b1f', link: '#b86a1a', scheme: 'light' },
  sepia: { bg: '#f4ecd8', fg: '#4f3d2a', link: '#9a5a16', scheme: 'light' },
  dark: { bg: '#141416', fg: '#d6d6dc', link: '#e8a257', scheme: 'dark' }
}
const HIGHLIGHT = '#d9822b'

const settings = reactive<BookSettings>(loadBookSettings())
const root = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const loading = ref(true)
const error = ref('')
const ready = ref(false)
const fixedLayout = ref(false)
const percent = ref(item.progress?.percent || 0)
const location = ref(0)
const total = ref(0)
const chapter = ref('')
const chapterHref = ref('')
const toc = ref<{ label: string; href: string; depth: number }[]>([])
const bookmarks = ref<Bookmark[]>(item.bookmarks || [])
const panel = ref('')
const uiShown = ref(true)
const fullscreen = ref(false)
const turnClass = ref('')
const selection = ref<{ cfiRange: string; text: string; x: number; y: number; doc: Document } | null>(null)
const noting = ref<{ cfiRange: string | null; excerpt: string; text: string } | null>(null)
/** where each bookmark is along the book (0–1), by its location: worked out once the book is open */
const fractions = ref<Record<string, number>>({})
const view = shallowRef<any>(null)
let CFI: any = null
let cfi = item.progress?.location || ''
let uiTimer: any = null
let saveTimer: any = null
let atEnd = false
let turning = false
let annotationHit = 0

/** the point where a location starts (a highlight's range CFI starts at its first character) */
const startOf = (loc: string) => (loc.includes(',') && CFI ? CFI.collapse(loc) : loc)
const isRange = (loc: string | null | undefined) => !!loc && loc.includes(',')

const bookmarked = computed(() => bookmarks.value.some((b) => b.kind === 'bookmark' && b.location === cfi))
/** Where the bookmarks, notes and highlights are, along the slider. */
const ticks = computed(() => bookmarks.value.filter((b) => b.location && fractions.value[b.location] !== undefined).map((b) => {
  const what = b.kind === 'bookmark' ? t('Marcador') : b.kind === 'note' ? t('Nota') : t('Subrayado')
  return { id: b.id, bookmark: b, kind: b.kind, at: fractions.value[b.location!] * 100,
    title: `${what}${b.excerpt ? `: ${b.excerpt.slice(0, 80)}` : ''}${b.note ? ` — ${b.note.slice(0, 80)}` : ''}` }
}))

function set<K extends keyof BookSettings>(key: K, value: BookSettings[K]) {
  settings[key] = value
  saveBookSettings(settings)
}
function toggle(name: string) {
  panel.value = panel.value === name ? '' : name
  if (panel.value) { uiShown.value = true; clearTimeout(uiTimer) }
}

// ---- the look: the reader's type, spacing and theme over the book's own styles ----
function css(): string {
  const c = THEME_COLORS[settings.theme]
  const font = fontStack(settings)
  return `
    html { color-scheme: ${c.scheme}; font-size: ${settings.fontSize}% !important; }
    html, body { background: ${c.bg} !important; color: ${c.fg} !important; }
    a:any-link { color: ${c.link} !important; }
    body, p, li, blockquote, dd, div { line-height: ${settings.lineHeight} !important; }
    p, li, blockquote, dd { hyphens: auto; -webkit-hyphens: auto; widows: 2; orphans: 2; }
    pre { white-space: pre-wrap !important; }
    ${font ? `body, body *:not(pre):not(code):not(kbd):not(samp) { font-family: ${font} !important; }` : ''}
    ${settings.theme === 'dark' ? 'img, svg, video { filter: brightness(.88); }' : ''}
    aside[epub|type~="footnote"], aside[epub|type~="endnote"], aside[epub|type~="rearnote"] { display: none; }
  `
}
function applyLook() {
  const v = view.value
  if (!v?.renderer) return
  v.renderer.setStyles?.(`@namespace epub "http://www.idpf.org/2007/ops";\n${css()}`)
  v.style.setProperty('--overlayer-highlight-opacity', settings.theme === 'dark' ? '.4' : '.32')
  v.style.setProperty('--overlayer-highlight-blend-mode', settings.theme === 'dark' ? 'normal' : 'multiply')
}
function applyLayout() {
  const r = view.value?.renderer
  if (!r || fixedLayout.value) return
  r.setAttribute('flow', settings.flow)
  r.setAttribute('gap', '6%')
  r.setAttribute('margin', '8px')
  r.setAttribute('max-inline-size', '760px')
  r.setAttribute('max-column-count', '2')
  if (settings.animation === 'slide') r.setAttribute('animated', '')
  else r.removeAttribute('animated')
}

// ---- opening ----
async function open() {
  try {
    const [, cfiModule] = await Promise.all([import('../vendor/foliate-js/view.js'), import('../vendor/foliate-js/epubcfi.js')])
    CFI = cfiModule
    const { Overlayer } = await import('../vendor/foliate-js/overlayer.js')
    const blob = await store.api.blob(store.api.filePath(item.id))
    const book = await openBook(blob, item.format, item.title)
    const v: any = document.createElement('foliate-view')
    v.style.cssText = 'display:block;width:100%;height:100%'
    stage.value!.append(v)
    view.value = v
    v.addEventListener('relocate', (e: CustomEvent) => onRelocate(e.detail))
    v.addEventListener('load', (e: CustomEvent) => onLoad(e.detail.doc, e.detail.index))
    v.addEventListener('create-overlay', () => { for (const b of bookmarks.value) paint(b) })
    v.addEventListener('draw-annotation', (e: CustomEvent) => e.detail.draw(Overlayer.highlight, { color: HIGHLIGHT }))
    v.addEventListener('show-annotation', () => { annotationHit = Date.now(); panel.value = 'notes'; uiShown.value = true })
    v.addEventListener('external-link', (e: CustomEvent) => { e.preventDefault(); window.open(e.detail.a.href, '_blank', 'noopener') })
    await v.open(book)
    fixedLayout.value = !!v.isFixedLayout
    applyLayout()
    applyLook()
    const flat: typeof toc.value = []
    const walk = (items: any[], depth: number) => { for (const t of items || []) { flat.push({ label: String(t.label || '').trim(), href: t.href, depth }); if (t.subitems?.length) walk(t.subitems, depth + 1) } }
    walk(book.toc, 0)
    toc.value = flat.filter((t) => t.label && t.href)
    try {
      await v.init({ lastLocation: cfi || undefined })
    } catch (_) {
      await v.init({})          // a place that no longer resolves: from the start
    }
    ready.value = true
    locateBookmarks()
  } catch (err: any) {
    error.value = t('No se pudo abrir el libro: {error}', { error: err?.message || err })
  }
  loading.value = false
}

function onRelocate(detail: any) {
  if (detail.cfi) cfi = startOf(detail.cfi)
  if (typeof detail.fraction === 'number') percent.value = detail.fraction
  location.value = Math.max(0, detail.location?.current || 0)
  total.value = detail.location?.total || 0
  atEnd = !!view.value?.renderer?.atEnd
  chapter.value = detail.tocItem?.label?.trim() || ''
  chapterHref.value = detail.tocItem?.href || ''
  if (selection.value) selection.value = null
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(), 1500)
}

/** Each section's page, as it loads: keys, taps (turn or show the chrome) and selections. */
function onLoad(doc: Document, index: number) {
  doc.addEventListener('keydown', onKey)
  doc.addEventListener('click', (event: MouseEvent) => onTap(event, doc))
  const check = () => setTimeout(() => checkSelection(doc, index), 10)
  doc.addEventListener('pointerup', check)
  doc.addEventListener('touchend', check)
  doc.addEventListener('keyup', (e: KeyboardEvent) => { if (e.shiftKey) check() })
}

function onTap(event: MouseEvent, doc: Document) {
  if (event.defaultPrevented || Date.now() - annotationHit < 120) return       // a link, a highlight
  if (!doc.getSelection()?.isCollapsed) return
  if (selection.value) { clearSelection(); return }
  if (panel.value) { panel.value = ''; return }
  const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect()
  tapAt((frame?.left || 0) + event.clientX)
}
/** A click on the blank around the text (the side margins, the gap foliate-js leaves round the columns). */
function onStageClick(event: MouseEvent) {
  if (event.defaultPrevented || Date.now() - annotationHit < 120) return
  if (selection.value) { clearSelection(); return }
  if (panel.value) { panel.value = ''; return }
  tapAt(event.clientX)
}
/** A tap at `clientX` across the reader: the sides turn the page, the middle shows or hides the chrome. */
function tapAt(clientX: number) {
  const box = root.value!.getBoundingClientRect()
  const x = (clientX - box.left) / box.width
  // after a touch foliate-js snaps to the page under the finger on the next frame: turning before that
  // makes the snap pull the page back, so the turn waits for it
  const later = (go: () => void) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(go, 30)))
  if (settings.flow === 'paginated' && x < 0.25) later(prev)
  else if (settings.flow === 'paginated' && x > 0.75) later(next)
  else toggleUi()
}

function checkSelection(doc: Document, index: number) {
  const sel = doc.getSelection()
  const text = String(sel?.toString() || '').trim()
  if (!sel || sel.isCollapsed || !sel.rangeCount || !text) return
  const range = sel.getRangeAt(0)
  const rect = range.getBoundingClientRect()
  const frame = (doc.defaultView?.frameElement as HTMLElement | null)?.getBoundingClientRect() || { left: 0, top: 0 }
  const box = stage.value!.getBoundingClientRect()
  selection.value = { cfiRange: view.value.getCFI(index, range), text, doc,
    x: Math.max(8, Math.min(box.width - 240, rect.left + frame.left - box.left + rect.width / 2 - 110)),
    y: Math.max(8, rect.top + frame.top - box.top - 48) }
}

// ---- moving, with a short animation when asked (sliding is foliate-js' own) ----
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function turn(dir: 1 | -1) {
  const v = view.value
  if (!v || turning) return
  const go = () => (dir > 0 ? v.next() : v.prev())
  if (settings.animation !== 'fade' || settings.flow === 'scrolled' || fixedLayout.value) { await go(); return }
  turning = true
  try {
    turnClass.value = 'es-turn-out-fade'
    await wait(130)
    await go()
    turnClass.value = 'es-turn-in-fade'
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  } finally {
    turnClass.value = ''
    turning = false
  }
}
function next() { turn(1) }
function prev() { turn(-1) }
function goTo(target: string) {
  if (target) view.value?.goTo(target)
  panel.value = ''
}
function goPercent(p: number) {
  if (ready.value) view.value?.goToFraction(p)
}

// ---- progress ----
function save(finished = false) {
  clearTimeout(saveTimer)
  if (!cfi || !ready.value) return
  const done = finished || atEnd || percent.value >= 0.995
  store.api.setProgress(item.id, { location: cfi, percent: done ? 1 : percent.value, finished: done, device: 'web' }).then(() => emit('changed')).catch(() => {})
}

// ---- bookmarks, highlights and notes ----
/** Where a location is along the whole book: its section's share plus how far into the section's
 * text it starts. */
async function fractionOf(loc: string, docs: Map<number, Document>): Promise<number | null> {
  const v = view.value
  try {
    const { index, anchor } = v.resolveNavigation(startOf(loc))
    const bounds = v.getSectionFractions()
    const from = bounds[index] ?? 0
    const to = bounds[index + 1] ?? from
    let doc = docs.get(index)
    if (!doc) { doc = await v.book.sections[index].createDocument(); docs.set(index, doc!) }
    const target = anchor(doc)
    const node: Node | null = target instanceof Range ? target.startContainer : target
    if (!node || !doc!.body) return from
    let before = 0
    let all = 0
    let found = false
    const walker = doc!.createTreeWalker(doc!.body, NodeFilter.SHOW_TEXT)
    for (let t = walker.nextNode(); t; t = walker.nextNode()) {
      const n = t.textContent?.length || 0
      if (!found && (t === node || node.contains(t) || (node.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING))) {
        found = true
        if (t === node && target instanceof Range) before += target.startOffset
      }
      if (!found) before += n
      all += n
    }
    return Math.min(1, from + (to - from) * (all ? before / all : 0))
  } catch (_) {
    return null
  }
}
async function locateBookmarks() {
  if (!ready.value) return
  const docs = new Map<number, Document>()
  const found: Record<string, number> = { ...fractions.value }
  for (const b of bookmarks.value) {
    if (!b.location || found[b.location] !== undefined) continue
    const at = await fractionOf(b.location, docs)
    if (at !== null) found[b.location] = at
  }
  fractions.value = found
}
function placeOf(b: Bookmark): string {
  if (b.kind === 'bookmark') return b.excerpt || t('Marcador')
  const at = b.location ? fractions.value[b.location] : undefined
  if (at !== undefined && total.value) return t('Pág. {page}', { page: Math.min(total.value, Math.floor(at * total.value) + 1) })
  return b.kind === 'note' ? t('Nota') : t('Subrayado')
}
function paint(b: Bookmark) {
  if (b.kind === 'bookmark' || !isRange(b.location)) return
  view.value?.addAnnotation({ value: b.location }).catch?.(() => {})
}
function unpaint(b: Bookmark) {
  if (isRange(b.location)) view.value?.deleteAnnotation({ value: b.location }).catch?.(() => {})
}
async function toggleBookmark() {
  if (!cfi) return
  try {
    const mine = bookmarks.value.find((b) => b.kind === 'bookmark' && b.location === cfi)
    if (mine) {
      await store.api.deleteBookmark(mine.id)
      bookmarks.value = bookmarks.value.filter((b) => b.id !== mine.id)
      store.notify(t('Marcador quitado.'))
    } else {
      const where = [chapter.value, total.value ? t('pág. {page}', { page: location.value + 1 }) : `${Math.round(percent.value * 100)} %`].filter(Boolean).join(' · ')
      bookmarks.value = [...bookmarks.value, await store.api.addBookmark(item.id, { kind: 'bookmark', location: cfi, excerpt: where })]
      store.notify(t('Punto marcado.'))
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function clearSelection() {
  try { selection.value?.doc.getSelection()?.removeAllRanges() } catch (_) { /* nothing */ }
  selection.value = null
}
async function highlight() {
  const sel = selection.value
  if (!sel) return
  clearSelection()
  try {
    const made = await store.api.addBookmark(item.id, { kind: 'highlight', location: sel.cfiRange, excerpt: sel.text.slice(0, 2000) })
    bookmarks.value = [...bookmarks.value, made]
    paint(made)
    store.notify(t('Subrayado.'))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function startNote() {
  const sel = selection.value
  noting.value = { cfiRange: sel?.cfiRange || null, excerpt: sel?.text.slice(0, 2000) || '', text: '' }
  clearSelection()
  panel.value = 'notes'
  uiShown.value = true
  clearTimeout(uiTimer)
}
async function saveNote() {
  const n = noting.value
  if (!n) return
  try {
    const made = await store.api.addBookmark(item.id, { kind: 'note', location: n.cfiRange || cfi, excerpt: n.excerpt || chapter.value, note: n.text.trim() })
    bookmarks.value = [...bookmarks.value, made]
    paint(made)
    noting.value = null
    store.notify(t('Nota guardada.'))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function removeBookmark(b: Bookmark) {
  try {
    await store.api.deleteBookmark(b.id)
    unpaint(b)
    bookmarks.value = bookmarks.value.filter((x) => x.id !== b.id)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function saveBookmarkNote(b: Bookmark, note: string) {
  try {
    const kind = b.kind === 'highlight' && note ? 'note' : b.kind
    const changed = await store.api.changeBookmark(item.id, b.id, { note, kind })
    bookmarks.value = bookmarks.value.map((x) => (x.id === b.id ? changed : x))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function goToBookmark(b: Bookmark) {
  if (b.location) view.value?.goTo(startOf(b.location))
  panel.value = ''
}

// ---- keys and chrome ----
function onKey(event: KeyboardEvent) {
  const k = event.key
  if ((event.target as HTMLElement | null)?.tagName === 'TEXTAREA' || (event.target as HTMLElement | null)?.tagName === 'INPUT') return
  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') { if (view.value?.book?.dir === 'rtl' && k === 'ArrowRight') prev(); else next() }
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') { if (view.value?.book?.dir === 'rtl' && k === 'ArrowLeft') next(); else prev() }
  else if (k === 'b') toggleBookmark()
  else if (k === 'n') startNote()
  else if (k === 'f') toggleFullscreen()
  else if (k === 'Escape') { if (selection.value) clearSelection(); else if (panel.value) panel.value = ''; else if (fullscreen.value) document.exitFullscreen(); else leave() }
  else return
  event.preventDefault?.()
}
function showUi() {
  uiShown.value = true
  clearTimeout(uiTimer)
  if (!panel.value) uiTimer = setTimeout(() => { if (!panel.value) uiShown.value = false }, 2500)
}
function toggleUi() {
  uiShown.value = !uiShown.value
  clearTimeout(uiTimer)
}
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else root.value?.requestFullscreen?.()
}
function onFullscreen() { fullscreen.value = !!document.fullscreenElement }
function leave() {
  save()
  store.back()
}

watch(() => [settings.theme, settings.fontSize, settings.font, settings.customFont, settings.lineHeight], applyLook)
watch(() => [settings.flow, settings.animation], applyLayout)
watch(() => bookmarks.value.length, locateBookmarks)

/** a page turn from outside (the volume keys) */
function onTurn(e: Event) { if ((e as CustomEvent).detail > 0) next(); else prev() }
onMounted(() => {
  window.addEventListener(TURN_EVENT, onTurn)
  document.addEventListener('fullscreenchange', onFullscreen)
  root.value?.focus()
  showUi()
  open()
})
onBeforeUnmount(() => {
  window.removeEventListener(TURN_EVENT, onTurn)
  clearTimeout(uiTimer)
  clearTimeout(saveTimer)
  document.removeEventListener('fullscreenchange', onFullscreen)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  save()
  const v = view.value
  if (v) {
    try { v.close() } catch (_) { /* half open */ }
    try { v.book?.destroy?.() } catch (_) { /* nothing to free */ }
    v.remove()
  }
})
</script>
