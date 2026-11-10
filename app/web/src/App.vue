<template>
  <div class="es" :class="{ 'es-reading': view.v === 'read' }">
    <template v-if="view.v === 'read' && store">
      <ReaderView :key="`read${view.id}${view.as || ''}`" :id="view.id" :start-page="view.page" :as="view.as" />
    </template>
    <template v-else>
      <aside class="es-side" aria-label="Tu estantería">
        <div class="es-brand">
          <span class="es-brand-mark" aria-hidden="true"><i class="es-i es-i-book" aria-hidden="true"></i></span>
          <strong>La Estantería</strong>
        </div>
        <nav class="es-nav">
          <a href="#" :class="{ on: view.v === 'home' }" @click.prevent="go({ v: 'home' })"><span class="es-ni"><i class="es-i es-i-home" aria-hidden="true"></i></span> Inicio</a>
          <a href="#" :class="{ on: view.v === 'library' }" @click.prevent="go({ v: 'library' })"><span class="es-ni"><i class="es-i es-i-grid" aria-hidden="true"></i></span> Estantería</a>
          <a href="#" :class="{ on: view.v === 'catalogs' || view.v === 'catalog' }" @click.prevent="go({ v: 'catalogs' })"><span class="es-ni"><i class="es-i es-i-cloud" aria-hidden="true"></i></span> Catálogos</a>
          <a href="#" :class="{ on: view.v === 'sources' }" @click.prevent="go({ v: 'sources' })"><span class="es-ni"><i class="es-i es-i-server" aria-hidden="true"></i></span> Bibliotecas</a>
          <a v-if="offline" href="#" :class="{ on: view.v === 'downloads' }" @click.prevent="go({ v: 'downloads' })">
            <span class="es-ni"><i class="es-i es-i-download" aria-hidden="true"></i></span> Descargas
            <small v-if="jobCount" class="es-muted es-navcount"><span class="es-spin"></span> {{ jobCount }}</small>
            <small v-else-if="offline.count" class="es-muted es-navcount">{{ offline.count }}</small>
          </a>
        </nav>
        <div class="es-lib">
          <div class="es-libh">Series <small class="es-muted">{{ state.series.length }}</small></div>
          <p v-if="!connected" class="es-muted es-small es-libnote">Conecta con tu Archivador para ver tus series.</p>
          <p v-else-if="!state.loaded" class="es-muted es-small es-libnote"><span class="es-spin"></span> Cargando…</p>
          <ul v-else class="es-serieslist">
            <li v-for="s in state.series" :key="s.series">
              <a href="#" :class="{ on: view.v === 'series' && view.name === s.series }" @click.prevent="go({ v: 'series', name: s.series })">
                <Cover :id="s.cover_item" :has="s.cover" class="es-thumb" />
                <span class="es-sname"><span class="es-ellipsis">{{ s.series }}</span><small class="es-muted">{{ s.items }} {{ s.items === 1 ? 'número' : 'números' }}</small></span>
              </a>
            </li>
          </ul>
        </div>
        <a href="#" class="es-back" :class="{ on: view.v === 'setup' }" @click.prevent="go({ v: 'setup' } as any)"><i class="es-i es-i-settings" aria-hidden="true"></i> {{ connection.username ? connection.username : 'Conectar' }} <span class="es-version">· v{{ version }}</span></a>
      </aside>

      <main ref="mainEl" class="es-main">
        <!-- on a phone the bar at the bottom has no room for the account: a gear in the corner instead -->
        <button class="es-gear" :class="{ on: view.v === 'setup' }" type="button" aria-label="Ajustes" @click="go({ v: 'setup' } as any)"><i class="es-i es-i-settings" aria-hidden="true"></i></button>
        <p v-if="offline && !offline.state.online" class="es-offline-banner">
          <i class="es-i es-i-cloud" aria-hidden="true"></i>
          <span>Sin conexión con La Estantería: puedes leer lo descargado. Lo que leas se apunta y se envía al volver.</span>
          <span class="es-grow"></span>
          <button class="es-btn es-small" @click="refresh()">Reintentar</button>
        </p>
        <p v-if="state.error" class="es-banner es-banner-error">{{ state.error }} <button class="es-btn es-small" @click="connect()">Reintentar</button></p>
        <section v-if="view.v === 'setup' || !connected" class="es-page">
          <header class="es-page-head"><h1 class="es-h1">Tu Archivador</h1></header>
          <form class="es-setup" @submit.prevent="save">
            <p class="es-muted">La Estantería lee los cómics y libros de la carpeta «Lectura» de tu nube. Hace falta tu usuario y una <strong>contraseña de aplicación</strong> (en El Archivador: tu cuenta › Contraseñas de aplicación); se guarda cifrada en este dispositivo.</p>
            <label>Dirección del servicio <input v-model="form.url" type="url" placeholder="https://estanteria.pistation.dev" required /></label>
            <label>Usuario <input v-model="form.username" type="text" autocomplete="username" autocapitalize="none" required /></label>
            <label>Contraseña de aplicación <input v-model="form.token" type="password" autocomplete="current-password" :placeholder="connection.hasToken && !form.token ? '(guardada; escribe otra para cambiarla)' : ''" /></label>
            <div class="es-setup-actions">
              <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> Conectar</button>
              <button v-if="connected" class="es-btn" type="button" @click="disconnect">Olvidar</button>
            </div>
          </form>
          <h2 class="es-h2 es-setup-h2">Aspecto</h2>
          <div class="es-theme" role="radiogroup" aria-label="Tema">
            <button v-for="t in THEMES" :key="t.id" type="button" class="es-btn" :class="{ on: theme === t.id }" role="radio" :aria-checked="theme === t.id" @click="setTheme(t.id)">
              <i class="es-i" :class="t.icon" aria-hidden="true"></i> {{ t.label }}
            </button>
          </div>
          <p class="es-muted es-small">La Estantería · v{{ version }}</p>
        </section>
        <template v-else-if="store">
          <HomeView v-if="view.v === 'home'" />
          <LibraryView v-else-if="view.v === 'library'" :q="view.q || ''" :kind="view.kind" :sort="view.sort" :folder="view.folder" :source="view.source" />
          <SeriesView v-else-if="view.v === 'series'" :key="`s${view.name}`" :name="view.name" />
          <ItemView v-else-if="view.v === 'item'" :key="`i${view.id}`" :id="view.id" />
          <SourcesView v-else-if="view.v === 'sources'" :add="view.add" />
          <CatalogsView v-else-if="view.v === 'catalogs'" />
          <DownloadsView v-else-if="view.v === 'downloads'" />
          <CatalogView v-else-if="view.v === 'catalog'" :key="`c${view.kind}`" :kind="view.kind" :path="view.path" :q="view.q" />
        </template>
      </main>
    </template>
    <div v-if="toast.text" :class="['es-toast', { 'es-toast-error': toast.error }]" role="status">{{ toast.text }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref, shallowRef, watch } from 'vue'
import { Api, CatalogView, CatalogsView, Cover, DownloadsView, HomeView, LocalShelf, Offline, ImageCache, ItemView, LibraryView, ReaderView, SeriesView, SourcesView, STORE,
         createState, queryFromView, viewFromQuery, type Item, type Store, type View } from 'estanteria-viewer'
import { HOST_BASE, TOKEN, forgetToken, hostBackend, hostShelf, hostUrl, info, loadConnection, saveConnection, tellApp, type Connection } from './lib/host'

/**
 * The Android shell of La Estantería: the same library and readers as the web and the desktop, served
 * by the app's own local server (the host), which also talks to the service of the user's Archivador
 * with their credential. The page shown lives in the URL's hash (#v=series&name=…), so the back
 * button works. What the host can do (keep files, read the device's folders) it says at start.
 */
const version = ref('')
const connection = reactive<Connection>({ url: '', username: '', hasToken: false })
const form = reactive({ url: '', username: '', token: '' })
const connected = ref(false)
const saving = ref(false)
const state = createState()
const toast = reactive({ text: '', error: false })
const mainEl = ref<HTMLElement>()
let toastTimer: any = null
let hostInfo = { version: '', shelf: false, offline: false }

// ---- the theme: the system's, or one chosen here (kept in this device) ----
type Theme = 'system' | 'light' | 'dark'
const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'system', label: 'Como el sistema', icon: 'es-i-computer' }, { id: 'light', label: 'Claro', icon: 'es-i-sun' }, { id: 'dark', label: 'Oscuro', icon: 'es-i-moon' },
]
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
const view = computed<View | { v: 'setup' }>(() => {
  const params = Object.fromEntries(new URLSearchParams(hash.value.replace(/^#/, '')))
  return params.v === 'setup' ? { v: 'setup' } : viewFromQuery(params)
})
function go(next: View | { v: 'setup' }, replace = false) {
  const query = next.v === 'setup' ? 'v=setup' : new URLSearchParams(queryFromView(next as View)).toString()
  if (replace) window.history.replaceState(null, '', `#${query}`)
  else window.location.hash = query
  hash.value = `#${query}`
}
function back() {
  if (window.history.length > 1) window.history.back()
  else go({ v: 'home' })
}
watch(() => hash.value, () => mainEl.value?.scrollTo({ top: 0 }))
// the screen stays on while reading (the app does it)
watch(() => view.value.v === 'read', (reading) => tellApp({ type: 'reading', on: reading }))

function notify(text: string, error = false) {
  toast.text = text
  toast.error = error
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { toast.text = '' }, error ? 7000 : 3500)
}

// ---- the service, through the host (it adds the credential; this header only names this page to it) ----
const api = new Api(HOST_BASE, () => `Host ${TOKEN}`)
let current: Api = api
const store = ref<Store | null>(null)
// ---- reading without connection: the host keeps the files; the keeper follows the account the host has ----
const offline = shallowRef<Offline | null>(null)
const jobCount = computed(() => (offline.value ? Object.keys(offline.value.state.jobs).length : 0))
// ---- the folders and files of this device ----
let shelf: LocalShelf | null = null

function makeStore(): Store {
  current = new Api(HOST_BASE, () => `Host ${TOKEN}`)
  const covers = new ImageCache(current, 400)
  const pages = new ImageCache(current, 24)
  const s: Store = { api: current, covers, pages, readingRoot: 'Lectura', state, refresh, go: go as any, back, notify, read,
    // the app downloads the file (through the host, with the token in the URL) and offers to share or open it
    saveFile: (path, name) => { tellApp({ type: 'download', url: new URL(hostUrl(path), window.location.href).toString(), name }); notify(`Descargando ${name}…`) } }
  if (hostInfo.offline) {
    const keeper = offline.value || new Offline(hostBackend())
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
    state.error = `No se pudo hablar con La Estantería: ${err?.message || err}`
  }
}
async function connect() {
  state.error = ''
  if (!connection.url || !connection.username || !connection.hasToken) { connected.value = false; return }
  const s = makeStore()
  await offline.value?.load()
  try {
    await current.ensureConnected()
    store.value = s
    provideStore(s)
    connected.value = true
    state.connected = true
    await refresh()
  } catch (err: any) {
    connected.value = false
    state.error = err?.status === 401 ? 'El Archivador no reconoce ese usuario o esa contraseña de aplicación.' : `No se pudo conectar: ${err?.message || err}`
  }
}
const provided = reactive<{ store: Store | null }>({ store: null })
function provideStore(s: Store) { provided.store = s }
provide(STORE, new Proxy({} as Store, { get: (_, key) => (provided.store as any)?.[key] }))

async function save() {
  saving.value = true
  try {
    const saved = await saveConnection({ url: form.url.trim().replace(/\/+$/, ''), username: form.username.trim(), token: form.token.trim() || undefined })
    Object.assign(connection, saved)
    form.token = ''
    if (!connection.hasToken) { state.error = 'Hace falta la contraseña de aplicación.'; return }
    await connect()
    if (connected.value) { notify(`Conectado como ${connection.username}.`); go({ v: 'home' }, true) }
  } catch (err: any) {
    state.error = `No se pudo guardar: ${err?.message || err}`
  } finally {
    saving.value = false
  }
}
async function disconnect() {
  Object.assign(connection, await forgetToken())
  connected.value = false
  state.connected = false
  state.loaded = false
  state.series = []
  notify('Olvidado.')
}

// ---- files of this device opened with La Estantería from another app («Abrir con»). They go on the
// shelf («Archivos sueltos», or their folder if it is one of the shelf's) and stay. ----
let waiting: string[] = []
async function openLocal(uris: string[]) {
  if (!shelf) { notify('Esta versión aún no abre archivos del dispositivo.', true); return }
  if (!connected.value || !store.value) {
    waiting = [...waiting, ...uris]
    notify('Conecta con tu Archivador y el archivo se abrirá después.', true)
    return
  }
  try {
    const items = await shelf.addFiles(uris)
    await refresh()
    if (items.length === 1) read(items[0])
    else { notify(`${items.length} archivos en tu estantería.`); go({ v: 'library', source: String(items[0].source_id) }) }
  } catch (err: any) {
    notify(`No se pudo abrir: ${err?.message || err}`, true)
  }
}
;(window as any).__estanteriaOpen = (uri: string) => openLocal([uri])
;(window as any).__estanteriaNotify = (text: string, error = false) => notify(text, error)
watch(connected, (ok) => { if (ok && waiting.length) { const uris = waiting; waiting = []; openLocal(uris) } })

// without connection, look again every so often (and when Android says the network is back)
setInterval(() => { if (connected.value && offline.value && !offline.value.state.online) refresh() }, 30000)
window.addEventListener('online', () => { if (connected.value) refresh() })

onMounted(async () => {
  try {
    hostInfo = await info()
    version.value = hostInfo.version
  } catch (err: any) {
    version.value = '?'
    state.error = `No se pudo hablar con la app: ${err?.message || err}`
  }
  if (hostInfo.shelf) {
    shelf = new LocalShelf(hostShelf())
    await shelf.load()
  }
  try { Object.assign(connection, await loadConnection()) } catch (_) {}
  form.url = connection.url
  form.username = connection.username
  await connect()
  if (!connected.value && view.value.v !== 'setup') go({ v: 'setup' }, true)
  tellApp({ type: 'ready' })
})
</script>
