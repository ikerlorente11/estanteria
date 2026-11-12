<template>
  <section class="es-page">
    <PullRefresh :action="scan" />
    <header class="es-page-head">
      <h1 class="es-h1">{{ greeting }}</h1>
      <span class="es-grow"></span>
      <!-- with a mouse there is no pulling down: a button (a phone pulls the page down instead) -->
      <button v-if="state.server || store.shelf" class="es-btn es-mouse-only" :disabled="scanning" :title="state.server ? t('Mirar ya si hay archivos nuevos en tu servidor y en las carpetas de este dispositivo') : t('Mirar otra vez qué hay en las carpetas de este dispositivo')" @click="scan">
        <span v-if="scanning" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i> {{ t('Actualizar') }}
      </button>
    </header>

    <div v-if="empty" class="es-empty es-home-empty">
      <span class="es-empty-icon"><i class="es-i es-i-book" aria-hidden="true"></i></span>
      <p><strong>{{ t('Aún no hay nada que leer.') }}</strong></p>
      <p v-if="state.server && !store.shelf" class="es-muted">{{ t('Deja cómics, documentos y libros en la carpeta «{folder}» (una subcarpeta por serie) o conecta una biblioteca, y aparecerán aquí.', { folder: store.readingRoot }) }}</p>
      <p v-else class="es-muted">{{ t('Conecta una biblioteca o añade a tu estantería los cómics, documentos y libros de este dispositivo.') }}</p>
      <div class="es-empty-actions">
        <button class="es-btn es-primary" @click="go({ v: 'sources', add: true })"><i class="es-i es-i-server" aria-hidden="true"></i> {{ t('Conectar una biblioteca') }}</button>
        <button class="es-btn" @click="go({ v: 'library' })"><i class="es-i es-i-grid" aria-hidden="true"></i> {{ t('Ir a la estantería') }}</button>
      </div>
    </div>

    <template v-else>
      <section v-if="going.length" class="es-section">
        <h2 class="es-h2">{{ t('Seguir leyendo') }}</h2>
        <div class="es-grid">
          <ItemCard v-for="i in going" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>

      <section class="es-section">
        <h2 class="es-h2">{{ t('Novedades') }}</h2>
        <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
        <p v-else-if="!recent.length" class="es-muted">{{ t('Nada todavía.') }}</p>
        <div v-else class="es-grid">
          <ItemCard v-for="i in recent" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
      </section>

      <section v-if="state.series.length" class="es-section">
        <h2 class="es-h2">{{ t('Series') }}</h2>
        <div class="es-grid">
          <a v-for="s in state.series" :key="s.series" href="#" class="es-series-card" @click.prevent="go({ v: 'series', name: s.series })">
            <Cover :id="s.cover_item" :has="s.cover" />
            <strong class="es-ellipsis">{{ s.series }}</strong>
            <small class="es-muted">{{ plural(s.items, '{n} número', '{n} números') }}<template v-if="s.finished"> · {{ plural(s.finished, '{n} leído', '{n} leídos') }}</template></small>
          </a>
        </div>
      </section>
    </template>
    <AddButton v-if="store.shelf" />
  </section>
</template>

<script setup lang="ts">
import { useSync } from '../lib/favorites'
import PullRefresh from './PullRefresh.vue'
import { lookForNew } from '../lib/refresh'
import { computed, onMounted, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'
import AddButton from './AddButton.vue'

const store = useStore()
// what is shared with the other devices, kept in step from the first page (see sync.ts)
useSync(store)
const { state, go } = store
const going = ref<Item[]>([])
const recent = ref<Item[]>([])
const loading = ref(true)
const scanning = ref(false)

/** nothing at all: no library with anything in it, nothing of this device */
const empty = computed(() => state.loaded && !loading.value && !!state.status && !state.status.total && !going.value.length && !recent.value.length)

const greeting = computed(() => {
  const h = new Date().getHours()
  return h < 6 ? t('Buenas noches') : h < 14 ? t('Buenos días') : h < 21 ? t('Buenas tardes') : t('Buenas noches')
})

async function load() {
  if (!state.connected) return
  try {
    const [g, r] = await Promise.all([store.api.continueReading(12), store.api.recent(18)])
    going.value = g
    recent.value = r
  } catch (err: any) {
    // without a library there is simply nothing to show; anything else is worth saying
    if (!err?.noServer) store.notify(err?.message || String(err), true)
  }
  loading.value = false
}
async function scan() {
  scanning.value = true
  await lookForNew(store)
  await load()
  scanning.value = false
}
onMounted(load)
watch(() => state.connected, load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
</script>
