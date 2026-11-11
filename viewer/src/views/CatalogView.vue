<template>
  <DeviceCatalogView v-if="device" :key="device.id" :def="device" :path="path" :q="q" />
  <section v-else class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p class="es-muted es-small es-crumbs">
          <a href="#" @click.prevent="go({ v: 'catalogs' })">{{ t('Catálogos') }}</a>
          <template v-if="path || q"> › <a href="#" @click.prevent="go({ v: 'catalog', kind })">{{ label }}</a></template>
        </p>
        <h1 class="es-h1">{{ listing?.title || label }}</h1>
      </div>
      <span class="es-grow"></span>
      <button v-if="listing && listing.entries.length" class="es-btn" :disabled="savingAll" :title="listing.next ? t('Guardar en tu estantería todo lo que hay aquí, incluidas las páginas siguientes') : t('Guardar en tu estantería todo lo que hay aquí')" @click="keepAll">
        <span v-if="savingAll" class="es-spin"></span><i v-else class="es-i es-i-bookmark" aria-hidden="true"></i> {{ t('Guardar todo') }}
      </button>
      <input ref="searchEl" :value="q" class="es-search" type="search" :placeholder="t('Buscar en {name}', { name: label })" :aria-label="t('Buscar')"
             @keydown.enter="search(($event.target as HTMLInputElement).value)" @input="typed(($event.target as HTMLInputElement).value)" />
    </header>

    <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
    <template v-else-if="listing">
      <div v-if="listing.cover || listing.summary" class="es-hero es-hero-slim">
        <Cover v-if="listing.cover" :src="store.api.catalogCoverPath(kind, listing.cover)" class="es-hero-pic es-hero-pic-small" />
        <div class="es-hero-text">
          <p v-if="listing.subtitle" class="es-muted">{{ listing.subtitle }}</p>
          <p v-if="listing.summary" class="es-summary">{{ listing.summary }}</p>
        </div>
      </div>

      <div v-if="chips.length" class="es-chips es-chips-big">
        <a v-for="s in chips" :key="s.path" href="#" class="es-chip" :title="s.subtitle || ''" @click.prevent="open(s.path)">{{ s.title }}</a>
      </div>

      <div v-if="shelves.length" class="es-grid">
        <a v-for="s in shelves" :key="s.path" href="#" class="es-series-card" :title="s.summary || s.title" @click.prevent="open(s.path)">
          <Cover :src="s.cover ? store.api.catalogCoverPath(kind, s.cover) : ''" :has="!!s.cover" />
          <strong class="es-ellipsis">{{ s.title }}</strong>
          <small v-if="s.subtitle" class="es-muted es-ellipsis">{{ s.subtitle }}</small>
        </a>
      </div>

      <div v-if="listing.entries.length" class="es-grid">
        <article v-for="e in listing.entries" :key="e.id" class="es-card es-entry" :class="{ 'es-entry-kept': e.item }">
          <a href="#" class="es-card-cover" :title="t('Leer «{title}»', { title: e.title })" @click.prevent="read(e)">
            <Cover :src="store.api.catalogCoverPath(kind, e.id)" :has="e.cover" :icon="e.kind === 'book' ? 'es-i-book' : 'es-i-pages'">
              <span v-if="busy === e.id" class="es-card-wait"><span class="es-spin"></span></span>
              <span v-else-if="e.item" class="es-card-check" :title="t('En tu estantería')"><i class="es-i es-i-check" aria-hidden="true"></i></span>
            </Cover>
          </a>
          <div class="es-card-text">
            <a href="#" class="es-card-title es-ellipsis" :title="e.title" @click.prevent="read(e)">{{ e.title }}</a>
            <span class="es-muted es-small es-ellipsis">{{ subtitle(e) }}</span>
          </div>
          <div class="es-entry-actions">
            <button v-if="!e.item" class="es-btn es-small" :disabled="busy === e.id" :title="t('Guardar en tu estantería para leerlo cuando quieras')" @click="keep(e)">
              <i class="es-i es-i-bookmark" aria-hidden="true"></i> {{ t('Guardar') }}
            </button>
            <button v-else class="es-btn es-small" :disabled="busy === e.id" :title="t('Quitar de tu estantería')" @click="unkeep(e)">
              <i class="es-i es-i-bookmark-fill" aria-hidden="true"></i> {{ t('Guardado') }}
            </button>
            <button class="es-btn es-small" :disabled="busy === e.id" :title="t('Copiar el archivo a la carpeta {folder} de {server}', { folder: store.readingRoot, server: serverLabel(store) })" @click="toCloud(e)">
              <i class="es-i es-i-cloud" aria-hidden="true"></i>
            </button>
          </div>
        </article>
      </div>

      <p v-if="!listing.entries.length && !shelves.length && !chips.length" class="es-muted">{{ q ? t('Nada con «{q}».', { q }) : t('Nada por aquí.') }}</p>
      <button v-if="listing.next" class="es-btn es-more" :disabled="loadingMore" @click="more">
        <span v-if="loadingMore" class="es-spin"></span> {{ t('Ver más') }}
      </button>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { CatalogEntry, CatalogListing } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { serverLabel, useStore } from '../lib/store'
import Cover from './Cover.vue'
import DeviceCatalogView from './DeviceCatalogView.vue'

const LABELS: Record<string, string> = { gutenberg: 'Project Gutenberg', archive: 'Internet Archive', mangadex: 'MangaDex' }
const props = defineProps<{ kind: string; path?: string; q?: string }>()
/** a catalog the app reads by itself (the desktop, Android), rather than one of the server's */
const store = useStore()
const device = computed(() => store.catalogs?.get(props.kind) || null)
const { state, go } = store
const listing = ref<CatalogListing | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const busy = ref('')
const savingAll = ref(false)
const searchEl = ref<HTMLInputElement>()
let typing: any = null
let request = 0

const label = computed(() => LABELS[props.kind] || props.kind)
const chips = computed(() => (listing.value?.sections || []).filter((s) => !s.cover))
const shelves = computed(() => (listing.value?.sections || []).filter((s) => !!s.cover))

function fetch(path: string) {
  return props.q ? store.api.searchCatalog(props.kind, props.q, path) : store.api.browseCatalog(props.kind, path)
}
async function load() {
  if (device.value || !state.connected || !state.server) return
  const mine = ++request
  loading.value = true
  try {
    const got = await fetch(props.path || '')
    if (mine !== request) return
    listing.value = got
  } catch (err: any) { store.notify(err?.message || String(err), true); listing.value = null }
  if (mine === request) loading.value = false
}
async function more() {
  if (!listing.value?.next) return
  loadingMore.value = true
  try {
    const got = await fetch(listing.value.next)
    listing.value = { ...got, sections: [...listing.value.sections, ...got.sections], entries: [...listing.value.entries, ...got.entries] }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  loadingMore.value = false
}
function open(path: string) { go({ v: 'catalog', kind: props.kind, path }) }
function search(value: string) {
  clearTimeout(typing)
  const q = value.trim()
  go(q ? { v: 'catalog', kind: props.kind, q } : { v: 'catalog', kind: props.kind }, !!props.q)
}
function typed(value: string) {
  clearTimeout(typing)
  typing = setTimeout(() => search(value), 500)
}
function subtitle(e: CatalogEntry): string {
  const parts: string[] = []
  if (e.author) parts.push(e.author)
  parts.push(e.format === 'folder' ? t('Carpeta') : e.format.toUpperCase())
  if (e.pages && e.kind !== 'book') parts.push(t('{n} págs.', { n: e.pages }))
  if (e.year) parts.push(String(e.year))
  if (e.language && e.kind === 'book') parts.push(e.language)
  return parts.join(' · ')
}
async function keep(e: CatalogEntry): Promise<number | null> {
  busy.value = e.id
  try {
    const item = await store.api.keepEntry(props.kind, e.id)
    e.item = item.id
    store.refresh()
    return item.id
  } catch (err: any) { store.notify(err?.message || String(err), true); return null } finally { busy.value = '' }
}
async function unkeep(e: CatalogEntry) {
  if (!e.item) return
  busy.value = e.id
  try {
    await store.api.removeItem(e.item)
    e.item = null
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) } finally { busy.value = '' }
}
async function read(e: CatalogEntry) {
  const id = e.item || (await keep(e))
  if (id) go({ v: 'read', id })
}
async function keepAll() {
  if (!listing.value) return
  savingAll.value = true
  try {
    const r = await store.api.keepListing(props.kind, props.path || '', props.q || '')
    store.notify(!r.saved ? t('No había nada que guardar.')
      : r.complete ? plural(r.saved, '{n} elemento guardado en tu estantería.', '{n} elementos guardados en tu estantería.')
      : plural(r.saved, '{n} elemento guardado en tu estantería (había más: se ha parado en ese tope).', '{n} elementos guardados en tu estantería (había más: se ha parado en ese tope).'))
    store.refresh()
    await load()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  savingAll.value = false
}
async function toCloud(e: CatalogEntry) {
  busy.value = e.id
  store.notify(t('Copiando «{title}» a {server}…', { title: e.title, server: serverLabel(store) }))
  try {
    const item = await store.api.keepEntry(props.kind, e.id, 'archivador')
    e.item = item.id
    store.notify(t('Guardado en {where}', { where: item.saved_to }))
    store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) } finally { busy.value = '' }
}
onMounted(load)
watch(() => state.connected, load)
watch(() => [props.kind, props.path, props.q], load)
</script>
