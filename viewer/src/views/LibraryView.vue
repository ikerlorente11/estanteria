<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">Biblioteca</h1>
      <span class="es-grow"></span>
      <input ref="searchEl" :value="q" class="es-search" type="search" placeholder="Buscar por título, serie o autor" aria-label="Buscar"
             @input="typed(($event.target as HTMLInputElement).value)" />
    </header>
    <div class="es-filters">
      <div class="es-chips" role="tablist" aria-label="Tipo">
        <button v-for="k in KINDS" :key="k.id" class="es-chip" :class="{ on: (kind || '') === k.id }" @click="setKind(k.id)">{{ k.label }}</button>
      </div>
      <span class="es-grow"></span>
      <label class="es-muted es-small">Orden
        <select class="es-select" :value="sort || 'series'" @change="setSort(($event.target as HTMLSelectElement).value)">
          <option value="series">Serie y número</option>
          <option value="title">Título</option>
          <option value="added">Más recientes</option>
          <option value="modified">Última modificación</option>
        </select>
      </label>
    </div>
    <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
    <p v-else-if="!items.length" class="es-muted">{{ q ? `Nada con «${q}».` : 'Nada por aquí.' }}</p>
    <div v-else class="es-grid">
      <ItemCard v-for="i in items" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
    </div>
    <button v-if="items.length && items.length % PAGE === 0 && !exhausted" class="es-btn es-more" :disabled="loadingMore" @click="more">
      <span v-if="loadingMore" class="es-spin"></span> Ver más
    </button>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Item, Kind } from '../lib/api'
import { useStore } from '../lib/store'
import ItemCard from './ItemCard.vue'

const PAGE = 60
const KINDS = [{ id: '', label: 'Todo' }, { id: 'comic', label: 'Cómics' }, { id: 'pdf', label: 'PDF' }, { id: 'book', label: 'Libros' }]
const props = defineProps<{ q: string; kind?: string; sort?: string; folder?: string }>()
const store = useStore()
const { state, go } = store
const items = ref<Item[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const exhausted = ref(false)
const searchEl = ref<HTMLInputElement>()
let typing: any = null
let request = 0

function query(offset = 0) {
  return { q: props.q || undefined, kind: (props.kind || undefined) as Kind | undefined, sort: (props.sort || 'series') as any, folder: props.folder, limit: PAGE, offset }
}
async function load() {
  if (!state.connected) return
  const mine = ++request
  loading.value = true
  try {
    const got = await store.api.items(query())
    if (mine !== request) return
    items.value = got
    exhausted.value = got.length < PAGE
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  if (mine === request) loading.value = false
}
async function more() {
  loadingMore.value = true
  try {
    const got = await store.api.items(query(items.value.length))
    items.value = [...items.value, ...got]
    exhausted.value = got.length < PAGE
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  loadingMore.value = false
}
function current() {
  return { v: 'library' as const, q: props.q || undefined, kind: props.kind, sort: props.sort, folder: props.folder }
}
function typed(value: string) {
  clearTimeout(typing)
  typing = setTimeout(() => go({ ...current(), q: value.trim() || undefined }, true), 250)
}
function setKind(kind: string) { go({ ...current(), kind: kind || undefined }, true) }
function setSort(sort: string) { go({ ...current(), sort: sort === 'series' ? undefined : sort }, true) }

onMounted(load)
watch(() => state.connected, load)
watch(() => [props.q, props.kind, props.sort, props.folder], load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
</script>
