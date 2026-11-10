<template>
  <section class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p v-if="folderMode && crumbs.length" class="es-muted es-small es-crumbs">
          <a href="#" @click.prevent="openFolder('')">{{ rootName }}</a>
          <template v-for="c in crumbs" :key="c.path"> › <a href="#" @click.prevent="openFolder(c.path)">{{ c.name }}</a></template>
        </p>
        <h1 class="es-h1">{{ folderMode && crumbs.length ? crumbs[crumbs.length - 1].name : localSource ? rootName : 'Estantería' }}</h1>
      </div>
      <span class="es-grow"></span>
      <button v-if="localSource && store.shelf" class="es-btn" :disabled="store.shelf.state.scanning" title="Mirar otra vez qué hay en la carpeta" @click="rescan">
        <span v-if="store.shelf.state.scanning" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i> Actualizar
      </button>
      <OfflineButton v-if="store.offline && !localSource && folderMode && crumbs.length && inFolder.length" :items="inFolder" what="la carpeta" />
      <input ref="searchEl" :value="q" class="es-search" type="search" placeholder="Buscar por título, serie o autor" aria-label="Buscar"
             @input="typed(($event.target as HTMLInputElement).value)" />
    </header>
    <div class="es-filters">
      <!-- what: one of four, as a segmented control -->
      <div class="es-seg" role="tablist" aria-label="Qué mostrar">
        <button v-for="k in KINDS" :key="k.id" class="es-seg-btn" role="tab" :aria-selected="(kind || '') === k.id" :class="{ on: (kind || '') === k.id }" @click="setKind(k.id)">{{ k.label }}</button>
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
    <!-- where from: the libraries, apart -->
    <div v-if="sources.length" class="es-libbar" role="tablist" aria-label="Biblioteca">
      <span class="es-libbar-label">Biblioteca</span>
      <button class="es-chip" :class="{ on: !source }" @click="setSource('')">Todas</button>
      <button class="es-chip" :class="{ on: source === 'archivador' }" @click="setSource('archivador')"><i class="es-i es-i-cloud" aria-hidden="true"></i> El Archivador</button>
      <button v-if="store.downloads" class="es-chip" :class="{ on: downloadedMode }" title="Lo descargado a este dispositivo" @click="setSource('descargados')"><i class="es-i es-i-download" aria-hidden="true"></i> Descargados<template v-if="downloadedIds.size"> ({{ downloadedIds.size }})</template></button>
      <button v-for="s in sources" :key="s.id" class="es-chip" :class="{ on: source === String(s.id) }" :title="s.id < 0 ? `En este PC: ${s.url || s.name}` : s.label"
              @click="setSource(String(s.id))"><i class="es-i" :class="s.id < 0 ? 'es-i-computer' : 'es-i-server'" aria-hidden="true"></i> {{ s.name }}</button>
    </div>

    <!-- inside .es, where the theme's variables live; fixed, so it is where the ⋮ was whatever scrolls -->
    <div v-if="folderMenu" class="es-fab-menu es-folder-menu" role="menu" :style="{ top: `${folderMenu.y}px`, left: `${folderMenu.x}px` }" @click.stop>
        <p class="es-folder-menu-title es-ellipsis">{{ folderMenu.path.split('/').pop() }}</p>
        <p v-if="!folderMenu.items" class="es-muted es-small"><span class="es-spin"></span> Mirando qué hay…</p>
        <template v-else>
          <button class="es-fab-item" role="menuitem" :disabled="!folderMenuPending.length" @click="downloadFolderMenu">
            <span class="es-fab-icon"><i class="es-i es-i-download" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>Descargar</strong><small>{{ folderMenuPending.length ? `${folderMenuPending.length} ${folderMenuPending.length === 1 ? 'archivo' : 'archivos'} que faltan` : 'Ya está todo en este dispositivo' }}</small></span>
          </button>
          <button class="es-fab-item" role="menuitem" :disabled="!folderMenuDone.length" @click="removeFolderMenu">
            <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>Borrar descargas</strong><small>{{ folderMenuDone.length ? `${folderMenuDone.length} ${folderMenuDone.length === 1 ? 'archivo descargado' : 'archivos descargados'}` : 'Nada descargado de aquí' }}</small></span>
          </button>
        </template>
      </div>

    <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
    <template v-else>
      <!-- the folders of Lectura (or of a folder of this PC), one level at a time -->
      <div v-if="folderMode && subfolders.length" class="es-grid">
        <a v-for="f in subfolders" :key="f.path" href="#" class="es-series-card es-folder es-card" :title="f.path" @click.prevent="openFolder(f.path)">
          <Cover :id="f.coverItem || 0" :has="!!f.coverItem && f.coverHas" icon="es-i-grid" />
          <strong class="es-ellipsis"><i class="es-i es-i-grid es-folder-mark" aria-hidden="true"></i> {{ f.name }}</strong>
          <small class="es-muted">{{ f.folders ? `${f.folders} ${f.folders === 1 ? 'carpeta' : 'carpetas'}` : 'Carpeta' }}</small>
          <button v-if="store.saveFile && !localSource" class="es-card-info" title="Más" aria-label="Más" @click.stop.prevent="openFolderMenu(f.path, $event)"><i class="es-i es-i-more" aria-hidden="true"></i></button>
        </a>
      </div>

      <!-- at the top of «Todas»: the libraries of this PC, each like a folder -->
      <section v-if="pcLibraries.length" class="es-section">
        <h2 class="es-h2">En este PC</h2>
        <div class="es-grid">
          <a v-for="f in pcLibraries" :key="f.path" href="#" class="es-series-card es-folder" :title="f.name" @click.prevent="setSource(f.path)">
            <Cover :id="f.coverItem || 0" :has="!!f.coverItem && f.coverHas" icon="es-i-computer" />
            <strong class="es-ellipsis"><i class="es-i es-i-computer es-folder-mark" aria-hidden="true"></i> {{ f.name }}</strong>
            <small class="es-muted">{{ f.folders }} {{ f.folders === 1 ? 'archivo' : 'archivos' }}</small>
          </a>
        </div>
      </section>

      <p v-if="!items.length && !subfolders.length && !external.length && !pcLibraries.length" class="es-muted">{{ q ? `Nada con «${q}».` : 'Nada por aquí.' }}</p>
      <section v-if="items.length" class="es-section">
        <h2 v-if="folderMode && (subfolders.length || external.length || pcLibraries.length)" class="es-h2">{{ crumbs.length ? 'En esta carpeta' : 'Sueltos en ' + rootName }}</h2>
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
    <AddButton />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Item, Kind } from '../lib/api'
import { isLocalSource } from '../lib/local'
import { useStore } from '../lib/store'
import AddButton from './AddButton.vue'
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
// ---- a folder's menu (⋮ on its card): download what it holds to this device, or delete what was downloaded ----
const folderMenu = ref<{ path: string; y: number; x: number; items: Item[] | null } | null>(null)
const folderMenuPending = computed(() => (folderMenu.value?.items || []).filter((i) => i.format !== 'folder' && store.downloads?.[store.api.filePath(i.id)]?.state !== 'done'))
const folderMenuDone = computed(() => (folderMenu.value?.items || []).filter((i) => store.downloads?.[store.api.filePath(i.id)]?.state === 'done'))
async function openFolderMenu(path: string, event: MouseEvent) {
  if (folderMenu.value?.path === path) { folderMenu.value = null; return }
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // under the ⋮, kept on screen (the menu is about 300 px wide)
  const menu = { path, y: Math.min(r.bottom + 4, window.innerHeight - 170), x: Math.max(8, Math.min(r.right - 300, window.innerWidth - 316)), items: null as Item[] | null }
  folderMenu.value = menu
  setTimeout(() => document.addEventListener('click', closeFolderMenu, { once: true }))
  try {
    const items = await store.api.items({ folder: path, source: 'archivador', limit: 1000 })
    if (folderMenu.value && folderMenu.value.path === path) folderMenu.value.items = items
  } catch (err: any) { store.notify(err?.message || String(err), true); folderMenu.value = null }
}
function closeFolderMenu() { folderMenu.value = null }
function downloadFolderMenu() {
  const items = folderMenuPending.value
  for (const i of items) store.saveFile?.(store.api.filePath(i.id), i.name, true)
  store.notify(`${items.length} ${items.length === 1 ? 'archivo' : 'archivos'} en cola de descarga.`)
  folderMenu.value = null
}
function removeFolderMenu() {
  const items = folderMenuDone.value
  for (const i of items) store.removeDownload?.(store.api.filePath(i.id))
  store.notify(`${items.length} ${items.length === 1 ? 'descarga borrada' : 'descargas borradas'}.`)
  folderMenu.value = null
}
const subfolders = ref<Subfolder[]>([])
/** at the top of «Todas»: the libraries of this PC (path = their source id) */
const pcLibraries = ref<Subfolder[]>([])
const loading = ref(true)
const loadingMore = ref(false)
const exhausted = ref(false)
const externalExhausted = ref(false)
const searchEl = ref<HTMLInputElement>()
const sources = computed(() => state.status?.sources || [])
let typing: any = null
let request = 0

/** Browsing folder by folder: no search, and either everything, the Archivador alone or a folder of this PC. */
const localSource = computed(() => isLocalSource(props.source))
/** the files the host downloaded (Android): a view of its own, filtered here */
const downloadedMode = computed(() => props.source === 'descargados')
const downloadedIds = computed(() => new Set(Object.entries(store.downloads || {}).filter(([, d]) => d.state === 'done')
  .map(([path]) => Number(path.match(/\/api\/items\/(\d+)\/file/)?.[1]) || 0).filter(Boolean)))
const folderMode = computed(() => !props.q && (!props.source || props.source === 'archivador' || localSource.value))
const rootName = computed(() => (localSource.value ? sources.value.find((s) => String(s.id) === props.source)?.name || 'Este PC' : store.readingRoot))
/** where the folders shown come from: the Archivador, or a library of this PC */
const folderSource = computed(() => (localSource.value ? props.source! : 'archivador'))
const folder = computed(() => (folderMode.value ? props.folder || '' : ''))
const crumbs = computed(() => {
  if (!folder.value) return []
  const parts = folder.value.split('/')
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join('/') }))
})

function query(offset = 0, source = props.source || undefined) {
  const base = { q: props.q || undefined, kind: (props.kind || undefined) as Kind | undefined, sort: (props.sort || 'series') as any, limit: PAGE, offset }
  if (!folderMode.value) return { ...base, folder: props.folder, source }
  return { ...base, folder: folder.value, direct: true, source: folderSource.value }
}
function kindFilter(): Kind | undefined { return (props.kind || undefined) as Kind | undefined }
function childFolders(): Subfolder[] {
  const all = localSource.value ? state.status?.local_folders?.[props.source!] || [] : state.status?.folders || []
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
  if (downloadedMode.value) {
    try {
      const ids = downloadedIds.value
      const all = ids.size ? await store.api.items({ q: props.q || undefined, kind: (props.kind || undefined) as Kind | undefined, sort: (props.sort || 'series') as any, limit: 1000 }) : []
      if (mine !== request) return
      items.value = all.filter((i) => ids.has(i.id))
      external.value = []
      subfolders.value = []
      pcLibraries.value = []
      inFolder.value = []
      exhausted.value = true
      externalExhausted.value = true
    } catch (err: any) { store.notify(err?.message || String(err), true) }
    if (mine === request) loading.value = false
    return
  }
  try {
    const folders = folderMode.value ? childFolders() : []
    const wantExternal = folderMode.value && !props.source && !folder.value
    const [got, ext, covers] = await Promise.all([
      store.api.items(query()),
      wantExternal ? store.api.items({ ...query(0, 'external'), folder: undefined, direct: undefined, source: 'external' }) : Promise.resolve([] as Item[]),
      // the first item of each folder (its cover); with a type chosen, of that type: none, the folder is left out
      Promise.all(folders.map((f) => store.api.items({ folder: f.path, source: folderSource.value, kind: kindFilter(), limit: 1, sort: 'series' }).catch(() => [] as Item[]))),
    ])
    if (mine !== request) return
    inFolder.value = store.offline && folder.value && !localSource.value
      ? await store.api.items({ folder: folder.value, source: 'archivador', limit: 1000 }).catch(() => [] as Item[]) : []
    if (mine !== request) return
    folders.forEach((f, i) => { const first = covers[i][0]; if (first) { f.coverItem = first.id; f.coverHas = first.cover } })
    subfolders.value = props.kind ? folders.filter((_, i) => covers[i].length) : folders
    // the libraries of this PC: answered on this device, so all their items (to count those of the type chosen)
    const pc = !props.source && !folder.value && folderMode.value ? sources.value.filter((s) => s.id < 0) : []
    const pcItems = await Promise.all(pc.map((s) => store.api.items({ source: String(s.id), kind: kindFilter(), limit: 100000, sort: 'series' }).catch(() => [] as Item[])))
    if (mine !== request) return
    pcLibraries.value = pc.map((s, i) => ({ name: s.name, path: String(s.id), folders: pcItems[i].length, coverItem: pcItems[i][0]?.id ?? null, coverHas: true }))
      .filter((f) => f.folders > 0 || !props.kind)
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
async function rescan() {
  await store.shelf?.scan()
  await store.refresh()
  load()
}

onMounted(load)
watch(() => state.connected, load)
watch(() => [props.q, props.kind, props.sort, props.folder, props.source], load)
watch(() => state.status?.pending, (now, before) => { if (before && !now) load() })
watch(() => state.status?.folders?.length, (now, before) => { if (before !== undefined && now !== before) load() })
watch(() => store.shelf?.count, (now, before) => { if (before !== undefined && now !== before) load() })
</script>
