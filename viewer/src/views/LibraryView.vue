<template>
  <section class="es-page">
    <PullRefresh :action="pulled" />
    <header class="es-page-head">
      <div class="es-page-title">
        <p v-if="folderMode && crumbs.length" class="es-muted es-small es-crumbs">
          <a href="#" @click.prevent="openFolder('')">{{ rootName }}</a>
          <template v-for="c in crumbs" :key="c.path"> › <a href="#" @click.prevent="openFolder(c.path)">{{ c.name }}</a></template>
        </p>
        <h1 class="es-h1">{{ folderMode && crumbs.length ? crumbs[crumbs.length - 1].name : localSource ? rootName : t('Estantería') }}</h1>
      </div>
      <span class="es-grow"></span>
      <button v-if="localSource && store.shelf" class="es-btn es-mouse-only" :disabled="store.shelf.state.scanning" :title="t('Mirar otra vez qué hay en la carpeta')" @click="rescan">
        <span v-if="store.shelf.state.scanning" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i> {{ t('Actualizar') }}
      </button>
      <OfflineButton v-if="store.offline && !localSource && folderMode && crumbs.length && inFolder.length" :items="inFolder" :what="t('la carpeta')" />
      <!-- a folder of this device, whole, up to the server (each file where the rest is there) -->
      <ConfirmButton v-if="localSource && state.server && toUpload.length && !uploads.run" :danger="false" icon="es-i-cloud"
                     :label="t('Subir a {server}', { server: serverLabel(store) })" :title="t('Subir todo lo de esta carpeta (y sus subcarpetas)')"
                     :question="plural(toUpload.length, '¿Subir {n} archivo?', '¿Subir {n} archivos?')" :action="uploadFolder" />
      <!-- a series downloaded (or a folder of loose files), deleted whole: never a folder of one's own -->
      <ConfirmButton v-if="deletable && folder && toUpload.length" icon="es-i-delete" :label="t('Borrar')" :title="t('Borrar todo lo de esta carpeta')"
                     :question="plural(toUpload.length, '¿Borrar {n} archivo?', '¿Borrar los {n} archivos?')" :action="() => removeFolder(folder, true)" />
      <button v-if="store.shelf" class="es-btn" :class="{ on: showFolders }" :title="t('Las carpetas de este dispositivo que están en tu estantería')" @click="showFolders = !showFolders">
        <i class="es-i es-i-computer" aria-hidden="true"></i> {{ t('Carpetas') }}
      </button>
      <input ref="searchEl" :value="q" class="es-search" type="search" :placeholder="t('Buscar por título, serie o autor')" :aria-label="t('Buscar')"
             @input="typed(($event.target as HTMLInputElement).value)" />
    </header>
    <ShelfFolders v-if="showFolders" />
    <div v-if="uploads.run" class="es-banner es-upload-run">
      <span><span class="es-spin"></span> {{ t('Subiendo «{title}» a {server}: {done} de {n}', { title: uploads.run.title, server: serverLabel(store), done: Math.min(uploads.run.done + 1, uploads.run.files), n: uploads.run.files }) }}
        <small class="es-muted es-ellipsis">· {{ uploads.run.current }}</small></span>
      <span class="es-job-bar"><span :style="{ width: `${uploadPercent(uploads.run)}%` }"></span></span>
    </div>
    <div class="es-filters">
      <!-- what: one of four, as a segmented control -->
      <div class="es-seg" role="tablist" :aria-label="t('Qué mostrar')">
        <button v-for="k in KINDS" :key="k.id" class="es-seg-btn" role="tab" :aria-selected="(kind || '') === k.id" :class="{ on: (kind || '') === k.id }" @click="setKind(k.id)">{{ t(k.label) }}</button>
      </div>
      <span class="es-grow"></span>
      <label class="es-muted es-small">{{ t('Orden') }}
        <select class="es-select" :value="sort || 'series'" @change="setSort(($event.target as HTMLSelectElement).value)">
          <option value="series">{{ t('Serie y número') }}</option>
          <option value="title">{{ t('Título') }}</option>
          <option value="added">{{ t('Más recientes') }}</option>
          <option value="modified">{{ t('Última modificación') }}</option>
        </select>
      </label>
    </div>
    <!-- where from: the libraries, apart -->
    <div v-if="sources.length" class="es-libbar" role="tablist" :aria-label="t('Biblioteca')">
      <span class="es-libbar-label">{{ t('Biblioteca') }}</span>
      <button class="es-chip" :class="{ on: !source }" @click="setSource('')">{{ t('Todas') }}</button>
      <button v-if="store.state.server" class="es-chip" :class="{ on: source === 'archivador' }" @click="setSource('archivador')"><i class="es-i es-i-cloud" aria-hidden="true"></i> {{ serverLabel(store) }}</button>
      <button v-if="store.downloads && downloadedIds.size" class="es-chip" :class="{ on: downloadedMode }" :title="t('Lo descargado a este dispositivo')" @click="setSource('descargados')"><i class="es-i es-i-download" aria-hidden="true"></i> {{ t('Descargados') }}<template v-if="downloadedIds.size"> ({{ downloadedIds.size }})</template></button>
      <button v-for="s in sources" :key="s.id" class="es-chip" :class="{ on: source === String(s.id) }" :title="s.id < 0 ? t('En este dispositivo: {where}', { where: s.url || s.name }) : s.label"
              @click="setSource(String(s.id))"><i class="es-i" :class="s.id < 0 ? 'es-i-computer' : 'es-i-server'" aria-hidden="true"></i> {{ s.name }}</button>
    </div>

    <!-- inside .es, where the theme's variables live; fixed, so it is where the ⋮ was whatever scrolls -->
    <div v-if="folderMenu" class="es-fab-menu es-folder-menu" role="menu" :style="{ top: `${folderMenu.y}px`, left: `${folderMenu.x}px` }" @click.stop>
        <p class="es-folder-menu-title es-ellipsis">{{ folderMenu.path.split('/').pop() }}</p>
        <p v-if="!folderMenu.items" class="es-muted es-small"><span class="es-spin"></span> {{ t('Mirando qué hay…') }}</p>
        <!-- a folder of downloads: deleted whole (asked first, right there) -->
        <template v-else-if="deletable">
          <button v-if="!folderMenuAsk" class="es-fab-item es-fab-danger" role="menuitem" @click="folderMenuAsk = true">
            <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>{{ t('Borrar la carpeta') }}</strong><small>{{ plural(folderMenu.items.length, '{n} archivo', '{n} archivos') }}</small></span>
          </button>
          <div v-else class="es-confirm es-folder-menu-ask">
            <span class="es-confirm-q">{{ plural(folderMenu.items.length, '¿Borrar {n} archivo?', '¿Borrar los {n} archivos?') }}</span>
            <button class="es-btn es-small es-btn-danger" @click="removeFolder(folderMenu.path, false)">{{ t('Sí') }}</button>
            <button class="es-btn es-small" @click="folderMenu = null">{{ t('No') }}</button>
          </div>
        </template>
        <template v-else>
          <button class="es-fab-item" role="menuitem" :disabled="!folderMenuPending.length" @click="downloadFolderMenu">
            <span class="es-fab-icon"><i class="es-i es-i-download" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>{{ t('Descargar') }}</strong><small>{{ folderMenuPending.length ? plural(folderMenuPending.length, '{n} archivo que falta', '{n} archivos que faltan') : t('Ya está todo en este dispositivo') }}</small></span>
          </button>
          <button class="es-fab-item" role="menuitem" :disabled="!folderMenuDone.length" @click="removeFolderMenu">
            <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>{{ t('Borrar descargas') }}</strong><small>{{ folderMenuDone.length ? plural(folderMenuDone.length, '{n} archivo descargado', '{n} archivos descargados') : t('Nada descargado de aquí') }}</small></span>
          </button>
        </template>
      </div>

    <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
    <template v-else>
      <!-- the folders of Lectura (or of a folder of this PC), one level at a time -->
      <div v-if="folderMode && subfolders.length" class="es-grid">
        <a v-for="f in subfolders" :key="f.path" href="#" class="es-series-card es-folder es-card" :title="f.path" @click.prevent="openFolder(f.path)">
          <Cover :id="f.coverItem || 0" :has="!!f.coverItem && f.coverHas" icon="es-i-grid" />
          <strong class="es-ellipsis"><i class="es-i es-i-grid es-folder-mark" aria-hidden="true"></i> {{ f.name }}</strong>
          <small class="es-muted">{{ f.folders ? plural(f.folders, '{n} carpeta', '{n} carpetas') : t('Carpeta') }}</small>
          <button v-if="(store.saveFile && !localSource) || deletable" class="es-card-info" :title="t('Más')" :aria-label="t('Más')" @click.stop.prevent="openFolderMenu(f.path, $event)"><i class="es-i es-i-more" aria-hidden="true"></i></button>
        </a>
      </div>

      <!-- at the top of «Todas»: the libraries of this PC, each like a folder -->
      <section v-if="pcLibraries.length" class="es-section">
        <h2 class="es-h2">{{ t('En este PC') }}</h2>
        <div class="es-grid">
          <a v-for="f in pcLibraries" :key="f.path" href="#" class="es-series-card es-folder" :title="f.name" @click.prevent="setSource(f.path)">
            <Cover :id="f.coverItem || 0" :has="!!f.coverItem && f.coverHas" icon="es-i-computer" />
            <strong class="es-ellipsis"><i class="es-i es-i-computer es-folder-mark" aria-hidden="true"></i> {{ f.name }}</strong>
            <small class="es-muted">{{ plural(f.folders, '{n} archivo', '{n} archivos') }}</small>
          </a>
        </div>
      </section>

      <p v-if="!items.length && !subfolders.length && !external.length && !pcLibraries.length" class="es-muted">{{ q ? t('Nada con «{q}».', { q }) : t('Nada por aquí.') }}</p>
      <section v-if="items.length" class="es-section">
        <h2 v-if="folderMode && (subfolders.length || external.length || pcLibraries.length)" class="es-h2">{{ crumbs.length ? t('En esta carpeta') : t('Sueltos en {name}', { name: rootName }) }}</h2>
        <div class="es-grid">
          <ItemCard v-for="i in items" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
        <button v-if="items.length % PAGE === 0 && !exhausted" class="es-btn es-more" :disabled="loadingMore" @click="more">
          <span v-if="loadingMore" class="es-spin"></span> {{ t('Ver más') }}
        </button>
      </section>

      <!-- at the top of «Todas»: what comes from other libraries and catalogues, apart -->
      <section v-if="external.length" class="es-section">
        <h2 class="es-h2">{{ t('De otras bibliotecas y catálogos') }}</h2>
        <div class="es-grid">
          <ItemCard v-for="i in external" :key="i.id" :item="i" @read="store.read(i)" @open="go({ v: 'item', id: i.id })" />
        </div>
        <button v-if="external.length % PAGE === 0 && !externalExhausted" class="es-btn es-more" :disabled="loadingMore" @click="moreExternal">
          <span v-if="loadingMore" class="es-spin"></span> {{ t('Ver más') }}
        </button>
      </section>
    </template>
    <AddButton />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { Item, Kind } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { DOWNLOADS_ROOT, LOOSE_ROOT, isLocalSource } from '../lib/local'
import { serverLabel, useStore } from '../lib/store'
import AddButton from './AddButton.vue'
import ShelfFolders from './ShelfFolders.vue'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'
import OfflineButton from './OfflineButton.vue'
import ConfirmButton from './ConfirmButton.vue'
import PullRefresh from './PullRefresh.vue'
import { lookForNew } from '../lib/refresh'
import { uploadFiles, uploadPercent, uploads } from '../lib/uploads'
import { forgetCatalogItems } from '../lib/catalogdownloads'

interface Subfolder { name: string; path: string; folders: number; coverItem: number | null; coverHas: boolean }

const PAGE = 60
const KINDS = [{ id: '', label: 'Todo' }, { id: 'comic', label: 'Cómics' }, { id: 'pdf', label: 'PDF' }, { id: 'book', label: 'Libros' }]
const props = defineProps<{ q: string; kind?: string; sort?: string; folder?: string; source?: string }>()
const store = useStore()
/** the device's folders on the shelf, shown above the list */
const showFolders = ref(false)
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
  folderMenuAsk.value = false
  const r = (event.currentTarget as HTMLElement).getBoundingClientRect()
  // under the ⋮, kept on screen (the menu is about 300 px wide)
  const menu = { path, y: Math.min(r.bottom + 4, window.innerHeight - 170), x: Math.max(8, Math.min(r.right - 300, window.innerWidth - 316)), items: null as Item[] | null }
  folderMenu.value = menu
  setTimeout(() => document.addEventListener('click', closeFolderMenu, { once: true }))
  try {
    const items = deletable.value && store.shelf
      ? store.shelf.query({ source: props.source, folder: path, limit: 100000 })
      : await store.api.items({ folder: path, source: 'archivador', limit: 1000 })
    if (folderMenu.value && folderMenu.value.path === path) folderMenu.value.items = items
  } catch (err: any) { store.notify(err?.message || String(err), true); folderMenu.value = null }
}
function closeFolderMenu() { folderMenu.value = null }
const folderMenuAsk = ref(false)
/** what can be deleted from here: the downloads and the loose files (the app's to delete; one's folders are not) */
const deletable = computed(() => props.source === String(-DOWNLOADS_ROOT) || props.source === String(-LOOSE_ROOT))
/** Deletes a whole folder of downloads (a series): its files, and what the app knew of them. */
async function removeFolder(path: string, inside: boolean) {
  const shelf = store.shelf
  if (!shelf) return
  folderMenu.value = null
  const items = shelf.query({ source: props.source, folder: path, limit: 100000 })
  let gone = 0
  for (const i of items) {
    try { await shelf.removeFile(i.id); gone++ } catch (err: any) { store.notify(err?.message || String(err), true) }
  }
  forgetCatalogItems(items.map((i) => i.id))
  store.notify(plural(gone, '{n} archivo borrado.', '{n} archivos borrados.'))
  await store.refresh()
  // from inside it, up to where it was
  if (inside) { if (window.history.length > 1) window.history.back(); else openFolder(path.split('/').slice(0, -1).join('/')) }
  else load()
}
function downloadFolderMenu() {
  const items = folderMenuPending.value
  for (const i of items) store.saveFile?.(store.api.filePath(i.id), i.name, true)
  store.notify(plural(items.length, '{n} archivo en cola de descarga.', '{n} archivos en cola de descarga.'))
  folderMenu.value = null
}
function removeFolderMenu() {
  const items = folderMenuDone.value
  for (const i of items) store.removeDownload?.(store.api.filePath(i.id))
  store.notify(plural(items.length, '{n} descarga borrada.', '{n} descargas borradas.'))
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
const rootName = computed(() => (localSource.value ? sources.value.find((s) => String(s.id) === props.source)?.name || t('Este PC') : store.readingRoot))
/** where the folders shown come from: the Archivador, or a library of this PC */
const folderSource = computed(() => (localSource.value ? props.source! : 'archivador'))
const folder = computed(() => (folderMode.value ? props.folder || '' : ''))
/** everything in this folder of the device and its subfolders, to upload it whole */
const toUpload = computed(() => (localSource.value && store.shelf ? store.shelf.query({ source: props.source, folder: folder.value, limit: 100000 }) : []))
function uploadFolder() {
  const title = folder.value ? folder.value.split('/').pop()! : rootName.value
  // it goes on in the background: the banner says how
  void uploadFiles(store, toUpload.value, { title, source: props.source || '', folder: folder.value })
}
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
/** pulled down: everything looked at again (this device's folders, the server), then this list */
async function pulled() {
  await lookForNew(store)
  load()
}
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
