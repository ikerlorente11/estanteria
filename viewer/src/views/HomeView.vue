<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ greeting }}</h1>
      <span class="es-grow"></span>
      <button class="es-btn" :disabled="scanning" title="Mirar ya si hay archivos nuevos en Lectura" @click="scan">
        <span v-if="scanning" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i> Buscar nuevos
      </button>
    </header>

    <div v-if="state.loaded && state.status && !state.status.total" class="es-empty">
      <span class="es-empty-icon"><i class="es-i es-i-book" aria-hidden="true"></i></span>
      <p><strong>Tu estantería está vacía.</strong> Deja cómics (cbz, cbr, pdf) y libros (epub) en la carpeta «{{ store.readingRoot }}» de tu nube, una subcarpeta por serie, y aparecerán aquí.</p>
    </div>

    <template v-else>
      <section v-if="going.length" class="es-section">
        <h2 class="es-h2">Seguir leyendo</h2>
        <div class="es-grid">
          <ItemCard v-for="i in going" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>

      <section class="es-section">
        <h2 class="es-h2">Novedades</h2>
        <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
        <p v-else-if="!recent.length" class="es-muted">Nada todavía.</p>
        <div v-else class="es-grid">
          <ItemCard v-for="i in recent" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>

      <section v-if="state.series.length" class="es-section">
        <h2 class="es-h2">Series</h2>
        <div class="es-grid">
          <a v-for="s in state.series" :key="s.series" href="#" class="es-series-card" @click.prevent="go({ v: 'series', name: s.series })">
            <Cover :id="s.cover_item" :has="s.cover" />
            <strong class="es-ellipsis">{{ s.series }}</strong>
            <small class="es-muted">{{ s.items }} {{ s.items === 1 ? 'número' : 'números' }}<template v-if="s.finished"> · {{ s.finished }} leídos</template></small>
          </a>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'

const store = useStore()
const { state, go } = store
const going = ref<Item[]>([])
const recent = ref<Item[]>([])
const loading = ref(true)
const scanning = ref(false)

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'
})

async function load() {
  if (!state.connected) return
  try {
    const [g, r] = await Promise.all([store.api.continueReading(12), store.api.recent(18)])
    going.value = g
    recent.value = r
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
async function scan() {
  scanning.value = true
  try {
    const r = await store.api.scan()
    const news = r.new + r.changed
    store.notify(news ? `${news} ${news === 1 ? 'archivo nuevo' : 'archivos nuevos'}; se están abriendo.` : 'No hay nada nuevo.')
    await store.refresh()
    await load()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  scanning.value = false
}
onMounted(load)
watch(() => state.connected, load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
</script>
