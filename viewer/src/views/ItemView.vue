<template>
  <section class="es-page">
    <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
    <template v-else-if="item">
      <div class="es-hero">
        <Cover :id="item.id" :has="item.cover" class="es-hero-pic" :title="item.kind === 'book' ? item.title : ''" />
        <div class="es-hero-text">
          <p class="es-muted es-small es-crumbs">
            <a href="#" @click.prevent="go(local ? { v: 'library', source: String(item.source_id) } : { v: 'library' })">{{ local ? origin : t('Estantería') }}</a>
            <template v-if="item.series"> › <a href="#" @click.prevent="go({ v: 'series', name: item.series })">{{ item.series }}</a></template>
          </p>
          <h1 class="es-h1 es-big">{{ item.title }}</h1>
          <p class="es-muted">
            <template v-if="item.author">{{ item.author }} · </template>{{ kindLabel(item) }}<template v-if="item.year"> · {{ item.year }}</template>
            <template v-if="item.pages && item.kind !== 'book'"> · {{ plural(item.pages, '{n} página', '{n} páginas') }}</template> · {{ sizeLabel(item.size) }}
          </p>
          <p v-if="item.progress?.device && item.progress.updated && item.progress.percent > 0" class="es-muted es-small">
            {{ t('Leído por última vez {where}, {ago}', { where: deviceWhere(item.progress.device), ago: timeAgo(item.progress.updated) }) }}
          </p>
          <p v-if="item.summary" class="es-summary">{{ item.summary }}</p>
          <p v-if="item.state === 'error'" class="es-banner es-banner-error">{{ t('No se pudo abrir: {error}', { error: item.error ?? '' }) }}</p>
          <div class="es-hero-actions">
            <button class="es-btn es-primary" :disabled="item.state !== 'ready'" @click="store.read(item)">
              <i class="es-i es-i-book-open" aria-hidden="true"></i>
              {{ item.progress && !item.progress.finished && item.progress.percent > 0 ? t('Seguir leyendo') : item.progress?.finished ? t('Leer otra vez') : t('Leer') }}
            </button>
            <button v-if="item.progress && !item.progress.finished && item.progress.percent > 0" class="es-btn" @click="go({ v: 'read', id: item.id, page: 0 })">{{ t('Desde el principio') }}</button>
            <button v-if="item.format === 'pdf' && item.meta?.text !== false" class="es-btn" :title="pdfAs === 'doc' ? t('Sus páginas como imágenes, en el lector de cómics (doble página, manga, tira)') : t('Como documento: texto que se puede seleccionar y zoom sin perder nitidez')"
                    @click="go({ v: 'read', id: item.id, as: pdfAs === 'doc' ? 'pages' : 'doc' })">
              <i class="es-i" :class="pdfAs === 'doc' ? 'es-i-pages' : 'es-i-page'" aria-hidden="true"></i> {{ pdfAs === 'doc' ? t('Leer como cómic') : t('Leer como documento') }}
            </button>
            <button v-if="!item.progress?.finished" class="es-btn" @click="mark(true)">{{ t('Marcar como leído') }}</button>
            <button v-else class="es-btn" @click="mark(false)">{{ t('Marcar como no leído') }}</button>
            <button v-if="convertTo && !local" class="es-btn" :disabled="converting" :title="convertTo === 'EPUB'
                      ? t('Rehacer este PDF como libro EPUB (texto que se adapta a la pantalla, con su índice), junto al PDF en {server}. Solo para PDF con texto, no escaneados.', { server: serverLabel(store) })
                      : t('Maquetar este libro como PDF (páginas A5, con su índice), junto al libro en {server}: para imprimirlo o leerlo donde solo se lee PDF.', { server: serverLabel(store) })"
                    @click="convert">
              <span v-if="converting" class="es-spin"></span><i v-else class="es-i es-i-book" aria-hidden="true"></i>
              {{ converting ? t('Convirtiendo…') : t('Convertir a {format}', { format: convertTo }) }}
            </button>
            <FavoriteButton :fav="itemFavorite(item)" />
            <FileButton :item="item" :local="local" :uploaded="uploadedAlready" @upload="local ? startUpload() : toCloud()" @reveal="reveal" @removed="backToList" />
          </div>
          <form v-if="uploading !== null" class="es-upload" @submit.prevent="upload">
            <label>{{ t('En {server}, dentro de «{folder}»', { server: serverLabel(store), folder: store.readingRoot }) }}
              <input v-model="uploadPath" type="text" required :disabled="uploading > 0" />
            </label>
            <div class="es-form-actions">
              <button class="es-btn es-primary" type="submit" :disabled="uploading > 0"><span v-if="uploading > 0" class="es-spin"></span> {{ uploading > 0 ? t('Subiendo… {percent} %', { percent: Math.round(uploading * 100) }) : t('Subir') }}</button>
              <button v-if="uploading > 0 && store.shelf?.backend.cancelUpload" class="es-btn" type="button" @click="cancelUpload">{{ t('Cancelar la subida') }}</button>
              <button v-else-if="!(uploading > 0)" class="es-btn" type="button" @click="uploading = null">{{ t('Cancelar') }}</button>
            </div>
            <span v-if="uploading > 0" class="es-job-bar"><span :style="{ width: `${Math.round(uploading * 100)}%` }"></span></span>
          </form>
          <p v-if="origin" class="es-origin"><i class="es-i" :class="local ? 'es-i-computer' : 'es-i-server'" aria-hidden="true"></i> {{ local ? t('En este dispositivo · {origin}', { origin }) : t('De {origin}', { origin }) }}</p>
          <p v-if="item.progress && !item.progress.finished && item.progress.percent > 0" class="es-muted es-small">
            {{ t('Vas por el {percent} %', { percent: Math.round(item.progress.percent * 100) }) }}<template v-if="item.progress.page !== null && item.kind !== 'book'"> {{ t('(página {page})', { page: item.progress.page + 1 }) }}</template>
            <template v-if="item.progress.device"> · {{ t('desde {device}', { device: item.progress.device }) }}</template>
          </p>
        </div>
      </div>

      <section v-if="item.bookmarks.length" class="es-section">
        <h2 class="es-h2">{{ t('Notas y marcadores') }}</h2>
        <ul class="es-bookmarks">
          <li v-for="b in item.bookmarks" :key="b.id">
            <a href="#" @click.prevent="go({ v: 'read', id: item!.id, page: b.page ?? undefined })">
              <i class="es-i" :class="b.kind === 'bookmark' ? 'es-i-bookmark' : b.kind === 'note' ? 'es-i-note' : 'es-i-marker'" aria-hidden="true"></i>
              <span>
                {{ b.page !== null ? t('Página {page}', { page: b.page + 1 }) : b.kind === 'bookmark' ? b.excerpt || t('En el texto') : '' }}
                <q v-if="b.kind !== 'bookmark' && b.excerpt">{{ b.excerpt.length > 120 ? b.excerpt.slice(0, 120) + '…' : b.excerpt }}</q>
                <template v-if="b.note"> — {{ b.note }}</template>
              </span>
            </a>
            <button class="es-mini" :title="t('Quitar')" @click="removeBookmark(b.id)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </li>
        </ul>
      </section>

      <section class="es-section">
        <h2 class="es-h2">{{ t('Archivo') }}</h2>
        <p class="es-muted es-small es-path">{{ item.path }}</p>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { ItemDetail } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { isLocal } from '../lib/local'
import { deviceName, kindLabel, loadSettings, serverLabel, sizeLabel, sourceName, useStore } from '../lib/store'
import Cover from './Cover.vue'
import FileButton from './FileButton.vue'
import FavoriteButton from './FavoriteButton.vue'
import { deviceWhere } from '../lib/handoff'
import { timeAgo } from '../lib/follows'
import { itemFavorite } from '../lib/favorites'
import { alreadyOnServer } from '../lib/uploads'

const props = defineProps<{ id: number }>()
const store = useStore()
const { state, go } = store
const item = ref<ItemDetail | null>(null)
const loading = ref(true)
const saving = ref(false)
const origin = computed(() => (item.value ? sourceName(item.value, state.status?.sources) : ''))
const local = computed(() => !!item.value && isLocal(item.value.id))
const pdfAs = loadSettings().pdf

// ---- a file of this PC up to the Archivador ----
/** null: not asked; 0: asking where; 0–1: how much went */
const uploading = ref<number | null>(null)
const uploadPath = ref('')
/** a file of this PC the server has already (where it would go): it is not offered to upload */
const uploadedAlready = ref(false)
async function checkUploaded(fresh = false): Promise<boolean> {
  if (!item.value || !local.value || !state.server) return (uploadedAlready.value = false)
  try { uploadedAlready.value = (await alreadyOnServer(store, [item.value], fresh)).has(item.value.id) } catch (_) { uploadedAlready.value = false }
  return uploadedAlready.value
}
watch(() => [item.value?.id, state.server], () => { checkUploaded() }, { immediate: true })
async function startUpload() {
  if (!item.value || !store.shelf) return
  // looked at again in the cloud first: if it is there, it is said, not offered
  if (await checkUploaded(true)) { store.notify(t('Ya está en {server}.', { server: serverLabel(store) })); return }
  uploadPath.value = store.shelf.uploadPath(item.value.id, state.status?.folders || [])
  uploading.value = 0
}
async function upload() {
  if (!item.value || !store.shelf) return
  const dest = uploadPath.value.trim().replace(/^\/+/, '')
  uploading.value = 0.001
  try {
    const done = await store.shelf.backend.upload(item.value.id, dest, (sent, total) => { uploading.value = Math.max(0.001, sent / Math.max(1, total)) })
    store.notify(t('Subido a {path}.', { path: done.path }))
    uploading.value = null
    uploadedAlready.value = true
    store.refresh()
  } catch (err: any) {
    if (cancelling) store.notify(t('Subida cancelada.'))
    else store.notify(t('No se pudo subir: {error}', { error: err?.message || err }), true)
    uploading.value = cancelling ? null : 0
  }
  cancelling = false
}
let cancelling = false
function cancelUpload() {
  if (!item.value || !store.shelf?.backend.cancelUpload) return
  cancelling = true
  store.shelf.backend.cancelUpload(item.value.id).catch(() => {})
}
/** gone from the shelf: back to where it was listed (the folder, «Archivos sueltos»), not to the top */
function backToList() {
  if (window.history.length > 1) window.history.back()
  else go({ v: 'library', source: String(item.value?.source_id ?? '') }, true)
}
async function reveal() {
  if (!item.value || !store.shelf) return
  try { await store.shelf.backend.reveal(item.value.id) } catch (err: any) { store.notify(err?.message || String(err), true) }
}

async function toCloud() {
  if (!item.value) return
  saving.value = true
  try {
    const r = await store.api.saveItem(item.value.id)
    store.notify(t('Guardado en {path}', { path: r.path }))
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
const converting = ref(false)
/** What this item can be converted into: a PDF with text into an EPUB, a book into a PDF. */
// a PDF only when it has text (the service says; a scanned book or a comic has nothing to convert)
const convertTo = computed(() => !item.value ? '' : item.value.format === 'pdf' ? (item.value.meta?.text === false ? '' : 'EPUB') : ['epub', 'fb2', 'fbz', 'mobi', 'txt'].includes(item.value.format) ? 'PDF' : '')
async function convert() {
  if (!item.value) return
  converting.value = true
  store.notify(t('Convirtiendo a {format}: puede tardar unos segundos…', { format: convertTo.value }))
  try {
    const r = await store.api.convertToEpub(item.value.id)
    store.notify(r.stats.to === 'pdf'
      ? t('Hecho: «{title}», {pages} páginas. Lo tienes junto al libro.', { title: r.stats.title, pages: r.stats.pages ?? '' })
      : t('Hecho: «{title}», {chapters} capítulos. Lo tienes junto al PDF.', { title: r.stats.title, chapters: r.stats.chapters }))
    store.refresh()
    if (r.item) go({ v: 'item', id: r.item.id })
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  converting.value = false
}

async function load() {
  if (!state.connected) return
  try { item.value = await store.api.item(props.id) } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
async function mark(finished: boolean) {
  if (!item.value) return
  try {
    if (finished) await store.api.setProgress(item.value.id, { page: item.value.kind === 'book' ? null : Math.max(0, item.value.pages - 1), percent: 1, finished: true,
                                                               device: deviceName(store), updated: Date.now() / 1000 })
    else await store.api.clearProgress(item.value.id)
    await load()
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function removeBookmark(id: number) {
  try { await store.api.deleteBookmark(id); await load() } catch (err: any) { store.notify(err?.message || String(err), true) }
}
onMounted(load)
watch(() => state.connected, load)
</script>
