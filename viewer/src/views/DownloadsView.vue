<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">Descargas</h1>
      <span class="es-grow"></span>
      <label v-if="offline" class="es-muted es-small" title="Ancho al que se guardan las páginas: más, más nitidez en pantallas grandes y más espacio">Calidad
        <select class="es-select" :value="offline.state.width" @change="offline.setWidth(Number(($event.target as HTMLSelectElement).value))">
          <option v-for="w in OFFLINE_WIDTHS" :key="w" :value="w">{{ w }} px{{ w === 1600 ? ' (recomendada)' : '' }}</option>
        </select>
      </label>
    </header>

    <p v-if="!offline" class="es-muted">Esta versión de La Estantería no guarda copias; usa la app de escritorio o la de Android.</p>
    <template v-else>
      <p class="es-muted es-intro">
        Lo descargado se lee sin conexión y, aunque haya, se abre desde este equipo, al instante. El progreso que hagas sin conexión se envía en cuanto vuelva. Los cómics y libros de este equipo no hace falta descargarlos: están en la biblioteca, en «En este PC».
        <template v-if="offline.count"> Ocupa {{ sizeLabel(offline.bytes) }}<template v-if="where"> en <span class="es-path">{{ where }}</span></template>.</template>
      </p>

      <section v-if="jobs.length" class="es-section">
        <h2 class="es-h2">En curso</h2>
        <ul class="es-jobs">
          <li v-for="j in jobs" :key="j.id" class="es-job" :class="{ 'es-job-bad': j.state === 'error' }">
            <span class="es-job-text">
              <strong class="es-ellipsis">{{ j.title }}</strong>
              <small class="es-muted">
                <template v-if="j.state === 'waiting'">En cola</template>
                <template v-else-if="j.state === 'running'">{{ j.done }} de {{ j.total }}<template v-if="j.bytes"> · {{ sizeLabel(j.bytes) }}</template></template>
                <template v-else>No se pudo: {{ j.error }}</template>
              </small>
              <span v-if="j.state === 'running'" class="es-job-bar"><span :style="{ width: `${j.total ? Math.round((j.done / j.total) * 100) : 0}%` }"></span></span>
            </span>
            <button v-if="j.state === 'error'" class="es-btn es-small" @click="retry(j.id)">Reintentar</button>
            <button class="es-mini" :title="j.state === 'running' ? 'Parar' : 'Quitar de la cola'" @click="offline.remove(j.id)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </li>
        </ul>
      </section>

      <section class="es-section">
        <h2 v-if="jobs.length" class="es-h2">Descargado</h2>
        <p v-if="!kept.length" class="es-muted">Nada todavía. En la ficha de un cómic o un libro, en una serie o en una carpeta tienes «Descargar».</p>
        <div v-else class="es-grid">
          <ItemCard v-for="i in kept" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
        <button v-if="kept.length" class="es-btn es-more" @click="removeAll"><i class="es-i es-i-delete" aria-hidden="true"></i> Quitar todas las copias</button>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { OFFLINE_WIDTHS } from '../lib/offline'
import { sizeLabel, useStore } from '../lib/store'
import ItemCard from './ItemCard.vue'

const store = useStore()
const { go } = store
const offline = computed(() => store.offline)
const where = ref('')

const jobs = computed(() => Object.values(offline.value?.state.jobs || {}))
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
async function removeAll() {
  const o = offline.value
  if (!o) return
  const n = o.count
  await o.removeAll(Object.keys(o.state.entries).map(Number))
  store.notify(`${n} ${n === 1 ? 'copia quitada' : 'copias quitadas'} de este equipo.`)
}
onMounted(async () => { try { where.value = (await offline.value?.where()) || '' } catch (_) {} })
</script>
