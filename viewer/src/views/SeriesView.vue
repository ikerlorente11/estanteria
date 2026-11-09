<template>
  <section class="es-page">
    <div class="es-hero">
      <Cover v-if="first" :id="first.id" :has="first.cover" class="es-hero-pic" />
      <div class="es-hero-text">
        <p class="es-muted es-small es-crumbs"><a href="#" @click.prevent="go({ v: 'library' })">Biblioteca</a> › Serie</p>
        <h1 class="es-h1 es-big">{{ name }}</h1>
        <p class="es-muted">
          {{ items.length }} {{ items.length === 1 ? 'número' : 'números' }}<template v-if="finished"> · {{ finished }} {{ finished === 1 ? 'leído' : 'leídos' }}</template>
          <template v-if="author"> · {{ author }}</template>
        </p>
        <div class="es-hero-actions">
          <button v-if="next" class="es-btn es-primary" @click="store.read(next)">
            <i class="es-i es-i-book-open" aria-hidden="true"></i> {{ next.progress && next.progress.page ? `Seguir por el nº ${next.number ?? ''}` : finished ? `Leer el nº ${next.number ?? ''}` : 'Empezar a leer' }}
          </button>
        </div>
      </div>
    </div>
    <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
    <div v-else class="es-grid">
      <ItemCard v-for="i in items" :key="i.id" :item="i" :show-series="false" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'

const props = defineProps<{ name: string }>()
const store = useStore()
const { state, go } = store
const items = ref<Item[]>([])
const loading = ref(true)

const first = computed(() => items.value[0])
const finished = computed(() => items.value.filter((i) => i.progress?.finished).length)
const author = computed(() => items.value.find((i) => i.author)?.author || '')
/** The number to go on with: one started, else the first not finished. */
const next = computed(() => items.value.find((i) => i.progress && !i.progress.finished && i.progress.percent > 0) || items.value.find((i) => !i.progress?.finished) || items.value[0])

async function load() {
  if (!state.connected) return
  try { items.value = await store.api.items({ series: props.name, sort: 'series', limit: 1000 }) } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
onMounted(load)
watch(() => state.connected, load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
</script>
