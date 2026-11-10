<template>
  <div ref="root" class="es-reader es-pdf-reader" :class="`es-bg-${settings.background}`" tabindex="0" @keydown="onKey">
    <header class="es-rtop">
      <button class="es-rbtn" title="Volver (Esc)" @click="leave"><i class="es-i es-i-back" aria-hidden="true"></i></button>
      <div class="es-rtitle">
        <strong class="es-ellipsis">{{ shortTitle(item) }}</strong>
        <small class="es-ellipsis es-muted">{{ item.title !== shortTitle(item) ? item.title : item.series || '' }}<template v-if="total"> · <span class="es-rhere">pág. {{ page + 1 }} / {{ total }} · {{ Math.round(((page + 1) / total) * 100) }} %</span></template></small>
      </div>
      <div class="es-rtools">
        <label class="es-pdf-goto" title="Ir a la página">
          <input type="number" min="1" :max="total || 1" :value="page + 1" aria-label="Página" @change="goTo(Number(($event.target as HTMLInputElement).value) - 1)" />
        </label>
        <span class="es-rsep"></span>
        <button class="es-rbtn" title="Alejar (−)" @click="zoomBy(1 / 1.2)"><span class="es-pdf-zoomsign" aria-hidden="true">−</span></button>
        <button class="es-rbtn es-pdf-zoom" :class="{ on: fit }" title="Ajustar al ancho (0)" @click="fitWidth">{{ fit ? 'Ancho' : `${Math.round(zoom * 100)} %` }}</button>
        <button class="es-rbtn" title="Acercar (+)" @click="zoomBy(1.2)"><span class="es-pdf-zoomsign" aria-hidden="true">+</span></button>
        <span class="es-rsep"></span>
        <button class="es-rbtn es-rbtn-text" title="Leer como cómic: sus páginas como imágenes (doble página, manga, tira)" @click="asPages"><i class="es-i es-i-pages" aria-hidden="true"></i> Cómic</button>
        <button class="es-rbtn" :title="fullscreen ? 'Salir de pantalla completa (f)' : 'Pantalla completa (f)'" @click="toggleFullscreen"><i class="es-i" :class="fullscreen ? 'es-i-fs-exit' : 'es-i-fs'" aria-hidden="true"></i></button>
      </div>
    </header>

    <div ref="stage" class="es-rstage es-pdf-stage" @scroll.passive="onScroll">
      <p v-if="error" class="es-reader-loading">{{ error }}</p>
      <p v-else-if="!total" class="es-reader-loading"><span class="es-spin"></span> Abriendo el PDF…</p>
      <div v-for="n in total" :key="n - 1" :ref="(el) => pageRef(el as HTMLElement | null, n - 1)" class="es-pdf-page" :data-page="n - 1"
           :style="{ width: `${pageWidth(n - 1)}px`, height: `${pageHeight(n - 1)}px` }">
        <span v-if="!drawn.has(n - 1)" class="es-pageload"><span class="es-spin"></span></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import * as pdfjs from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ItemDetail } from '../lib/api'
import { loadSettings, saveSettings, shortTitle, useStore } from '../lib/store'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** A PDF read as a document, by pdf.js in the page: real text (it can be selected and copied), zoom
 * without blur, one page under the other. The pages are drawn as they come near and the place is
 * kept like the comic reader's (page and per cent). */
const props = defineProps<{ item: ItemDetail; startPage?: number }>()
const emit = defineEmits<{ changed: [] }>()
const store = useStore()
const item = props.item
const settings = reactive(loadSettings())
const root = ref<HTMLElement>()
const stage = ref<HTMLElement>()
const total = ref(0)
const page = ref(0)
const error = ref('')
/** zoom on the page's own size (1 = 100 %, 72 dpi × the screen's scale); `fit` follows the width */
const zoom = ref(1)
const fit = ref(true)
const fullscreen = ref(false)
const drawn = reactive(new Set<number>())
let doc: PDFDocumentProxy | null = null
let sizes: [number, number][] = []
const els = new Map<number, HTMLElement>()
let observer: IntersectionObserver | null = null
let saveTimer: any = null
let redrawTimer: any = null
let generation = 0

function pageRef(el: HTMLElement | null, n: number) {
  if (el) { els.set(n, el); observer?.observe(el) } else els.delete(n)
}
function pageWidth(n: number) { return Math.round((sizes[n]?.[0] || sizes[0]?.[0] || 600) * zoom.value) }
function pageHeight(n: number) { return Math.round((sizes[n]?.[1] || sizes[0]?.[1] || 850) * zoom.value) }

/** The width of the screen, with room for the margins and the scroll bar; at most a comfortable reading width. */
function fitZoom(): number {
  const width = Math.min((stage.value?.clientWidth || 900) - 40, 1280)
  const widest = Math.max(...sizes.map((s) => s[0]), 1)
  return Math.max(0.2, Math.min(4, width / widest))
}
function setZoom(z: number, keepFit = false) {
  const keep = page.value
  zoom.value = Math.max(0.2, Math.min(6, z))
  fit.value = keepFit
  generation++
  drawn.clear()
  for (const el of els.values()) el.querySelectorAll('canvas, .textLayer').forEach((c) => c.remove())
  requestAnimationFrame(() => { scrollToPage(keep); clearTimeout(redrawTimer); redrawTimer = setTimeout(drawVisible, 60) })
}
function zoomBy(f: number) { setZoom(zoom.value * f) }
function fitWidth() { setZoom(fitZoom(), true) }

async function draw(n: number) {
  if (!doc || drawn.has(n)) return
  const el = els.get(n)
  if (!el) return
  const mine = generation
  drawn.add(n)
  try {
    const p: PDFPageProxy = await doc.getPage(n + 1)
    if (mine !== generation) return
    const dpr = window.devicePixelRatio || 1
    const viewport = p.getViewport({ scale: zoom.value })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width * dpr)
    canvas.height = Math.floor(viewport.height * dpr)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const ctx = canvas.getContext('2d')!
    await p.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise
    if (mine !== generation) return
    el.querySelectorAll('canvas, .textLayer').forEach((c) => c.remove())
    el.appendChild(canvas)
    // the text, invisible over the drawing: it can be selected, copied and searched with Ctrl+F
    const layer = document.createElement('div')
    layer.className = 'textLayer'
    layer.style.setProperty('--scale-factor', String(zoom.value))
    layer.style.setProperty('--total-scale-factor', String(zoom.value))
    el.appendChild(layer)
    await new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: layer, viewport }).render()
  } catch (err) {
    if (mine === generation) drawn.delete(n)
    console.warn('pdf page', n, err)
  }
}

function visible(): number[] {
  const box = stage.value?.getBoundingClientRect()
  if (!box) return []
  const out: number[] = []
  for (const [n, el] of els) {
    const r = el.getBoundingClientRect()
    if (r.bottom > box.top - box.height && r.top < box.bottom + box.height) out.push(n)
  }
  return out.sort((a, b) => a - b)
}
function drawVisible() { for (const n of visible()) draw(n) }

function onScroll() {
  const box = stage.value?.getBoundingClientRect()
  if (!box) return
  // the page under the top third of the screen is where the reader is
  const mark = box.top + box.height / 3
  for (const [n, el] of els) {
    const r = el.getBoundingClientRect()
    if (r.top <= mark && r.bottom >= mark) { if (page.value !== n) { page.value = n; queueSave() } break }
  }
}
function scrollToPage(n: number) {
  const el = els.get(n)
  if (el && stage.value) stage.value.scrollTop = el.offsetTop - 12
}
function goTo(n: number) {
  if (!total.value) return
  page.value = Math.max(0, Math.min(total.value - 1, n))
  scrollToPage(page.value)
  queueSave()
}

function queueSave() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 1200)
}
function save() {
  if (!total.value) return
  const finished = page.value >= total.value - 1
  store.api.setProgress(item.id, { page: page.value, percent: (page.value + 1) / total.value, finished, device: 'web' }).then(() => emit('changed')).catch(() => {})
}

function leave() {
  clearTimeout(saveTimer)
  save()
  store.back()
}
function asPages() {
  settings.pdf = 'pages'
  saveSettings(settings)
  save()
  store.go({ v: 'read', id: item.id, page: page.value, as: 'pages' }, true)
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await root.value?.requestFullscreen()
  } catch (_) {}
  fullscreen.value = !!document.fullscreenElement
}
function onKey(event: KeyboardEvent) {
  if ((event.target as HTMLElement)?.tagName === 'INPUT') return
  const k = event.key
  if (k === 'Escape' && !document.fullscreenElement) leave()
  else if (k === '+' || k === '=') zoomBy(1.2)
  else if (k === '-') zoomBy(1 / 1.2)
  else if (k === '0') fitWidth()
  else if (k === 'f') toggleFullscreen()
  else if (k === 'Home') goTo(0)
  else if (k === 'End') goTo(total.value - 1)
  else if ((k === 'ArrowRight' || k === 'PageDown') && !event.ctrlKey) { goTo(page.value + 1); event.preventDefault() }
  else if ((k === 'ArrowLeft' || k === 'PageUp') && !event.ctrlKey) { goTo(page.value - 1); event.preventDefault() }
}

onMounted(async () => {
  root.value?.focus()
  document.addEventListener('fullscreenchange', () => { fullscreen.value = !!document.fullscreenElement })
  try {
    const blob = await store.api.blob(store.api.filePath(item.id))
    doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise
    // every page's size first (cheap), so the scroll has its real length before anything is drawn
    const all: [number, number][] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const v = (await doc.getPage(n)).getViewport({ scale: 1 })
      all.push([v.width, v.height])
    }
    sizes = all
    zoom.value = fitZoom()
    observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) draw(Number((e.target as HTMLElement).dataset.page))
    }, { root: stage.value, rootMargin: '100% 0px' })
    total.value = doc.numPages
    const start = props.startPage ?? (item.progress && !item.progress.finished ? item.progress.page ?? 0 : 0)
    page.value = Math.max(0, Math.min(total.value - 1, start))
    requestAnimationFrame(() => { scrollToPage(page.value); drawVisible() })
  } catch (err: any) { error.value = `No se pudo abrir el PDF: ${err?.message || err}` }
  window.addEventListener('resize', onResize)
})
function onResize() { if (fit.value) { clearTimeout(redrawTimer); redrawTimer = setTimeout(fitWidth, 200) } }
onBeforeUnmount(() => {
  clearTimeout(saveTimer)
  observer?.disconnect()
  window.removeEventListener('resize', onResize)
  doc?.destroy()
})
</script>
