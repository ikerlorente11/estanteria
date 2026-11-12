<template>
  <div class="es-reader-shell">
    <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> {{ t('Abriendo…') }}</div>
    <div v-else-if="error" class="es-reader-loading">
      <p>{{ error }}</p>
      <button class="es-btn" @click="store.back()">{{ t('Volver') }}</button>
    </div>
    <PdfReader v-else-if="item && item.kind === 'pdf' && asDoc" :item="item" :start-page="sharedStart ?? startPage" @changed="changed" />
    <ComicReader v-else-if="item && item.kind !== 'book'" :item="item" :start-page="sharedStart ?? startPage" :source="djvu ? (p, w) => djvu!.image(p, w) : undefined" @changed="changed" />
    <BookReader v-else-if="item && BOOK_FORMATS.includes(item.format)" :item="item" @changed="changed" />
    <div v-else-if="item" class="es-reader-loading">
      <p><strong>{{ item.title }}</strong></p>
      <p>{{ t('Los {format} aún no se leen aquí; puedes descargarlo y abrirlo con otra app.', { format: item.format.toUpperCase() }) }}</p>
      <p><button class="es-btn es-primary" @click="download">{{ t('Descargar') }}</button> <button class="es-btn" @click="store.back()">{{ t('Volver') }}</button></p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import type { ItemDetail } from '../lib/api'
import { BOOK_FORMATS } from '../lib/books'
import type { DjvuBook } from '../lib/djvu'
import { t } from '../lib/i18n'
import { loadSettings, useStore } from '../lib/store'
import { newestProgress, sharedProgress } from '../lib/handoff'
import { useSync } from '../lib/favorites'
import ComicReader from './ComicReader.vue'
import BookReader from './BookReader.vue'

// pdf.js only loads when a PDF is read as a document
const PdfReader = defineAsyncComponent(() => import('./PdfReader.vue'))

/** Opens an item and hands it to the reader of its kind: pages (comics, PDF, DjVu) or text (EPUB, MOBI, FB2, TXT…). */
const props = defineProps<{ id: number; startPage?: number; as?: 'doc' | 'pages' }>()
/** a PDF: as a document (pdf.js), or its pages as images in the comic reader; the reader's setting unless asked */
const store = useStore()
useSync(store)
const item = ref<ItemDetail | null>(null)
// never for a PDF without text (a comic, a scan): the service says
// a DjVu is always pages: pdf.js cannot read it
const asDoc = computed(() => item.value?.format === 'pdf' && item.value?.meta?.text !== false && (props.as ? props.as === 'doc' : loadSettings().pdf === 'doc'))
const loading = ref(true)
const djvu = shallowRef<DjvuBook | null>(null)
const error = ref('')
/** where another device read up to, when it read later than the server says */
const sharedStart = ref<number | undefined>(undefined)

async function load() {
  try {
    const got = await store.api.item(props.id)
    if (got.state === 'error') error.value = t('No se pudo abrir: {error}', { error: got.error || t('archivo ilegible') })
    else if (got.state === 'listed') error.value = t('Este archivo aún se está abriendo; prueba en un momento.')
    else if (got.format === 'djvu') {
      // drawn here, from the whole file: its pages and their sizes are the file's own
      const { DjvuBook } = await import('../lib/djvu')
      djvu.value = await DjvuBook.open(await store.api.blob(store.api.filePath(got.id)))
      item.value = { ...got, pages: djvu.value.pages, page_sizes: djvu.value.sizes }
    }
    else item.value = got
    // read later somewhere else (a copy of this file on another device): from there
    if (item.value) {
      const shared = sharedProgress(item.value)
      if (shared && newestProgress(item.value.progress, shared) === shared && !shared.finished) {
        item.value = { ...item.value, progress: { ...shared } }
        if (item.value.kind !== 'book' && shared.page !== null) sharedStart.value = shared.page
      }
    }
  } catch (err: any) { error.value = err?.message || String(err) }
  loading.value = false
}
function changed() {
  store.refresh()
}
async function download() {
  if (!item.value) return
  try {
    const blob = await store.api.blob(store.api.filePath(item.value.id))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = item.value.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
onMounted(load)
onBeforeUnmount(() => djvu.value?.close())
</script>
