<template>
  <div class="es-reader-shell">
    <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> Abriendo…</div>
    <div v-else-if="error" class="es-reader-loading">
      <p>{{ error }}</p>
      <button class="es-btn" @click="store.back()">Volver</button>
    </div>
    <PdfReader v-else-if="item && item.kind === 'pdf' && asDoc" :item="item" :start-page="startPage" @changed="changed" />
    <ComicReader v-else-if="item && item.kind !== 'book'" :item="item" :start-page="startPage" @changed="changed" />
    <BookReader v-else-if="item && item.format === 'epub'" :item="item" @changed="changed" />
    <div v-else-if="item" class="es-reader-loading">
      <p><strong>{{ item.title }}</strong></p>
      <p>Los {{ item.format.toUpperCase() }} aún no se leen aquí; puedes descargarlo y abrirlo con otra app.</p>
      <p><button class="es-btn es-primary" @click="download">Descargar</button> <button class="es-btn" @click="store.back()">Volver</button></p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import type { ItemDetail } from '../lib/api'
import { loadSettings, useStore } from '../lib/store'
import ComicReader from './ComicReader.vue'
import BookReader from './BookReader.vue'

// pdf.js only loads when a PDF is read as a document
const PdfReader = defineAsyncComponent(() => import('./PdfReader.vue'))

/** Opens an item and hands it to the reader of its kind: pages (comics, PDF) or text (EPUB). */
const props = defineProps<{ id: number; startPage?: number; as?: 'doc' | 'pages' }>()
/** a PDF: as a document (pdf.js), or its pages as images in the comic reader; the reader's setting unless asked */
const asDoc = computed(() => (props.as ? props.as === 'doc' : loadSettings().pdf === 'doc'))
const store = useStore()
const item = ref<ItemDetail | null>(null)
const loading = ref(true)
const error = ref('')

async function load() {
  try {
    const got = await store.api.item(props.id)
    if (got.state === 'error') error.value = `No se pudo abrir: ${got.error || 'archivo ilegible'}`
    else if (got.state === 'listed') error.value = 'Este archivo aún se está abriendo; prueba en un momento.'
    else item.value = got
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
</script>
