<template>
  <section class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p v-if="folderMode && crumbs.length" class="es-muted es-small es-crumbs">
          <a href="#" @click.prevent="openFolder('')">{{ store.readingRoot }}</a>
          <template v-for="c in crumbs" :key="c.path"> › <a href="#" @click.prevent="openFolder(c.path)">{{ c.name }}</a></template>
        </p>
        <h1 class="es-h1">{{ folderMode && crumbs.length ? crumbs[crumbs.length - 1].name : 'Biblioteca' }}</h1>
      </div>
      <span class="es-grow"></span>
      <OfflineButton v-if="store.offline && folderMode && crumbs.length && inFolder.length" :items="inFolder" what="la carpeta" />
      <input ref="searchEl" :value="q" class="es-search" type="search" placeholder="Buscar por título, serie o autor" aria-label="Buscar"
             @input="typed(($event.target as HTMLInputElement).value)" />
    </header>
    <div class="es-filters">
      <div class="es-chips" role="tablist" aria-label="Tipo">
        <button v-for="k in KINDS" :key="k.id" class="es-chip" :class="{ on: (kind || '') === k.id }" @click="setKind(k.id)">{{ k.label }}</button>
      </div>
      <div v-if="sources.length" class="es-chips" role="tablist" aria-label="Biblioteca">
        <button class="es-chip" :class="{ on: !source }" @click="setSource('')">Todas</button>
        <button class="es-chip" :class="{ on: source === 'archivador' }" @click="setSource('archivador')">El Archivador</button>
        <button v-for="s in sources" :key="s.id" class="es-chip" :class="{ on: source === String(s.id) }" @click="setSource(String(s.id))">{{ s.name }}</button>
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
    <template v-else>
      <!-- the folders of Lectura, one level at a time -->
      <div v-if="folderMode && subfolders.length" class="es-grid">
        <a v-for="f in subfolders" :key="f.path" href="#" class="es-series-card es-folder" :title="f.path" @click.prevent="openFolder(f.path)">
          <Cover :id="f.coverItem || 0" :has="!!f.coverItem && f.coverHas" icon="es-i-grid" />
          <strong class="es-ellipsis"><i class="es-i es-i-grid es-folder-mark" aria-hidden="true"></i> {{ f.name }}</strong>
          <small class="es-muted">{{ f.folders ? `${f.folders} ${f.folders === 1 ? 'carpeta' : 'carpetas'}` : 'Carpeta' }}</small>
        </a>
      </div>

      <p v-if="!items.length && !subfolders.length && !external.length" class="es-muted">{{ q ? `Nada con «${q}».` : 'Nada por aquí.' }}</p>
      <section v-if="items.length" class="es-section">
        <h2 v-if="folderMode && (subfolders.length || external.length)" class="es-h2">{{ crumbs.length ? 'En esta carpeta' : 'Sueltos en ' + store.readingRoot }}</h2>
        <div class="es-grid">
          <ItemCard v-for="i in items" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
        <button v-if="items.length % PAGE === 0 && !exhausted" class="es-btn es-more" :disabled="loadingMore" @click="more">
          <span v-if="loadingMore" class="es-spin"></span> Ver más
        </button>
      </section>

      <!-- at the top of «Todas»: what comes from other libraries and catalogues, apart -->
      <section v-if="external.length" class="es-section">
        <h2 class="es-h2">De otras bibliotecas y catálogos</h2>
        <div class="es-grid">
          <ItemCard v-for="i in external" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
        <button v-if="external.length % PAGE === 0 && !externalExhausted" class="es-btn es-more" :disabled="loadingMore" @click="moreExternal">
          <span v-if="loadingMore" class="es-spin"></span> Ver más
        </button>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Item, Kind } from '../lib/api'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'
import OfflineButton from './OfflineButton.vue'

interface Subfolder { name: string; path: string; folders: number; coverItem: number | null; coverHas: boolean }

const PAGE = 60
const KINDS = [{ id: '', label: 'Todo' }, { id: 'comic', label: 'Cómics' }, { id: 'pdf', label: 'PDF' }, { id: 'book', label: 'Libros' }]
const props = defineProps<{ q: string; kind?: string; sort?: string; folder?: string; source?: string }>()
const store = useStore()
const { state, go } = store
const items = ref<Item[]>([])
const external = ref<Item[]>([])
/** everything under the folder shown (its subfolders too), for «Descargar la carpeta» */
const inFolder = ref<Item[]>([])
const subfolders = ref<Subfolder[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const exhausted = ref(false)
const externalExhausted = ref(false)
const searchEl = ref<HTMLInputElement>()
const sources = computed(() => state.status?.sources || [])
let typing: any = null
let request = 0

/** Browsing Lectura folder by folder: no search, and either everything or the Archivador alone. */
const folderMode = computed(() => !props.q && (!props.source || props.source === 'archivador'))
const folder = computed(() => (folderMode.value ? props.folder || '' : ''))
const crumbs = computed(() => {
  if (!folder.value) return []
  const parts = folder.value.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
})

function query(offset = 0, source = props.source || undefined) {
  const base = { q: props.q || undefined, kind: (props.kind || undefined) as Kind | undefined, sort: (props.sort || 'series') as any, limit: PAGE, offset }
  if (!folderMode.value) return { ...base, folder: props.folder, source }
  return { ...base, folder: folder.value, direct: true, source: 'archivador' }
}
function childFolders(): Subfolder[] {
  const all = state.status?.folders || []
  const prefix = folder.value ? folder.value + '/' : ''
  const found = new Map<string, Subfolder>()
  for (const f of all) {
    if (!f || !f.startsWith(prefix) || f === folder.value) continue
    const rest = f.slice(prefix.length)
    const name = rest.split('/')[0]
    const path = prefix + name
    const entry = found.get(name) || { name, path, folders: 0, coverItem: null, coverHas: false }
    if (rest.includes('/')) entry.folders += 1
    found.set(name, entry)
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { numeric: true }))
}
async function load() {
  if (!state.connected) return
  const mine = ++request
  loading.value = true
  try {
    const folders = folderMode.value ? childFolders() : []
    const wantExternal = folderMode.value && !props.source && !folder.value
    const [got, ext, covers] = await Promise.all([
      store.api.items(query()),
      wantExternal ? store.api.items({ ...query(0, 'external'), folder: undefined, direct: undefined, source: 'external' }) : Promise.resolve([] as Item[]),
      Promise.all(folders.map((f) => store.api.items({ folder: f.path, source: 'archivador', limit: 1, sort: 'series' }).catch(() => [] as Item[]))),
    ])
    if (mine !== request) return
    inFolder.value = store.offline && folder.value
      ? await store.api.items({ folder: folder.value, source: 'archivador', limit: 1000 }).catch(() => [] as Item[]) : []
    if (mine !== request) return
    folders.forEach((f, i) => { const first = covers[i][0]; if (first) { f.coverItem = first.id; f.coverHas = first.cover } })
    subfolders.value = folders
    items.value = got
    external.value = ext
    exhausted.value = got.length < PAGE
    externalExhausted.value = ext.length < PAGE
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
async function moreExternal() {
  loadingMore.value = true
  try {
    const got = await store.api.items({ ...query(external.value.length, 'external'), folder: undefined, direct: undefined, source: 'external' })
    external.value = [...external.value, ...got]
    externalExhausted.value = got.length < PAGE
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  loadingMore.value = false
}
function current() {
  return { v: 'library' as const, q: props.q || undefined, kind: props.kind, sort: props.sort, folder: props.folder, source: props.source }
}
function typed(value: string) {
  clearTimeout(typing)
  typing = setTimeout(() => go({ ...current(), q: value.trim() || undefined, folder: undefined }, true), 250)
}
function setKind(kind: string) { go({ ...current(), kind: kind || undefined }, true) }
function setSort(sort: string) { go({ ...current(), sort: sort === 'series' ? undefined : sort }, true) }
function setSource(source: string) { go({ ...current(), source: source || undefined, folder: undefined }, true) }
function openFolder(path: string) { go({ ...current(), folder: path || undefined }) }

onMounted(load)
watch(() => state.connected, load)
watch(() => [props.q, props.kind, props.sort, props.folder, props.source], load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
watch(() => state.status?.folders?.length, (now, before) => { if (before !== undefined && now !== before) load() })
</script>
