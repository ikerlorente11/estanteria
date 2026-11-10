<template>
  <section class="es-page">
    <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
    <template v-else-if="item">
      <div class="es-hero">
        <Cover :id="item.id" :has="item.cover" class="es-hero-pic" />
        <div class="es-hero-text">
          <p class="es-muted es-small es-crumbs">
            <a href="#" @click.prevent="go(local ? { v: 'library', source: String(item.source_id) } : { v: 'library' })">{{ local ? origin : 'Biblioteca' }}</a>
            <template v-if="item.series"> › <a href="#" @click.prevent="go({ v: 'series', name: item.series })">{{ item.series }}</a></template>
          </p>
          <h1 class="es-h1 es-big">{{ item.title }}</h1>
          <p class="es-muted">
            <template v-if="item.author">{{ item.author }} · </template>{{ kindLabel(item) }}<template v-if="item.year"> · {{ item.year }}</template>
            <template v-if="item.pages && item.kind !== 'book'"> · {{ item.pages }} páginas</template> · {{ sizeLabel(item.size) }}
          </p>
          <p v-if="item.summary" class="es-summary">{{ item.summary }}</p>
          <p v-if="item.state === 'error'" class="es-banner es-banner-error">No se pudo abrir: {{ item.error }}</p>
          <div class="es-hero-actions">
            <button class="es-btn es-primary" :disabled="item.state !== 'ready'" @click="store.read(item)">
              <i class="es-i es-i-book-open" aria-hidden="true"></i>
              {{ item.progress && !item.progress.finished && item.progress.percent > 0 ? 'Seguir leyendo' : item.progress?.finished ? 'Leer otra vez' : 'Leer' }}
            </button>
            <button v-if="item.progress && !item.progress.finished && item.progress.percent > 0" class="es-btn" @click="go({ v: 'read', id: item.id, page: 0 })">Desde el principio</button>
            <button v-if="item.kind === 'pdf'" class="es-btn" :title="pdfAs === 'doc' ? 'Sus páginas como imágenes, en el lector de cómics (doble página, manga, tira)' : 'Como documento: texto que se puede seleccionar y zoom sin perder nitidez'"
                    @click="go({ v: 'read', id: item.id, as: pdfAs === 'doc' ? 'pages' : 'doc' })">
              <i class="es-i" :class="pdfAs === 'doc' ? 'es-i-pages' : 'es-i-page'" aria-hidden="true"></i> {{ pdfAs === 'doc' ? 'Leer como cómic' : 'Leer como documento' }}
            </button>
            <button v-if="!item.progress?.finished" class="es-btn" @click="mark(true)">Marcar como leído</button>
            <button v-else class="es-btn" @click="mark(false)">Marcar como no leído</button>
            <button v-if="convertTo && !local" class="es-btn" :disabled="converting" :title="convertTo === 'EPUB'
                      ? 'Rehacer este PDF como libro EPUB (texto que se adapta a la pantalla, con su índice), junto al PDF en tu Archivador. Solo para PDF con texto, no escaneados.'
                      : 'Maquetar este libro como PDF (páginas A5, con su índice), junto al libro en tu Archivador: para imprimirlo o leerlo donde solo se lee PDF.'"
                    @click="convert">
              <span v-if="converting" class="es-spin"></span><i v-else class="es-i es-i-book" aria-hidden="true"></i>
              {{ converting ? 'Convirtiendo…' : `Convertir a ${convertTo}` }}
            </button>
            <OfflineButton v-if="store.offline && !local" :items="[item]" />
            <button v-if="local && state.connected && online" class="es-btn" :disabled="uploading !== null" title="Copiar el archivo a la carpeta Lectura de tu Archivador, para leerlo también en la web y el móvil" @click="startUpload">
              <i class="es-i es-i-cloud" aria-hidden="true"></i> Subir a El Archivador
            </button>
            <button v-if="local" class="es-btn" title="Mostrar el archivo en el Explorador" @click="reveal"><i class="es-i es-i-computer" aria-hidden="true"></i> Mostrar en el Explorador</button>
            <button v-if="local && item.source_id === -1" class="es-btn" title="Quitar de Archivos sueltos (el archivo no se borra)" @click="unshelve"><i class="es-i es-i-delete" aria-hidden="true"></i> Quitar</button>
            <a v-if="item.format !== 'folder' && !local" class="es-btn" href="#" :title="store.offline ? 'Bajar el archivo original a donde elijas' : ''" @click.prevent="download"><i class="es-i es-i-download" aria-hidden="true"></i> {{ store.offline ? 'Archivo' : 'Descargar' }}</a>
            <button v-if="item.source_id && !local && item.format !== 'folder'" class="es-btn" :disabled="saving" title="Copiar el archivo a la carpeta Lectura de tu Archivador" @click="toCloud">
              <span v-if="saving" class="es-spin"></span><i v-else class="es-i es-i-cloud" aria-hidden="true"></i> Guardar en El Archivador
            </button>
            <button v-if="fromCatalog" class="es-btn" title="Quitar de tu estantería (sigue en el catálogo)" @click="remove">
              <i class="es-i es-i-delete" aria-hidden="true"></i> Quitar
            </button>
          </div>
          <form v-if="uploading !== null" class="es-upload" @submit.prevent="upload">
            <label>En tu Archivador, dentro de «{{ store.readingRoot }}»
              <input v-model="uploadPath" type="text" required :disabled="uploading > 0" />
            </label>
            <div class="es-form-actions">
              <button class="es-btn es-primary" type="submit" :disabled="uploading > 0"><span v-if="uploading > 0" class="es-spin"></span> {{ uploading > 0 ? `Subiendo… ${Math.round(uploading * 100)} %` : 'Subir' }}</button>
              <button class="es-btn" type="button" :disabled="uploading > 0" @click="uploading = null">Cancelar</button>
            </div>
            <span v-if="uploading > 0" class="es-job-bar"><span :style="{ width: `${Math.round(uploading * 100)}%` }"></span></span>
          </form>
          <p v-if="origin" class="es-origin"><i class="es-i" :class="local ? 'es-i-computer' : 'es-i-server'" aria-hidden="true"></i> {{ local ? `En este PC · ${origin}` : `De ${origin}` }}</p>
          <p v-if="item.progress && !item.progress.finished && item.progress.percent > 0" class="es-muted es-small">
            Vas por el {{ Math.round(item.progress.percent * 100) }} %<template v-if="item.progress.page !== null && item.kind !== 'book'"> (página {{ item.progress.page + 1 }})</template>
            <template v-if="item.progress.device"> · desde {{ item.progress.device }}</template>
          </p>
        </div>
      </div>

      <section v-if="item.bookmarks.length" class="es-section">
        <h2 class="es-h2">Notas y marcadores</h2>
        <ul class="es-bookmarks">
          <li v-for="b in item.bookmarks" :key="b.id">
            <a href="#" @click.prevent="go({ v: 'read', id: item!.id, page: b.page ?? undefined })">
              <i class="es-i" :class="b.kind === 'bookmark' ? 'es-i-bookmark' : b.kind === 'note' ? 'es-i-note' : 'es-i-marker'" aria-hidden="true"></i>
              <span>
                {{ b.page !== null ? `Página ${b.page + 1}` : b.kind === 'bookmark' ? b.excerpt || 'En el texto' : '' }}
                <q v-if="b.kind !== 'bookmark' && b.excerpt">{{ b.excerpt.length > 120 ? b.excerpt.slice(0, 120) + '…' : b.excerpt }}</q>
                <template v-if="b.note"> — {{ b.note }}</template>
              </span>
            </a>
            <button class="es-mini" title="Quitar" @click="removeBookmark(b.id)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </li>
        </ul>
      </section>

      <section class="es-section">
        <h2 class="es-h2">Archivo</h2>
        <p class="es-muted es-small es-path">{{ item.path }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ItemDetail } from '../lib/api'
import { isLocal } from '../lib/local'
import { kindLabel, loadSettings, sizeLabel, sourceName, useStore } from '../lib/store'
import Cover from './Cover.vue'
import OfflineButton from './OfflineButton.vue'

const props = defineProps<{ id: number }>()
const store = useStore()
const { state, go } = store
const item = ref<ItemDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const origin = computed(() => (item.value ? sourceName(item.value, state.status?.sources) : ''))
const local = computed(() => !!item.value && isLocal(item.value.id))
const online = computed(() => store.offline?.state.online !== false)
const pdfAs = loadSettings().pdf

// ---- a file of this PC up to the Archivador ----
/** null: not asked; 0: asking where; 0–1: how much went */
const uploading = ref<number | null>(null)
const uploadPath = ref('')
function startUpload() {
  if (!item.value || !store.shelf) return
  uploadPath.value = store.shelf.uploadPath(item.value.id)
  uploading.value = 0
}
async function upload() {
  if (!item.value || !store.shelf) return
  const dest = uploadPath.value.trim().replace(/^\/+/, '')
  uploading.value = 0.001
  try {
    const done = await store.shelf.backend.upload(item.value.id, dest, (sent, total) => { uploading.value = Math.max(0.001, sent / Math.max(1, total)) })
    store.notify(`Subido a ${done.path}.`)
    uploading.value = null
    store.refresh()
  } catch (err: any) {
    store.notify(`No se pudo subir: ${err?.message || err}`, true)
    uploading.value = 0
  }
}
async function reveal() {
  if (!item.value || !store.shelf) return
  try { await store.shelf.backend.reveal(item.value.id) } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function unshelve() {
  if (!item.value || !store.shelf) return
  try {
    await store.shelf.removeFile(item.value.id)
    store.notify('Quitado de Archivos sueltos (el archivo sigue en su sitio).')
    store.refresh()
    go({ v: 'library' }, true)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
const fromCatalog = computed(() => !!item.value?.source_id && !!state.status?.sources.find((s) => s.id === item.value!.source_id)?.catalog)

async function toCloud() {
  if (!item.value) return
  saving.value = true
  try {
    const r = await store.api.saveItem(item.value.id)
    store.notify(`Guardado en ${r.path}`)
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
const converting = ref(false)
/** What this item can be converted into: a PDF with text into an EPUB, a book into a PDF. */
const convertTo = computed(() => !item.value ? '' : item.value.format === 'pdf' ? 'EPUB' : ['epub', 'fb2', 'mobi'].includes(item.value.format) ? 'PDF' : '')
async function convert() {
  if (!item.value) return
  converting.value = true
  store.notify(`Convirtiendo a ${convertTo.value}: puede tardar unos segundos…`)
  try {
    const r = await store.api.convertToEpub(item.value.id)
    store.notify(r.stats.to === 'pdf'
      ? `Hecho: «${r.stats.title}», ${r.stats.pages} páginas. Lo tienes junto al libro.`
      : `Hecho: «${r.stats.title}», ${r.stats.chapters} capítulos. Lo tienes junto al PDF.`)
    store.refresh()
    if (r.item) go({ v: 'item', id: r.item.id })
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  converting.value = false
}
async function remove() {
  if (!item.value) return
  try {
    await store.api.removeItem(item.value.id)
    store.notify('Quitado de tu estantería.')
    store.refresh()
    go({ v: 'library' }, true)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}

async function load() {
  if (!state.connected) return
  try { item.value = await store.api.item(props.id) } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
async function mark(finished: boolean) {
  if (!item.value) return
  try {
    if (finished) await store.api.setProgress(item.value.id, { page: item.value.kind === 'book' ? null : Math.max(0, item.value.pages - 1), percent: 1, finished: true })
    else await store.api.clearProgress(item.value.id)
    await load()
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function removeBookmark(id: number) {
  try { await store.api.deleteBookmark(id); await load() } catch (err: any) { store.notify(err?.message || String(err), true) }
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
watch(() => state.connected, load)
</script>
