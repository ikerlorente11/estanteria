<template>
  <div class="es" :class="{ 'es-reading': view.v === 'read' || view.v === 'chapter' }">
    <template v-if="view.v === 'read' && store">
      <ReaderView :key="`read${view.id}${view.as || ''}`" :id="view.id" :start-page="view.page" :as="view.as" />
    </template>
    <template v-else-if="view.v === 'chapter' && store">
      <ChapterReader :key="`ch${view.chapter}`" :catalog="view.catalog" :chapter="view.chapter" :title="view.title" />
    </template>
    <template v-else>
      <aside class="es-side" :aria-label="t('Tu estantería')">
        <div class="es-brand">
          <span class="es-brand-mark" aria-hidden="true"><i class="es-i es-i-book" aria-hidden="true"></i></span>
          <strong>La Estantería</strong>
        </div>
        <nav class="es-nav">
          <a href="#" :class="{ on: view.v === 'home' }" @click.prevent="go({ v: 'home' })"><span class="es-ni"><i class="es-i es-i-home" aria-hidden="true"></i></span> {{ t('Inicio') }}</a>
          <a href="#" :class="{ on: view.v === 'library' }" @click.prevent="go({ v: 'library' })"><span class="es-ni"><i class="es-i es-i-grid" aria-hidden="true"></i></span> {{ t('Estantería') }}</a>
          <a href="#" :class="{ on: view.v === 'catalogs' || view.v === 'catalog' }" @click.prevent="go({ v: 'catalogs' })"><span class="es-ni"><i class="es-i es-i-cloud" aria-hidden="true"></i></span> {{ t('Catálogos') }}</a>
          <a href="#" :class="{ on: view.v === 'sources' }" @click.prevent="go({ v: 'sources' })"><span class="es-ni"><i class="es-i es-i-server" aria-hidden="true"></i></span> {{ t('Bibliotecas') }}</a>
        </nav>
        <div class="es-lib">
          <div class="es-libh">{{ t('Series') }} <small class="es-muted">{{ state.series.length }}</small></div>
          <p v-if="!state.loaded" class="es-muted es-small es-libnote"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
          <ul v-else class="es-serieslist">
            <li v-for="s in state.series" :key="s.series">
              <a href="#" :class="{ on: view.v === 'series' && view.name === s.series }" @click.prevent="go({ v: 'series', name: s.series })">
                <Cover :id="s.cover_item" :has="s.cover" class="es-thumb" />
                <span class="es-sname"><span class="es-ellipsis">{{ s.series }}</span><small class="es-muted">{{ plural(s.items, '{n} número', '{n} números') }}</small></span>
              </a>
            </li>
          </ul>
        </div>
        <a href="#" class="es-back" :class="{ on: view.v === 'setup' }" @click.prevent="go({ v: 'setup' } as any)"><i class="es-i es-i-settings" aria-hidden="true"></i> {{ t('Ajustes') }}</a>
      </aside>

      <main ref="mainEl" class="es-main">
        <!-- «back» when not on a main page; the settings on a phone (the bar at the bottom has no room for them) -->
        <div class="es-topbar">
          <button v-if="!isRoot" class="es-topbtn" type="button" :aria-label="t('Volver')" :title="t('Volver')" @click="back()"><i class="es-i es-i-back" aria-hidden="true"></i></button>
          <span class="es-grow"></span>
          <button class="es-topbtn es-topbtn-settings" :class="{ on: view.v === 'setup' }" type="button" :aria-label="t('Ajustes')" @click="go({ v: 'setup' } as any)"><i class="es-i es-i-settings" aria-hidden="true"></i></button>
        </div>
        <p v-if="offline && !offline.state.online" class="es-offline-banner">
          <i class="es-i es-i-cloud" aria-hidden="true"></i>
          <span>{{ t('Sin conexión con {server}: puedes leer lo descargado. Lo que leas se apunta y se envía al volver.', { server: serverName }) }}</span>
          <span class="es-grow"></span>
          <button class="es-btn es-small" @click="refresh()">{{ t('Reintentar') }}</button>
        </p>
        <p v-if="state.error && view.v !== 'sources'" class="es-banner es-banner-error">{{ state.error }} <button class="es-btn es-small" @click="go({ v: 'sources' })">{{ t('Bibliotecas') }}</button></p>
        <template v-if="store">
          <SettingsView v-if="view.v === 'setup'" />
          <HomeView v-else-if="view.v === 'home'" />
          <LibraryView v-else-if="view.v === 'library'" :q="view.q || ''" :kind="view.kind" :sort="view.sort" :folder="view.folder" :source="view.source" />
          <SeriesView v-else-if="view.v === 'series'" :key="`s${view.name}`" :name="view.name" />
          <ItemView v-else-if="view.v === 'item'" :key="`i${view.id}`" :id="view.id" />
          <SourcesView v-else-if="view.v === 'sources'" :add="view.add" />
          <ExtensionsView v-else-if="view.v === 'extensions'" :key="`x${view.library}`" :library="view.library" />
          <CatalogsView v-else-if="view.v === 'catalogs'" />
          <DownloadsView v-else-if="view.v === 'downloads'" />
          <CatalogView v-else-if="view.v === 'catalog'" :key="`c${view.kind}`" :kind="view.kind" :path="view.path" :q="view.q" />
        </template>
      </main>
    </template>
    <div v-if="toast.text" :class="['es-toast', { 'es-toast-error': toast.error }]" role="status">{{ toast.text }}</div>
    <LockScreen v-if="lock.locked.value && native?.lock" :lock="native.lock" @unlocked="lock.unlocked()" />
  </div>
</template>

<script setup lang="ts">
import { RELEASE } from './release'
import { computed, onMounted, provide, reactive, ref, shallowReactive, shallowRef, watch } from 'vue'
import { Api, CatalogRegistry, ExtensionsView, withDeviceLibraries, LockScreen, appSettings, useAppLock, CatalogView, CatalogsView, ChapterReader, Cover, DownloadsView, HomeView, LocalShelf, Offline, ImageCache, ItemView, LibraryView, ReaderView, SeriesView, SettingsView, SourcesView, STORE,
         createState, nameFromUrl, plural, queryFromView, t, useScrollMemory, viewFromQuery, type DownloadState, type Theme, type Item, type Library, type LibrariesBackend, type Store, type View } from 'estanteria-viewer'
import { HOST_BASE, TOKEN, forgetServer, hostBackend, hostNative, hostNet, hostShelf, hostUrl, info, loadConnection, saveConnection, tellApp, type Connection, type HostInfo } from './lib/host'

/**
 * The Android shell of La Estantería: the same library and readers as the web and the desktop, served
 * by the app's own local server (the host). First a reader of this device's files (its shelf), with no
 * account; libraries are connected in «Bibliotecas» (for now a server of its own, which the host talks
 * to with the user's credential). The page shown lives in the URL's hash
 * (#v=series&name=…), so the back button works. What the host can do (keep files, read the device's
 * folders) it says at start.
 */
const version = ref('')
const connection = reactive<Connection>({ url: '', username: '', name: '', hasToken: false })
/** a server of its own is connected (without one the app reads this device alone) */
const connected = ref(false)
/** why the server does not connect, shown next to it in «Bibliotecas» */
const serverError = ref('')
const serverName = computed(() => connection.name || (connection.url ? nameFromUrl(connection.url) : t('el servidor')))
const state = createState()
const toast = reactive({ text: '', error: false })
const mainEl = ref<HTMLElement>()
let toastTimer: any = null
let hostInfo: HostInfo = { version: '', shelf: false, offline: false }
/** what the native side can do (volume keys, Wi-Fi only, the device's lock), as the host says at start */
let native: ReturnType<typeof hostNative> | null = null
const lock = useAppLock(() => native || undefined)

// ---- the theme: the system's, or one chosen in Ajustes (kept in this device) ----
const THEME_KEY = 'estanteria.theme'
const theme = ref<Theme>((() => { try { return (localStorage.getItem(THEME_KEY) as Theme) || 'system' } catch (_) { return 'system' } })())
// what the system is set to, as the app says (the web view's own media query follows the app's theme, not the system's)
let systemScheme: 'light' | 'dark' | '' = (new URLSearchParams(window.location.search).get('scheme') as any) || ''
function applyTheme() {
  const t = theme.value
  const effective = t === 'system' ? systemScheme : t
  if (!effective) delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = effective
  tellApp({ type: 'theme', value: t })
}
;(window as any).__estanteriaScheme = (s: string) => { systemScheme = s === 'dark' ? 'dark' : s === 'light' ? 'light' : ''; applyTheme() }
function setTheme(t: Theme) {
  theme.value = t
  try { localStorage.setItem(THEME_KEY, t) } catch (_) {}
  applyTheme()
}
applyTheme()

// ---- navigation in the hash ----
const hash = ref(window.location.hash)
window.addEventListener('hashchange', () => { hash.value = window.location.hash })
// each page keeps its scroll: back to a list, it is where it was
const scroll = useScrollMemory(mainEl, hash)
const view = computed<View | { v: 'setup' }>(() => {
  const params = Object.fromEntries(new URLSearchParams(hash.value.replace(/^#/, '')))
  return params.v === 'setup' ? { v: 'setup' } : viewFromQuery(params)
})
function go(next: View | { v: 'setup' }, replace = false) {
  const query = next.v === 'setup' ? 'v=setup' : new URLSearchParams(queryFromView(next as View)).toString()
  if (`#${query}` !== hash.value) scroll.forward()
  if (replace) window.history.replaceState(null, '', `#${query}`)
  else window.location.hash = query
  hash.value = `#${query}`
}
/** the main pages (the tabs): no «back» there */
const isRoot = computed(() => {
  const v = view.value as any
  if (v.v === 'library') return !v.folder && !v.source && !v.q
  return ['home', 'catalogs', 'sources'].includes(v.v)
})
function back() {
  if (window.history.length > 1) window.history.back()
  else go({ v: 'home' })
}
// the screen stays on while reading (the app does it)
const reading = computed(() => view.value.v === 'read' || view.value.v === 'chapter')
watch(reading, (on) => tellApp({ type: 'reading', on: on && appSettings.keepAwake }))
// the volume keys turn pages only while reading (and when the setting says so)
watch(() => reading.value && appSettings.volumeKeys, (on) => native?.volumeKeys?.(on))
// downloads only on Wi-Fi: the native side keeps the flag, the settings say what it is
watch(() => appSettings.wifiOnly, (on) => native?.wifiOnly?.(on))

function notify(text: string, error = false) {
  toast.text = text
  toast.error = error
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.text = '' }, error ? 7000 : 3500)
}

// ---- the service, through the host (it adds the credential; this header only names this page to it) ----
const api = new Api(HOST_BASE, () => `Host ${TOKEN}`)
let current: Api = api
const store = shallowRef<Store | null>(null)
// ---- reading without connection: the host keeps the files; the keeper follows the account the host has ----
const offline = shallowRef<Offline | null>(null)
// ---- the folders and files of this device ----
let shelf: LocalShelf | null = null

// ---- the catalogs this app reads by itself, and its network (no CORS) ----
const catalogs = new CatalogRegistry()
const net = hostNet()

/** The store with a server (through the host, which adds the credential) or without (this device's shelf answers). */
function makeStore(server: boolean): Store {
  current = server ? new Api(HOST_BASE, () => `Host ${TOKEN}`) : Api.onDevice()
  const covers = new ImageCache(current, 400)
  const pages = new ImageCache(current, 24)
  const s: Store = { api: current, covers, pages, readingRoot: 'Lectura', state, refresh, go: go as any, back, notify, read,
    // the app downloads the file (through the host, with the token in the URL) into its own folder, tells how it goes
    // (window.__estanteriaDownload) and opens it with another app when asked again once done
    saveFile: (path, name, quiet) => tellApp({ type: 'download', url: new URL(hostUrl(path), window.location.href).toString(), name, path, quiet: !!quiet }),
    removeDownload: (path) => tellApp({ type: 'remove-download', path }),
    downloads, canFullscreen: false, libraries: allLibraries, serverName: server ? serverName.value : undefined,
    appearance: { theme, setTheme }, version: version.value && version.value !== '?' ? version.value : undefined, catalogs, net, platform: 'android', native: native || undefined }
  if (hostInfo.offline) {
    const keeper = offline.value || new Offline(hostBackend(hostInfo))
    keeper.attach(current)
    if (shelf) keeper.shelf = shelf
    offline.value = keeper
    s.offline = keeper
  }
  if (shelf) s.shelf = shelf
  return s
}
function read(item: Item) {
  const page = item.kind !== 'book' && item.progress && !item.progress.finished && item.progress.page ? item.progress.page : undefined
  go({ v: 'read', id: item.id, page })
}
async function refresh() {
  try {
    const [status, series] = await Promise.all([current.library(), current.series()])
    state.status = status
    state.series = series
    state.loaded = true
    state.error = ''
  } catch (err: any) {
    // only a server can fail to answer: this device's own shelf has nothing to go wrong with
    if (state.server) state.error = t('No se pudo cargar tu estantería: {error}', { error: err?.message || String(err) })
  }
}
/** Puts a store in place: the pages see `state.connected` go up again and load with it. */
async function use(server: boolean) {
  state.connected = false
  const s = makeStore(server)
  await offline.value?.load()
  provideStore(s)
  store.value = s
  connected.value = server
  state.server = server
  state.connected = true
  await refresh()
}
/** With the server if one is set up and it lets us in (when it does not answer, it is read offline from
 * what was kept); else this device alone. True when the server is in use. */
async function connect(): Promise<boolean> {
  state.error = ''
  serverError.value = ''
  if (!connection.url || !connection.username || !connection.hasToken) { await use(false); listLibraries(); return false }
  try {
    await new Api(HOST_BASE, () => `Host ${TOKEN}`).ensureConnected()
  } catch (err: any) {
    if (!err?.offline) {
      serverError.value = err?.status === 401 ? t('No reconoce ese usuario o esa contraseña de aplicación.') : t('No se pudo conectar: {error}', { error: err?.message || String(err) })
      await use(false)
      listLibraries()
      return false
    }
  }
  await use(true)
  listLibraries()
  return true
}

// ---- «Bibliotecas»: what this app connects by itself (for now, one server of its own, through the host) ----
const libraryList = ref<Library[]>([])
function listLibraries() {
  libraryList.value = connection.url && connection.username
    ? [{ id: 'server', type: 'server', name: serverName.value, url: connection.url, username: connection.username, hasSecret: connection.hasToken, error: serverError.value || undefined }]
    : []
}
const libraries: LibrariesBackend = {
  types: ['server'],
  list: libraryList,
  async save(input) {
    if (input.type !== 'server') throw new Error(t('Este tipo de biblioteca aún no se puede conectar desde aquí.'))
    if (!input.id && libraryList.value.length) throw new Error(t('De momento solo se puede conectar un servidor propio: cambia el que hay o quítalo antes.'))
    // a new or changed address (or credential) must answer before it is kept: else a typo in it would be taken
    // for being offline and the app would wait for a server that does not exist
    const url = input.url.trim().replace(/\/+$/, '')
    const username = input.username.trim()
    const secret = input.secret?.trim() || ''
    if (!input.id || url !== connection.url || username !== connection.username || secret) {
      let answer: Response
      try {
        answer = await net.fetch(`${url}/api/cloud`, { headers: secret ? { Authorization: Api.basic(username, secret) } : {} })
      } catch (_) {
        throw new Error(t('No se pudo conectar: {error}', { error: t('Sin conexión con el servidor') }))
      }
      // with a password, a 401 is a wrong one; without one (the one kept is used), a 401 only says it is there
      if (secret && answer.status === 401) throw new Error(t('No reconoce ese usuario o esa contraseña de aplicación.'))
      if (answer.status >= 500 || answer.status === 404) throw new Error(t('No se pudo conectar: {error}', { error: `HTTP ${answer.status}` }))
    }
    Object.assign(connection, await saveConnection({ url, username, name: input.name, token: secret || undefined }))
    if (!connection.hasToken) throw new Error(t('Hace falta la contraseña de aplicación.'))
    if (!(await connect())) throw new Error(serverError.value || t('No se pudo conectar.'))
    return libraryList.value[0]
  },
  async remove() {
    Object.assign(connection, await forgetServer())
    serverError.value = ''
    await use(false)
    listLibraries()
  },
}
/** the app's library and the ones the page keeps (Suwayomi…), together */
const allLibraries = withDeviceLibraries(libraries, net)
const provided = shallowReactive<{ store: Store | null }>({ store: null })
function provideStore(s: Store) { provided.store = s }
provide(STORE, new Proxy({} as Store, { get: (_, key) => (provided.store as any)?.[key] }))

// ---- files of this device opened with La Estantería from another app («Abrir con»). They go on the
// shelf («Archivos sueltos», or their folder if it is one of the shelf's) and stay. ----
let waiting: string[] = []
async function openLocal(uris: string[]) {
  if (!shelf) { notify(t('Esta versión aún no abre archivos del dispositivo.'), true); return }
  if (!store.value) { waiting = [...waiting, ...uris]; return }      // still starting: it opens once ready
  try {
    const items = await shelf.addFiles(uris)
    await refresh()
    if (items.length === 1) read(items[0])
    else { notify(plural(items.length, '{n} archivo en tu estantería.', '{n} archivos en tu estantería.')); go({ v: 'library', source: String(items[0].source_id) }) }
  } catch (err: any) {
    notify(t('No se pudo abrir: {error}', { error: err?.message || String(err) }), true)
  }
}
;(window as any).__estanteriaOpen = (uri: string) => openLocal([uri])
;(window as any).__estanteriaNotify = (text: string, error = false) => notify(text, error)
// ---- downloads kept by the app: how each is going, by the file's API path ----
const downloads = reactive<Record<string, DownloadState>>({})
;(window as any).__estanteriaDownload = (path: string, state: DownloadState | null) => {
  if (state) downloads[path] = state
  else delete downloads[path]
}
watch(store, (s) => { if (s && waiting.length) { const uris = waiting; waiting = []; openLocal(uris) } })

// without connection, look again every so often (and when Android says the network is back)
setInterval(() => { if (connected.value && offline.value && !offline.value.state.online) refresh() }, 30000)
window.addEventListener('online', () => { if (connected.value) refresh() })

onMounted(async () => {
  try {
    hostInfo = await info()
    native = hostNative(hostInfo)
    native.wifiOnly?.(appSettings.wifiOnly)
    await lock.lockIfAsked()
    // the release this page is (an update over the air moves it on; the native version stays)
    version.value = RELEASE
  } catch (err: any) {
    version.value = '?'
    state.error = t('No se pudo hablar con la app: {error}', { error: err?.message || String(err) })
  }
  if (hostInfo.shelf) {
    shelf = new LocalShelf(hostShelf(hostInfo))
    await shelf.load()
    if (appSettings.scanOnStart) shelf.scan().catch(() => {})
  }
  try { Object.assign(connection, await loadConnection()) } catch (_) {}
  if (!window.location.hash && appSettings.start === 'library') go({ v: 'library' }, true)
  await connect()
  console.log(`viewport ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio} screen ${screen.width}x${screen.height} availHeight ${screen.availHeight}`)
  tellApp({ type: 'ready' })
})
</script>
