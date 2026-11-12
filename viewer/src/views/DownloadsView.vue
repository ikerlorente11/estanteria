<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Descargas') }}</h1>
      <span class="es-grow"></span>
      <label v-if="offline" class="es-muted es-small" :title="t('Ancho al que se guardan las páginas: más, más nitidez en pantallas grandes y más espacio')">{{ t('Calidad') }}
        <select class="es-select" :value="offline.state.width" @change="offline.setWidth(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="w in OFFLINE_WIDTHS" :key="w" :value="w">{{ w === 1600 ? t('{w} px (recomendada)', { w }) : `${w} px` }}</option>
        </select>
      </label>
    </header>

    <template v-if="!offline && store.downloads">
      <p class="es-muted es-intro">{{ t('Los archivos que descargas quedan en esta app (su carpeta «descargas») y se abren con otra app. Lo que lees aquí sigue viniendo de {server}.', { server: serverLabel(store) }) }}</p>
      <p v-if="!files.length" class="es-muted">{{ t('Nada todavía. En la ficha de un cómic o un libro, o en una carpeta, tienes «Descargar».') }}</p>
      <ul v-else class="es-jobs">
        <li v-for="f in files" :key="f.path" class="es-job" :class="{ 'es-job-bad': f.state === 'error' }">
          <span class="es-job-text">
            <strong class="es-ellipsis">{{ f.name }}</strong>
            <small class="es-muted">{{ f.state === 'downloading' ? t('Descargando {percent} %', { percent: f.percent ?? 0 }) : f.state === 'error' ? t('No se pudo: {error}', { error: f.error ?? '' }) : f.bytes ? sizeLabel(f.bytes) : t('Descargado') }}</small>
            <span v-if="f.state === 'downloading'" class="es-job-bar"><span :style="{ width: `${f.percent ?? 0}%` }"></span></span>
          </span>
          <button v-if="f.id" class="es-btn es-small" @click="go({ v: 'item', id: f.id })">{{ t('Ficha') }}</button>
          <button v-if="f.state === 'done'" class="es-btn es-small" @click="store.saveFile?.(f.path, f.name)">{{ t('Abrir') }}</button>
          <button class="es-mini" :title="t('Borrar de este dispositivo')" @click="store.removeDownload?.(f.path)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
        </li>
      </ul>
      <button v-if="files.length > 1" class="es-btn es-more" @click="removeDownloads"><i class="es-i es-i-delete" aria-hidden="true"></i> {{ t('Borrar todas las descargas') }}</button>
    </template>
    <p v-else-if="!offline" class="es-muted">{{ t('Esta versión no guarda copias; usa la app de escritorio o la de Android.') }}</p>
    <template v-else>
      <p class="es-muted es-intro">
        {{ t('Lo descargado se lee sin conexión y, aunque haya, se abre desde este equipo, al instante. El progreso que hagas sin conexión se envía en cuanto vuelva. Los cómics y libros de este dispositivo no hace falta descargarlos: ya están en tu estantería.') }}
        <template v-if="offline.count"> <template v-if="where">{{ t('Ocupa {size} en', { size: sizeLabel(offline.bytes) }) }} <span class="es-path">{{ where }}</span>.</template><template v-else>{{ t('Ocupa {size}.', { size: sizeLabel(offline.bytes) }) }}</template></template>
      </p>

      <section v-if="jobs.length || catalogRunning.length" class="es-section">
        <header class="es-page-head es-subhead">
          <h2 class="es-h2">{{ t('En curso') }}</h2>
          <span class="es-grow"></span>
          <ConfirmButton :label="t('Parar todo')" icon="es-i-close" :question="t('¿Parar las {n} descargas (las que esperan y las que van)?', { n: jobs.length + catalogRunning.length })" :action="stopAll" />
        </header>
        <ul class="es-jobs">
          <!-- what comes from the catalogs (chapters, books) -->
          <li v-for="j in catalogRunning" :key="j.key" class="es-job">
            <span class="es-job-text">
              <strong class="es-ellipsis">{{ j.title }}</strong>
              <small class="es-muted">{{ jobLabel(j) || t('Empezando…') }}</small>
              <span class="es-job-bar"><span :style="{ width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%` }"></span></span>
            </span>
            <button class="es-mini" :title="j.waiting ? t('Quitar de la cola') : t('Parar')" @click="cancelCatalogDownloads([j.key])"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </li>
          <li v-for="j in jobs" :key="j.id" class="es-job" :class="{ 'es-job-bad': j.state === 'error' }">
            <span class="es-job-text">
              <strong class="es-ellipsis">{{ j.title }}</strong>
              <small class="es-muted">
                <template v-if="j.state === 'waiting'">{{ t('En cola') }}</template>
                <template v-else-if="j.state === 'running'">{{ t('{done} de {total}', { done: j.done, total: j.total }) }}<template v-if="j.bytes"> · {{ sizeLabel(j.bytes) }}</template></template>
                <template v-else>{{ t('No se pudo: {error}', { error: j.error ?? '' }) }}</template>
              </small>
              <span v-if="j.state === 'running'" class="es-job-bar"><span :style="{ width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%` }"></span></span>
            </span>
            <button v-if="j.state === 'error'" class="es-btn es-small" @click="retry(j.id)">{{ t('Reintentar') }}</button>
            <button class="es-mini" :title="j.state === 'running' ? t('Parar') : t('Quitar de la cola')" @click="offline.remove(j.id)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </li>
        </ul>
      </section>

      <section class="es-section">
        <header class="es-page-head es-subhead">
          <h2 class="es-h2">{{ t('Descargado') }}</h2>
          <span class="es-grow"></span>
          <ConfirmButton v-if="total" :label="t('Borrar todo')" icon="es-i-delete" :question="t('¿Borrar las {n} descargas?', { n: total })" :action="removeAll" />
        </header>
        <p v-if="!kept.length && !fromCatalogs.length" class="es-muted">{{ t('Nada todavía. En la ficha de un cómic o un libro, en una serie o en una carpeta tienes «Descargar».') }}</p>
        <div v-if="kept.length" class="es-grid">
          <ItemCard v-for="i in kept" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>

      <!-- what came from the catalogs: files on this device's shelf, by series -->
      <section v-if="fromCatalogs.length" class="es-section">
        <h2 class="es-h2">{{ t('De los catálogos') }}</h2>
        <div class="es-grid">
          <ItemCard v-for="i in fromCatalogs" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import ConfirmButton from './ConfirmButton.vue'
import { cancelCatalogDownloads, catalogItemIds, catalogJobs, jobLabel } from '../lib/catalogdownloads'
import { clearAllDownloads, downloadsCount } from '../lib/downloads'
import { computed, onMounted, ref } from 'vue'
import { plural, t } from '../lib/i18n'
import { OFFLINE_WIDTHS } from '../lib/offline'
import { serverLabel, sizeLabel, useStore } from '../lib/store'
import ItemCard from './ItemCard.vue'

const store = useStore()
const { go } = store
const offline = computed(() => store.offline)
const where = ref('')

const jobs = computed(() => Object.values(offline.value?.state.jobs || {}))
/** the files a host without offline reading keeps (Android: plain downloads), by name */
const files = computed(() => Object.entries(store.downloads || {})
  .map(([path, d]) => ({ path, ...d, name: d.name || decodeURIComponent(path.split('/').pop() || path), id: Number(path.match(/\/api\/items\/(\d+)\/file/)?.[1]) || 0 }))
  .sort((a, b) => a.name.localeCompare(b.name)))
function removeDownloads() {
  for (const f of files.value) store.removeDownload?.(f.path)
}
const kept = computed(() => Object.values(offline.value?.state.entries || {})
  .sort((a, b) => (a.item.series || a.item.title).localeCompare(b.item.series || b.item.title) || (a.item.number ?? 0) - (b.item.number ?? 0))
  .map((e) => e.item))

function retry(id: number) {
  const o = offline.value
  if (!o) return
  const title = o.state.jobs[id]?.title
  delete o.state.jobs[id]
  o.add([{ id, title, series: null, number: null, pages: 0, format: 'cbz' } as any])
}
/** what was downloaded from the catalogs and is still on the shelf, by series and number */
const fromCatalogs = computed(() => {
  const shelf = store.shelf
  if (!shelf) return []
  void shelf.state.files                                  // listed again when the shelf changes
  return catalogItemIds().map((id) => shelf.item(id)).filter((i): i is NonNullable<typeof i> => !!i)
    .sort((a, b) => (a.series || a.title).localeCompare(b.series || b.title, 'es') || (a.number ?? 0) - (b.number ?? 0))
})
const total = computed(() => downloadsCount(store))
/** every download going or waiting, stopped (copies kept offline and what comes from the catalogs) */
async function stopAll() {
  const n = jobs.value.length + cancelCatalogDownloads()
  for (const j of [...jobs.value]) await offline.value?.remove(j.id)
  store.notify(plural(n, '{n} descarga parada.', '{n} descargas paradas.'))
}
async function removeAll() {
  const n = await clearAllDownloads(store)
  store.notify(plural(n, '{n} descarga borrada.', '{n} descargas borradas.'))
  store.refresh()
}
onMounted(async () => { try { where.value = (await offline.value?.where()) || '' } catch (_) {} })
const catalogRunning = computed(() => Object.values(catalogJobs))
</script>
