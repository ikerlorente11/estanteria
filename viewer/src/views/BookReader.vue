<template>
  <div ref="root" class="es-reader es-book" :class="[`es-book-${settings.theme}`, { 'es-ui-hidden': !uiShown }]" tabindex="0" @keydown="onKey" @mousemove="showUi">
    <header class="es-rtop" :inert="!uiShown">
      <button class="es-rbtn" title="Volver (Esc)" @click="leave"><i class="es-i es-i-back" aria-hidden="true"></i></button>
      <div class="es-rtitle">
        <strong class="es-ellipsis">{{ item.title }}</strong>
        <small class="es-ellipsis es-muted">{{ chapter || item.author || '' }}</small>
      </div>
      <div class="es-rtools">
        <button class="es-rbtn" :class="{ on: panel === 'toc' }" title="Índice" @click="toggle('toc')"><i class="es-i es-i-list" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: bookmarked }" :title="bookmarked ? 'Quitar el marcador (b)' : 'Marcar este punto (b)'" @click="toggleBookmark"><i class="es-i" :class="bookmarked ? 'es-i-bookmark-fill' : 'es-i-bookmark'" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: panel === 'notes' }" :title="`Notas y marcadores (${bookmarks.length})`" @click="toggle('notes')"><i class="es-i es-i-note" aria-hidden="true"></i><span v-if="bookmarks.length" class="es-rbadge">{{ bookmarks.length }}</span></button>
        <button class="es-rbtn" :class="{ on: panel === 'settings' }" title="Texto y aspecto" @click="toggle('settings')"><i class="es-i es-i-font" aria-hidden="true"></i></button>
        <button class="es-rbtn" :title="fullscreen ? 'Salir de pantalla completa (f)' : 'Pantalla completa (f)'" @click="toggleFullscreen"><i class="es-i" :class="fullscreen ? 'es-i-fs-exit' : 'es-i-fs'" aria-hidden="true"></i></button>
      </div>
    </header>

    <div class="es-bstage">
      <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> Abriendo el libro…</div>
      <div v-if="error" class="es-reader-loading">{{ error }}</div>
      <div ref="view" class="es-bview" :class="turnClass" :style="{ left: `${settings.margin}%`, right: `${settings.margin}%` }"></div>
      <!-- what to do with a selected passage -->
      <div v-if="selection" class="es-selbar" :style="{ left: `${selection.x}px`, top: `${selection.y}px` }" @click.stop>
        <button class="es-chip" @click="highlight()"><i class="es-i es-i-marker" aria-hidden="true"></i> Subrayar</button>
        <button class="es-chip" @click="startNote()"><i class="es-i es-i-note" aria-hidden="true"></i> Nota</button>
        <button class="es-chip" @click="clearSelection()"><i class="es-i es-i-close" aria-hidden="true"></i></button>
      </div>
    </div>

    <footer class="es-rbottom" :inert="!uiShown">
      <button class="es-rbtn" title="Anterior" @click.stop="prev"><i class="es-i es-i-prev" aria-hidden="true"></i></button>
      <span class="es-rslider-wrap">
        <input class="es-rslider" type="range" min="0" max="1000" :value="Math.round(percent * 1000)" aria-label="Posición en el libro" :disabled="!located"
               @change="goPercent(Number(($event.target as HTMLInputElement).value) / 1000)" />
        <span v-for="t in ticks" :key="t.id" class="es-rtick" :class="`es-rtick-${t.kind}`" :style="{ left: `${t.at}%` }" :title="t.title" @click.stop="goToBookmark(t.bookmark)"></span>
      </span>
      <span class="es-rcount es-rcount-wide">
        <template v-if="located && total">pág. {{ location + 1 }} / {{ total }} · </template>{{ Math.round(percent * 100) }} %
      </span>
      <button class="es-rbtn" title="Siguiente" @click.stop="next"><i class="es-i es-i-next" aria-hidden="true"></i></button>
    </footer>

    <aside v-if="panel === 'toc'" class="es-rpanel" @click.stop>
      <h3>Índice</h3>
      <p v-if="!toc.length" class="es-muted es-small">Este libro no trae índice.</p>
      <ul class="es-toc">
        <li v-for="t in toc" :key="t.href" :style="{ paddingLeft: `${t.depth * 14}px` }"><a href="#" @click.prevent="goTo(t.href)">{{ t.label }}</a></li>
      </ul>
    </aside>

    <aside v-if="panel === 'notes'" class="es-rpanel" @click.stop>
      <h3>Notas y marcadores</h3>
      <form v-if="noting" class="es-noteform" @submit.prevent="saveNote">
        <q v-if="noting.excerpt" class="es-note-excerpt">{{ noting.excerpt }}</q>
        <textarea v-model="noting.text" class="es-note-edit" rows="4" placeholder="Tu nota" autofocus @keydown.esc="noting = null" @keydown.ctrl.enter="saveNote"></textarea>
        <div class="es-note-actions">
          <button class="es-chip" type="submit">Guardar</button>
          <button class="es-chip" type="button" @click="noting = null">Cancelar</button>
        </div>
      </form>
      <NotesPanel :items="bookmarks" hint="Selecciona un trozo de texto para subrayarlo o anotarlo; el marcador (b) guarda el punto exacto." :place="placeOf"
                  @go="goToBookmark" @remove="removeBookmark" @save="saveBookmarkNote" />
    </aside>

    <aside v-if="panel === 'settings'" class="es-rpanel" @click.stop>
      <h3>Texto</h3>
      <NumberField :model-value="settings.fontSize" label="Tamaño" unit="%" :min="50" :max="300" :step="5" :presets="[80, 100, 120, 140, 170]" @update:model-value="set('fontSize', $event)" />
      <NumberField :model-value="settings.lineHeight" label="Interlineado" :min="0.9" :max="3" :step="0.05" :presets="[1.2, 1.4, 1.6, 1.8, 2]" @update:model-value="set('lineHeight', $event)" />
      <NumberField :model-value="settings.margin" label="Márgenes" unit="% a cada lado" :min="0" :max="25" :step="1" :presets="[0, 4, 8, 12]" @update:model-value="set('margin', $event)" />
      <div class="es-rfield">
        <span>Letra</span>
        <select class="es-rselect" :value="settings.font" @change="set('font', ($event.target as HTMLSelectElement).value)">
          <option value="publisher">La del libro</option>
          <optgroup v-for="group in FONT_GROUPS" :key="group.kind" :label="group.label">
            <option v-for="f in group.fonts" :key="f.id" :value="f.id">{{ f.label }}</option>
          </optgroup>
          <option value="custom">Otra (escríbela)…</option>
        </select>
        <input v-if="settings.font === 'custom'" class="es-rtext" :value="settings.customFont" placeholder="Nombre de la fuente instalada, p. ej. Bookerly"
               @change="set('customFont', ($event.target as HTMLInputElement).value)" />
        <small class="es-muted es-tiny">Se usan las fuentes que tenga este dispositivo; si falta una, se toma la más parecida.</small>
      </div>
      <h3>Aspecto</h3>
      <div class="es-rfield">
        <span>Tema</span>
        <div class="es-chips">
          <button v-for="t in THEMES" :key="t.id" class="es-chip" :class="{ on: settings.theme === t.id }" @click="set('theme', t.id)">{{ t.label }}</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>Modo</span>
        <div class="es-chips">
          <button class="es-chip" :class="{ on: settings.flow === 'paginated' }" @click="set('flow', 'paginated')">Páginas</button>
          <button class="es-chip" :class="{ on: settings.flow === 'scrolled' }" @click="set('flow', 'scrolled')">Desplazamiento</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>Al pasar página</span>
        <div class="es-chips">
          <button v-for="a in ANIMATIONS" :key="a.id" class="es-chip" :class="{ on: settings.animation === a.id }" @click="set('animation', a.id)">{{ a.label }}</button>
        </div>
      </div>
      <p class="es-muted es-tiny es-rkeys">Teclas: ← → espacio · b marcador · n nota · f pantalla completa · Esc volver</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import ePub, { type Book, type Rendition } from 'epubjs'
import type { Bookmark, ItemDetail } from '../lib/api'
import { FONTS, fontStack, loadBookSettings, saveBookSettings, useStore, type BookSettings } from '../lib/store'
import NotesPanel from './NotesPanel.vue'
import NumberField from './NumberField.vue'

/**
 * The book reader (EPUB): the file comes whole from the service and epub.js lays it out here,
 * paginated or scrolled, with the reader's own type, theme and margins. A selected passage can be
 * highlighted or annotated (kept in the cloud as a CFI range); the place (an EPUB CFI) is saved a
 * moment after every move and when leaving.
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
const THEME_STYLES: Record<string, Record<string, Record<string, string>>> = {
  light: { body: { background: '#ffffff', color: '#1b1b1f' }, a: { color: '#b86a1a' } },
  sepia: { body: { background: '#f4ecd8', color: '#4f3d2a' }, a: { color: '#9a5a16' } },
  dark: { body: { background: '#141416', color: '#d6d6dc' }, a: { color: '#e8a257' } }
}
const HIGHLIGHT = { fill: '#d9822b', 'fill-opacity': '0.32', 'mix-blend-mode': 'multiply' }

const settings = reactive<BookSettings>(loadBookSettings())
const root = ref<HTMLElement>()
const view = ref<HTMLElement>()
const loading = ref(true)
const error = ref('')
const percent = ref(item.progress?.percent || 0)
const located = ref(false)
const location = ref(0)
const total = ref(0)
const chapter = ref('')
const toc = ref<{ label: string; href: string; depth: number }[]>([])
const bookmarks = ref<Bookmark[]>(item.bookmarks || [])
const panel = ref('')
const uiShown = ref(true)
const fullscreen = ref(false)
const turnClass = ref('')
const selection = ref<{ cfiRange: string; text: string; x: number; y: number; contents: any } | null>(null)
const noting = ref<{ cfiRange: string | null; excerpt: string; text: string } | null>(null)
let book: Book | null = null
let rendition: Rendition | null = null
let cfi = item.progress?.location || ''
let uiTimer: any = null
let saveTimer: any = null
let atEnd = false
let turning = false

const bookmarked = computed(() => bookmarks.value.some((b) => b.kind === 'bookmark' && b.location === cfi))
/** Where the bookmarks, notes and highlights are, along the slider (once the book's positions are known). */
const ticks = computed(() => {
  if (!located.value || !book) return []
  return bookmarks.value.filter((b) => b.location).map((b) => {
    const start = b.location!.includes(',') ? b.location!.replace(/,.*\)$/, ')') : b.location!
    let at = 0
    try { at = (book!.locations.percentageFromCfi(start) || 0) * 100 } catch (_) { return null }
    const what = b.kind === 'bookmark' ? 'Marcador' : b.kind === 'note' ? 'Nota' : 'Subrayado'
    return { id: b.id, bookmark: b, kind: b.kind, at, title: `${what}${b.excerpt ? `: ${b.excerpt.slice(0, 80)}` : ''}${b.note ? ` — ${b.note.slice(0, 80)}` : ''}` }
  }).filter((t): t is NonNullable<typeof t> => !!t)
})

function set<K extends keyof BookSettings>(key: K, value: BookSettings[K]) {
  settings[key] = value
  saveBookSettings(settings)
}
function toggle(name: string) {
  panel.value = panel.value === name ? '' : name
  if (panel.value) { uiShown.value = true; clearTimeout(uiTimer) }
}

function applyLook() {
  if (!rendition) return
  const themes = rendition.themes
  for (const [name, style] of Object.entries(THEME_STYLES)) themes.register(name, style)
  themes.select(settings.theme)
  themes.fontSize(`${settings.fontSize}%`)
  themes.override('line-height', String(settings.lineHeight))
  themes.override('font-family', fontStack(settings))
}

async function open() {
  try {
    const blob = await store.api.blob(store.api.filePath(item.id))
    book = ePub(await blob.arrayBuffer())
    await book.ready
    render()
    const nav = await book.loaded.navigation
    const flat: typeof toc.value = []
    const walk = (items: any[], depth: number) => { for (const t of items) { flat.push({ label: String(t.label || '').trim(), href: t.href, depth }); if (t.subitems?.length) walk(t.subitems, depth + 1) } }
    walk(nav.toc || [], 0)
    toc.value = flat
    // Positions along the whole book (the "pages" and the per cent): a moment of work, in the background.
    book.locations.generate(1000).then(() => {
      located.value = true
      total.value = book!.locations.length()
      if (cfi) place(cfi)
    }).catch(() => {})
  } catch (err: any) {
    error.value = `No se pudo abrir el libro: ${err?.message || err}`
  }
  loading.value = false
}

function place(at: string) {
  if (!book || !located.value) return
  percent.value = book.locations.percentageFromCfi(at) || percent.value
  location.value = Math.max(0, book.locations.locationFromCfi(at) || 0)
}

function render() {
  if (!book || !view.value) return
  rendition?.destroy()
  view.value.innerHTML = ''
  rendition = book.renderTo(view.value, {
    width: '100%', height: '100%',
    flow: settings.flow === 'scrolled' ? 'scrolled-doc' : 'paginated',
    spread: 'auto', minSpreadWidth: 1000, allowScriptedContent: false
  } as any)
  applyLook()
  rendition.on('relocated', (loc: any) => {
    cfi = loc?.start?.cfi || cfi
    atEnd = !!loc?.atEnd
    if (located.value) place(cfi)
    else if (loc?.start?.percentage !== undefined) percent.value = loc.start.percentage
    const href = loc?.start?.href
    chapter.value = toc.value.find((t) => href && t.href.split('#')[0] === href.split('#')[0])?.label || ''
    clearTimeout(saveTimer)
    saveTimer = setTimeout(() => save(), 1500)
  })
  rendition.on('rendered', () => { for (const b of bookmarks.value) paint(b) })
  rendition.on('keyup', onKey)
  rendition.on('selected', (cfiRange: string, contents: any) => {
    const sel = contents.window.getSelection()
    const text = String(sel?.toString() || '').trim()
    if (!text) return
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    const frame = contents.document.defaultView.frameElement?.getBoundingClientRect() || { left: 0, top: 0 }
    const stage = view.value!.getBoundingClientRect()
    selection.value = { cfiRange, text, contents,
      x: Math.max(8, Math.min(stage.width - 240, rect.left + frame.left - stage.left + rect.width / 2 - 110)),
      y: Math.max(8, rect.top + frame.top - stage.top - 48) }
  })
  rendition.on('click', (event: MouseEvent) => {
    if (selection.value) { clearSelection(); return }
    if (panel.value) { panel.value = ''; return }
    const width = (event.view as Window | null)?.innerWidth || view.value!.clientWidth
    const x = event.clientX / width
    if (settings.flow === 'paginated' && x < 0.25) prev()
    else if (settings.flow === 'paginated' && x > 0.75) next()
    else toggleUi()
  })
  rendition.display(cfi || undefined).catch(() => rendition?.display())
}

// ---- moving, with a short animation when asked ----
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function turn(dir: 1 | -1) {
  if (!rendition || turning) return
  const anim = settings.animation
  if (anim === 'none' || settings.flow === 'scrolled') { dir > 0 ? rendition.next() : rendition.prev(); return }
  turning = true
  const way = anim === 'fade' ? 'fade' : dir > 0 ? 'next' : 'prev'
  turnClass.value = `es-turn-out-${way}`
  await wait(130)
  await (dir > 0 ? rendition.next() : rendition.prev())
  turnClass.value = `es-turn-in-${way}`
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  turnClass.value = ''
  turning = false
}
function next() { turn(1) }
function prev() { turn(-1) }
function goTo(target: string) {
  if (target) rendition?.display(target)
  panel.value = ''
}
function goPercent(p: number) {
  if (!book || !located.value) return
  const target = book.locations.cfiFromPercentage(p)
  if (target) rendition?.display(target)
}

// ---- progress ----
function save(finished = false) {
  clearTimeout(saveTimer)
  if (!cfi) return
  const done = finished || atEnd || percent.value >= 0.995
  store.api.setProgress(item.id, { location: cfi, percent: done ? 1 : percent.value, finished: done, device: 'web' }).then(() => emit('changed')).catch(() => {})
}

// ---- bookmarks, highlights and notes ----
function placeOf(b: Bookmark): string {
  if (b.kind === 'bookmark') return b.excerpt || 'Marcador'
  if (located.value && book && b.location) {
    const n = book.locations.locationFromCfi(b.location.replace(/,.*\)$/, ')'))
    if (n >= 0) return `Pág. ${n + 1}`
  }
  return b.kind === 'note' ? 'Nota' : 'Subrayado'
}
function paint(b: Bookmark) {
  if (!rendition || b.kind === 'bookmark' || !b.location || !b.location.includes(',')) return
  try {
    rendition.annotations.remove(b.location, 'highlight')
  } catch (_) { /* not there yet */ }
  try {
    rendition.annotations.highlight(b.location, { id: b.id }, () => { panel.value = 'notes' }, 'es-hl', HIGHLIGHT)
  } catch (_) { /* a passage of a chapter not shown now */ }
}
function unpaint(b: Bookmark) {
  if (rendition && b.location && b.location.includes(',')) {
    try { rendition.annotations.remove(b.location, 'highlight') } catch (_) { /* gone already */ }
  }
}
async function toggleBookmark() {
  if (!cfi) return
  try {
    const mine = bookmarks.value.find((b) => b.kind === 'bookmark' && b.location === cfi)
    if (mine) {
      await store.api.deleteBookmark(mine.id)
      bookmarks.value = bookmarks.value.filter((b) => b.id !== mine.id)
      store.notify('Marcador quitado.')
    } else {
      const where = [chapter.value, located.value ? `pág. ${location.value + 1}` : `${Math.round(percent.value * 100)} %`].filter(Boolean).join(' · ')
      bookmarks.value = [...bookmarks.value, await store.api.addBookmark(item.id, { kind: 'bookmark', location: cfi, excerpt: where })]
      store.notify('Punto marcado.')
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function clearSelection() {
  try { selection.value?.contents.window.getSelection()?.removeAllRanges() } catch (_) { /* nothing */ }
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
    store.notify('Subrayado.')
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
    store.notify('Nota guardada.')
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
  if (b.location) rendition?.display(b.location.includes(',') ? b.location.replace(/,.*\)$/, ')') : b.location)
  panel.value = ''
}

// ---- keys and chrome ----
function onKey(event: KeyboardEvent) {
  const k = event.key
  if ((event.target as HTMLElement | null)?.tagName === 'TEXTAREA' || (event.target as HTMLElement | null)?.tagName === 'INPUT') return
  if (k === 'ArrowRight' || k === ' ' || k === 'PageDown') next()
  else if (k === 'ArrowLeft' || k === 'PageUp' || k === 'Backspace') prev()
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
watch(() => settings.flow, render)
watch(() => settings.margin, () => setTimeout(() => (rendition as any)?.resize?.(), 60))

onMounted(() => {
  document.addEventListener('fullscreenchange', onFullscreen)
  root.value?.focus()
  showUi()
  open()
})
onBeforeUnmount(() => {
  clearTimeout(uiTimer)
  clearTimeout(saveTimer)
  document.removeEventListener('fullscreenchange', onFullscreen)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  save()
  rendition?.destroy()
  book?.destroy()
})
</script>
