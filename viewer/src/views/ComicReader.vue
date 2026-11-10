<template>
  <div ref="root" class="es-reader" :class="[`es-bg-${settings.background}`, { 'es-ui-hidden': !uiShown, 'es-strip-mode': settings.mode === 'strip' }]"
       tabindex="0" @keydown="onKey" @mousemove="showUi" @touchstart.passive="touchStart" @touchend.passive="touchEnd">
    <header class="es-rtop" :inert="!uiShown">
      <button class="es-rbtn" title="Volver (Esc)" @click="leave"><i class="es-i es-i-back" aria-hidden="true"></i></button>
      <div class="es-rtitle">
        <strong class="es-ellipsis">{{ shortTitle(item) }}</strong>
        <small class="es-ellipsis es-muted">{{ item.title !== shortTitle(item) ? item.title : item.series || '' }}<template v-if="hereLabel"> · <span class="es-rhere">{{ hereLabel }}</span></template></small>
      </div>
      <div class="es-rtools">
        <button class="es-rbtn" :class="{ on: settings.mode === 'single' }" title="Una página (1)" @click="setMode('single')"><i class="es-i es-i-page" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: settings.mode === 'double' }" title="Dos páginas (2)" @click="setMode('double')"><i class="es-i es-i-double" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: settings.mode === 'strip' }" title="Tira vertical (3)" @click="setMode('strip')"><i class="es-i es-i-strip" aria-hidden="true"></i></button>
        <span class="es-rsep"></span>
        <button class="es-rbtn" :class="{ on: rtl }" :title="rtl ? 'Sentido manga: de derecha a izquierda (m)' : 'De izquierda a derecha (m)'" @click="toggleDirection"><i class="es-i es-i-lr" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: bookmarked }" :title="bookmarked ? 'Quitar el marcador (b)' : 'Marcar esta página (b)'" @click="toggleBookmark"><i class="es-i" :class="bookmarked ? 'es-i-bookmark-fill' : 'es-i-bookmark'" aria-hidden="true"></i></button>
        <button class="es-rbtn" :class="{ on: panel === 'notes' }" :title="`Notas y marcadores (${bookmarks.length})`" @click="toggle('notes')"><i class="es-i es-i-note" aria-hidden="true"></i><span v-if="bookmarks.length" class="es-rbadge">{{ bookmarks.length }}</span></button>
        <button v-if="item.kind === 'pdf' && item.meta?.text !== false" class="es-rbtn es-rbtn-text" title="Leer como documento: texto que se puede seleccionar y zoom sin perder nitidez" @click="asDocument"><i class="es-i es-i-font" aria-hidden="true"></i> Documento</button>
        <button class="es-rbtn" :class="{ on: panel === 'settings' }" title="Ajustes" @click="toggle('settings')"><i class="es-i es-i-settings" aria-hidden="true"></i></button>
        <button class="es-rbtn" :title="fullscreen ? 'Salir de pantalla completa (f)' : 'Pantalla completa (f)'" @click="toggleFullscreen"><i class="es-i" :class="fullscreen ? 'es-i-fs-exit' : 'es-i-fs'" aria-hidden="true"></i></button>
      </div>
    </header>

    <div ref="stage" class="es-rstage" :class="`es-fit-${settings.fit}`" @click="onStageClick" @wheel="onWheel" @scroll.passive="onScroll">
      <!-- vertical strip: every page under the previous, loaded as it comes near -->
      <div v-if="settings.mode === 'strip'" class="es-strip" :style="{ width: stripWidth }">
        <div v-for="n in item.pages" :key="n - 1" :ref="(el) => stripRef(el as HTMLElement | null, n - 1)" class="es-strip-page" :data-page="n - 1"
             :style="{ aspectRatio: aspect(n - 1) }">
          <img v-if="urls[n - 1]" :src="urls[n - 1]" :alt="`Página ${n}`" draggable="false" @load="loaded(n - 1, $event)" />
          <span v-else class="es-pageload"><span class="es-spin"></span></span>
        </div>
      </div>
      <!-- one spread: one or two pages side by side; a short animation between spreads when asked -->
      <Transition v-else :name="transitionName" mode="out-in">
        <div :key="at" class="es-spread" :class="{ 'es-rtl': rtl }" :style="{ transform: zoom !== 1 ? `scale(${zoom})` : undefined }">
          <div v-for="p in current.pages" :key="p" class="es-pagebox" :style="boxStyle(p)">
            <img v-if="urls[p]" :src="urls[p]" :alt="`Página ${p + 1}`" draggable="false" @load="loaded(p, $event)" />
            <span v-else class="es-pageload"><span class="es-spin"></span><small v-if="failed[p]" class="es-pagefail">{{ failed[p] }}</small></span>
          </div>
        </div>
      </Transition>
    </div>

    <footer class="es-rbottom" :inert="!uiShown">
      <button class="es-rbtn" :title="rtl ? 'Siguiente' : 'Anterior'" @click.stop="rtl ? next() : prev()"><i class="es-i es-i-prev" aria-hidden="true"></i></button>
      <span class="es-rslider-wrap">
        <input class="es-rslider" type="range" min="0" :max="Math.max(0, item.pages - 1)" :value="page" :dir="rtl ? 'rtl' : 'ltr'" :aria-label="`Página ${page + 1} de ${item.pages}`"
               @input="goPage(Number(($event.target as HTMLInputElement).value))" />
        <span v-for="t in ticks" :key="t.id" class="es-rtick" :class="`es-rtick-${t.kind}`" :style="{ left: `${t.at}%` }" :title="t.title" @click.stop="goPage(t.page)"></span>
      </span>
      <span class="es-rcount es-rcount-wide">{{ page + 1 }}<template v-if="current.pages.length > 1 && settings.mode !== 'strip'">–{{ current.pages[current.pages.length - 1] + 1 }}</template> / {{ item.pages }} · {{ Math.round(((current.pages[current.pages.length - 1] ?? page) + 1) / item.pages * 100) }} %</span>
      <button class="es-rbtn" :title="rtl ? 'Anterior' : 'Siguiente'" @click.stop="rtl ? prev() : next()"><i class="es-i es-i-next" aria-hidden="true"></i></button>
    </footer>

    <aside v-if="panel === 'notes'" class="es-rpanel" @click.stop>
      <h3>Notas y marcadores</h3>
      <form v-if="noting" class="es-noteform" @submit.prevent="saveNote">
        <span class="es-note-place">Nota en la página {{ page + 1 }}</span>
        <textarea v-model="noting.text" class="es-note-edit" rows="4" placeholder="Tu nota" autofocus @keydown.esc="noting = null" @keydown.ctrl.enter="saveNote"></textarea>
        <div class="es-note-actions">
          <button class="es-chip" type="submit">Guardar</button>
          <button class="es-chip" type="button" @click="noting = null">Cancelar</button>
        </div>
      </form>
      <button v-else class="es-chip" @click="startNote"><i class="es-i es-i-note" aria-hidden="true"></i> Nota en esta página (n)</button>
      <NotesPanel :items="bookmarks" hint="El marcador (b) guarda la página; una nota se queda en la página donde la escribes." :place="placeOf"
                  @go="goToBookmark" @remove="removeBookmark" @save="saveBookmarkNote" />
    </aside>

    <aside v-if="panel === 'settings'" class="es-rpanel" @click.stop>
      <h3>Ajustes</h3>
      <div class="es-rfield">
        <span>Al pasar página</span>
        <div class="es-chips">
          <button v-for="a in ANIMATIONS" :key="a.id" class="es-chip" :class="{ on: settings.animation === a.id }" @click="set('animation', a.id)">{{ a.label }}</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>Ajuste</span>
        <div class="es-chips">
          <button v-for="f in FITS" :key="f.id" class="es-chip" :class="{ on: settings.fit === f.id }" @click="setFit(f.id)">{{ f.label }}</button>
        </div>
      </div>
      <div class="es-rfield">
        <span>Fondo</span>
        <div class="es-chips">
          <button v-for="b in BACKGROUNDS" :key="b.id" class="es-chip" :class="{ on: settings.background === b.id }" @click="set('background', b.id)">{{ b.label }}</button>
        </div>
      </div>
      <label class="es-rcheck"><input type="checkbox" :checked="settings.coverAlone" @change="set('coverAlone', ($event.target as HTMLInputElement).checked)" /> La portada sola en el modo de dos páginas</label>
      <div class="es-rfield">
        <span>Zoom</span>
        <div class="es-chips">
          <button class="es-chip" @click="zoomBy(-0.25)">−</button>
          <span class="es-rzoom">{{ Math.round(zoom * 100) }} %</span>
          <button class="es-chip" @click="zoomBy(0.25)">+</button>
          <button class="es-chip" @click="zoom = 1">1:1</button>
        </div>
      </div>
      <p class="es-muted es-tiny es-rkeys">Teclas: ← → espacio · 1 2 3 modos · m sentido · b marcador · n nota · f pantalla completa · + − zoom · Esc volver</p>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { Bookmark, ItemDetail } from '../lib/api'
import { widthFor } from '../lib/images'
import { spreadOf, spreads, toPrefetch, type Mode } from '../lib/layout'
import { loadSettings, saveSettings, shortTitle, useStore, type ReaderSettings } from '../lib/store'
import NotesPanel from './NotesPanel.vue'

/**
 * The comic reader: pages served as images by the service, shown one at a time, two side by side
 * (the cover and wide pages alone) or as a vertical strip. The next pages are fetched ahead; the
 * place is saved in the cloud a moment after every change and when leaving.
 */
const props = defineProps<{ item: ItemDetail; startPage?: number }>()
const emit = defineEmits<{ changed: [] }>()
const store = useStore()
const { item } = props

const FITS = [{ id: 'best', label: 'Página entera' }, { id: 'width', label: 'Ancho' }, { id: 'height', label: 'Alto' }, { id: 'original', label: 'Tamaño real' }] as const
const BACKGROUNDS = [{ id: 'black', label: 'Negro' }, { id: 'dark', label: 'Gris' }, { id: 'white', label: 'Blanco' }] as const
const ANIMATIONS = [{ id: 'none', label: 'De golpe' }, { id: 'fade', label: 'Fundido' }, { id: 'slide', label: 'Deslizar' }] as const

const settings = reactive<ReaderSettings>(loadSettings())
function set<K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) {
  settings[key] = value
  saveSettings(settings)
}
const rtl = computed(() => (settings.directions[item.id] || item.direction) === 'rtl')
function toggleDirection() {
  settings.directions = { ...settings.directions, [item.id]: rtl.value ? 'ltr' : 'rtl' }
  saveSettings(settings)
}

const root = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const page = ref(Math.min(Math.max(0, props.startPage ?? 0), Math.max(0, item.pages - 1)))
const urls = reactive<Record<number, string>>({})
const failed = reactive<Record<number, string>>({})
const natural = reactive<Record<number, [number, number]>>({})
const zoom = ref(1)
const panel = ref('')
const uiShown = ref(true)
const fullscreen = ref(false)
const bookmarks = ref<Bookmark[]>(item.bookmarks || [])
const noting = ref<{ text: string } | null>(null)
const stageSize = reactive({ w: 0, h: 0 })
/** which way the last turn went, for the slide */
let turnDir: 'next' | 'prev' = 'next'
const transitionName = computed(() => (settings.animation === 'none' ? '' : settings.animation === 'fade' ? 'es-anim-fade' : `es-anim-slide-${turnDir}`))
let uiTimer: any = null
let saveTimer: any = null
let lastSaved = -1

// ---- the layout ----
const list = computed(() => spreads(item.pages, item.page_sizes, settings.mode as Mode, settings.coverAlone))
const at = computed(() => spreadOf(list.value, page.value))
const current = computed(() => list.value[at.value] || { pages: [page.value] })
const bookmarked = computed(() => bookmarks.value.some((b) => b.kind === 'bookmark' && b.page === page.value))
/** Where the bookmarks and notes are, along the slider (the first of each page wins the spot). */
const ticks = computed(() => {
  const span = Math.max(1, item.pages - 1)
  return bookmarks.value.filter((b) => b.page !== null && b.page !== undefined).map((b) => {
    const x = (b.page! / span) * 100
    return { id: b.id, page: b.page!, kind: b.kind, at: rtl.value ? 100 - x : x, title: `${b.kind === 'bookmark' ? 'Marcador' : 'Nota'} en la página ${b.page! + 1}${b.note ? `: ${b.note}` : ''}` }
  })
})
/** What this page has: "marcada", "2 notas"… shown next to the title. */
const hereLabel = computed(() => {
  const here = bookmarks.value.filter((b) => current.value.pages.includes(b.page ?? -1))
  const notes = here.filter((b) => b.kind !== 'bookmark').length
  const parts: string[] = []
  if (here.some((b) => b.kind === 'bookmark')) parts.push('marcada')
  if (notes) parts.push(notes === 1 ? '1 nota' : `${notes} notas`)
  return parts.join(', ')
})
function toggle(name: string) {
  panel.value = panel.value === name ? '' : name
  if (panel.value) { uiShown.value = true; clearTimeout(uiTimer) }
}

function size(p: number): [number, number] {
  const known = natural[p] || item.page_sizes[p]
  return known && known[0] > 0 ? known : [2, 3]
}
function aspect(p: number): string {
  const [w, h] = size(p)
  return `${w} / ${h}`
}
/** Each page box of the spread: all the same height, so the two pages of a spread line up. */
function boxStyle(p: number) {
  const ratios = current.value.pages.map((q) => size(q)[0] / size(q)[1])
  const total = ratios.reduce((a, b) => a + b, 0)
  const ratio = size(p)[0] / size(p)[1]
  const gap = current.value.pages.length > 1 ? 4 : 0
  const w = Math.max(1, stageSize.w - gap), h = Math.max(1, stageSize.h)
  let height: number
  if (settings.fit === 'width') height = w / total
  else if (settings.fit === 'height') height = h
  else if (settings.fit === 'original') height = size(p)[1] / (window.devicePixelRatio || 1)
  else height = Math.min(h, w / total)
  return { height: `${Math.round(height)}px`, width: `${Math.round(height * ratio)}px` }
}
const stripWidth = computed(() => (settings.fit === 'original' ? 'auto' : settings.fit === 'best' || settings.fit === 'height' ? 'min(100%, 900px)' : '100%'))

/** The width to ask for a page: what it will take on screen, in device pixels. */
function wantedWidth(p: number): number {
  if (settings.fit === 'original') return size(p)[0]
  const perPage = settings.mode === 'strip' ? Math.min(stageSize.w, 900) : stageSize.w / Math.max(1, current.value.pages.length)
  const byHeight = settings.mode === 'strip' ? Infinity : stageSize.h * (size(p)[0] / size(p)[1])
  return widthFor(Math.min(perPage, settings.fit === 'width' ? Infinity : byHeight) || 800)
}

// ---- fetching pages ----
const fetching = new Set<number>()
async function fetchPage(p: number) {
  if (p < 0 || p >= item.pages || urls[p] || fetching.has(p)) return
  fetching.add(p)
  try {
    urls[p] = await store.pages.get(store.api.pagePath(item.id, p, wantedWidth(p)))
    delete failed[p]
  } catch (err: any) {
    failed[p] = err?.message || 'No se pudo cargar'
  }
  fetching.delete(p)
}
function loaded(p: number, event: Event) {
  const img = event.target as HTMLImageElement
  if (!item.page_sizes[p] && img.naturalWidth) natural[p] = [img.naturalWidth, img.naturalHeight]
}
async function show() {
  const pages = current.value.pages
  await Promise.all(pages.map(fetchPage))
  for (const p of toPrefetch(list.value, at.value)) {
    if (!urls[p]) fetchPage(p)
  }
}

// ---- moving ----
function goPage(p: number) {
  turnDir = p >= page.value ? 'next' : 'prev'
  page.value = Math.min(Math.max(0, p), Math.max(0, item.pages - 1))
  if (settings.mode === 'strip') scrollStripTo(page.value)
}
function next() {
  if (settings.mode === 'strip') { stage.value?.scrollBy({ top: stage.value.clientHeight * 0.85, behavior: 'smooth' }); return }
  if (at.value + 1 < list.value.length) {
    turnDir = 'next'
    page.value = list.value[at.value + 1].pages[0]
    stage.value?.scrollTo({ top: 0 })
  } else if (!finishedSaved) {
    save(true)
    store.notify('Fin. ¡Terminado!')
  }
}
function prev() {
  if (settings.mode === 'strip') { stage.value?.scrollBy({ top: -stage.value.clientHeight * 0.85, behavior: 'smooth' }); return }
  if (at.value > 0) {
    turnDir = 'prev'
    page.value = list.value[at.value - 1].pages[0]
    stage.value?.scrollTo({ top: 0 })
  }
}
function setMode(mode: Mode) {
  const keep = page.value
  set('mode', mode)
  nextTick(() => goPage(keep))
}
function setFit(fit: ReaderSettings['fit']) {
  set('fit', fit)
  zoom.value = 1
}
function zoomBy(delta: number) {
  zoom.value = Math.min(4, Math.max(0.5, Math.round((zoom.value + delta) * 100) / 100))
}

function onStageClick(event: MouseEvent) {
  if (panel.value) { panel.value = ''; return }
  if (settings.mode === 'strip') { toggleUi(); return }
  const x = event.clientX / window.innerWidth
  if (x < 0.3) rtl.value ? next() : prev()
  else if (x > 0.7) rtl.value ? prev() : next()
  else toggleUi()
}
function onWheel(event: WheelEvent) {
  if (event.ctrlKey) {
    event.preventDefault()
    zoomBy(event.deltaY < 0 ? 0.1 : -0.1)
    return
  }
  if (settings.mode === 'strip' || zoom.value !== 1) return
  const el = stage.value!
  const fits = el.scrollHeight <= el.clientHeight + 2
  if (fits || (event.deltaY > 0 && el.scrollTop + el.clientHeight >= el.scrollHeight - 2) || (event.deltaY < 0 && el.scrollTop <= 0)) {
    event.preventDefault()
    if (Math.abs(event.deltaY) < 10) return
    event.deltaY > 0 ? next() : prev()
  }
}
let touch: { x: number; y: number; t: number } | null = null
function touchStart(event: TouchEvent) {
  const t = event.touches[0]
  touch = { x: t.clientX, y: t.clientY, t: Date.now() }
}
function touchEnd(event: TouchEvent) {
  if (!touch || settings.mode === 'strip' || zoom.value !== 1) return
  const t = event.changedTouches[0]
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y
  touch = null
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - (touch?.t || 0) < 800) {
    const forward = dx < 0
    forward !== rtl.value ? next() : prev()
  }
}
function onKey(event: KeyboardEvent) {
  const k = event.key
  if ((event.target as HTMLElement | null)?.tagName === 'TEXTAREA' || (event.target as HTMLElement | null)?.tagName === 'INPUT') return
  const forward = () => (rtl.value ? prev() : next())
  const backward = () => (rtl.value ? next() : prev())
  if (k === 'ArrowRight') forward()
  else if (k === 'ArrowLeft') backward()
  else if (k === ' ' || k === 'PageDown' || k === 'ArrowDown' && settings.mode !== 'strip') next()
  else if (k === 'Backspace' || k === 'PageUp' || k === 'ArrowUp' && settings.mode !== 'strip') prev()
  else if (k === 'Home') goPage(0)
  else if (k === 'End') goPage(item.pages - 1)
  else if (k === '1') setMode('single')
  else if (k === '2') setMode('double')
  else if (k === '3') setMode('strip')
  else if (k === 'm') toggleDirection()
  else if (k === 'b') toggleBookmark()
  else if (k === 'n') startNote()
  else if (k === 'f') toggleFullscreen()
  else if (k === '+' || k === '=') zoomBy(0.25)
  else if (k === '-') zoomBy(-0.25)
  else if (k === '0') zoom.value = 1
  else if (k === 'Escape') { if (panel.value) panel.value = ''; else if (fullscreen.value) document.exitFullscreen(); else leave() }
  else return
  event.preventDefault()
}

// ---- the strip: which page is on screen, loading the ones near ----
const stripEls = new Map<number, HTMLElement>()
let observer: IntersectionObserver | null = null
function stripRef(el: HTMLElement | null, p: number) {
  if (el) { stripEls.set(p, el); observer?.observe(el) } else { const old = stripEls.get(p); if (old) observer?.unobserve(old); stripEls.delete(p) }
}
function setupObserver() {
  observer?.disconnect()
  if (settings.mode !== 'strip' || !stage.value) return
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) fetchPage(Number((e.target as HTMLElement).dataset.page))
  }, { root: stage.value, rootMargin: '150% 0px' })
  for (const el of stripEls.values()) observer.observe(el)
}
function scrollStripTo(p: number) {
  const el = stripEls.get(p)
  if (el && stage.value) stage.value.scrollTo({ top: el.offsetTop - 4 })
}
function onScroll() {
  if (settings.mode !== 'strip' || !stage.value) return
  const middle = stage.value.scrollTop + stage.value.clientHeight / 2
  let best = page.value
  for (const [p, el] of stripEls) if (el.offsetTop <= middle && el.offsetTop + el.offsetHeight > middle) { best = p; break }
  if (best !== page.value) page.value = best
}

// ---- progress, bookmarks ----
let finishedSaved = !!item.progress?.finished
/** A PDF from here on as a document (pdf.js), where the reader is. */
function asDocument() {
  settings.pdf = 'doc'
  saveSettings(settings)
  save()
  store.go({ v: 'read', id: item.id, page: page.value, as: 'doc' }, true)
}
function save(finished = false) {
  clearTimeout(saveTimer)
  const last = current.value.pages[current.value.pages.length - 1]
  const done = finished || (settings.mode !== 'strip' && at.value === list.value.length - 1) || last >= item.pages - 1
  if (done) finishedSaved = true
  if (last === lastSaved && !done) return
  lastSaved = last
  store.api.setProgress(item.id, { page: last, percent: (last + 1) / item.pages, finished: done, device: 'web' }).then(() => emit('changed')).catch(() => {})
}
watch(page, () => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => save(), 1500)
  show()
})
async function toggleBookmark() {
  try {
    const mine = bookmarks.value.find((b) => b.kind === 'bookmark' && b.page === page.value)
    if (mine) {
      await store.api.deleteBookmark(mine.id)
      bookmarks.value = bookmarks.value.filter((b) => b.id !== mine.id)
      store.notify('Marcador quitado.')
    } else {
      bookmarks.value = [...bookmarks.value, await store.api.addBookmark(item.id, { kind: 'bookmark', page: page.value })].sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
      store.notify(`Página ${page.value + 1} marcada.`)
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function placeOf(b: Bookmark): string {
  return b.page !== null && b.page !== undefined ? `Página ${b.page + 1}` : 'Sin página'
}
function startNote() {
  noting.value = { text: '' }
  panel.value = 'notes'
  uiShown.value = true
  clearTimeout(uiTimer)
}
async function saveNote() {
  const n = noting.value
  if (!n) return
  try {
    bookmarks.value = [...bookmarks.value, await store.api.addBookmark(item.id, { kind: 'note', page: page.value, note: n.text.trim() })].sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
    noting.value = null
    store.notify('Nota guardada.')
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function removeBookmark(b: Bookmark) {
  try {
    await store.api.deleteBookmark(b.id)
    bookmarks.value = bookmarks.value.filter((x) => x.id !== b.id)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function saveBookmarkNote(b: Bookmark, note: string) {
  try {
    const changed = await store.api.changeBookmark(item.id, b.id, { note })
    bookmarks.value = bookmarks.value.map((x) => (x.id === b.id ? changed : x))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function goToBookmark(b: Bookmark) {
  goPage(b.page ?? 0)
  panel.value = ''
}

// ---- the chrome ----
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
function measure() {
  if (!stage.value) return
  stageSize.w = stage.value.clientWidth
  stageSize.h = stage.value.clientHeight
}
let resizeObserver: ResizeObserver | null = null

watch(() => settings.mode, () => nextTick(() => { setupObserver(); measure(); show() }))
watch(() => [settings.fit, settings.coverAlone], () => nextTick(() => { measure(); show() }))

onMounted(() => {
  measure()
  resizeObserver = new ResizeObserver(() => { measure() })
  if (stage.value) resizeObserver.observe(stage.value)
  document.addEventListener('fullscreenchange', onFullscreen)
  root.value?.focus()
  setupObserver()
  show()
  showUi()
  if (settings.mode === 'strip') nextTick(() => scrollStripTo(page.value))
  if (item.progress?.finished && (props.startPage ?? 0) === 0) finishedSaved = false
})
onBeforeUnmount(() => {
  clearTimeout(uiTimer)
  clearTimeout(saveTimer)
  resizeObserver?.disconnect()
  observer?.disconnect()
  document.removeEventListener('fullscreenchange', onFullscreen)
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {})
  save()
})
</script>
