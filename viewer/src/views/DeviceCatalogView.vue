<template>
  <section class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p class="es-muted es-small es-crumbs">
          <a href="#" @click.prevent="go({ v: 'catalogs' })">{{ t('Catálogos') }}</a>
          <template v-if="path || q"> › <a href="#" @click.prevent="go({ v: 'catalog', kind: def.id })">{{ def.name }}</a></template>
        </p>
        <h1 class="es-h1">{{ q ? `«${q}»` : feed?.title || def.name }}</h1>
      </div>
      <span class="es-grow"></span>
      <select v-if="def.protocol === 'mangadex'" class="es-select" :value="lang" :aria-label="t('Idioma')" @change="setLang(($event.target as HTMLSelectElement).value)">
        <option v-for="l in MANGADEX_LANGUAGES" :key="l" :value="l">{{ languageName(l) }}</option>
      </select>
      <input v-if="canSearch" :value="q" class="es-search" type="search" :placeholder="t('Buscar en {name}', { name: def.name })" :aria-label="t('Buscar')"
             @keydown.enter="search(($event.target as HTMLInputElement).value)" />
    </header>

    <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}<template v-if="def.protocol === 'suwayomi'"> {{ t('(la fuente puede tardar unos segundos)') }}</template></p>
    <p v-else-if="refreshing" class="es-muted es-small es-refreshing"><span class="es-spin"></span> {{ t('Actualizando…') }}</p>
    <p v-else-if="error" class="es-banner es-banner-error">{{ error }} <button class="es-btn es-small" @click="load()">{{ t('Reintentar') }}</button></p>
    <template v-else-if="feed">
      <div v-if="feed.subtitle || (feed as any).cover" class="es-hero es-hero-slim">
        <img v-if="(feed as any).cover" :src="img((feed as any).cover)" class="es-hero-pic es-hero-pic-small" alt="" />
        <div class="es-hero-text"><p class="es-summary">{{ feed.subtitle }}</p></div>
      </div>

      <div v-if="feed.navigation.length" class="es-chips es-chips-big">
        <a v-for="n in feed.navigation" :key="n.href" href="#" class="es-chip" :title="n.subtitle || ''" @click.prevent="open(n.href)">{{ n.title }}</a>
      </div>

      <!-- a whole series: every chapter not downloaded yet, into the queue (a few at a time) -->
      <div v-if="entries.length && entries[0].chapter && canSave" class="es-series-actions">
        <button class="es-btn es-small" :disabled="gathering || !missing" @click="downloadAll">
          <span v-if="gathering" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i>
          {{ missing ? t('Descargar todos ({n})', { n: missing }) + (next ? '+' : '') : t('Todos descargados') }}
        </button>
        <small v-if="queued" class="es-muted">{{ t('{n} en cola', { n: queued }) }}</small>
      </div>
      <div v-if="entries.length && entries[0].chapter" class="es-chapters">
        <div v-for="e in entries" :key="e.id" class="es-chapter" :class="{ 'es-chapter-seen': seen[e.chapter!] }">
          <a href="#" class="es-chapter-open" @click.prevent="readChapter(e)">
            <strong class="es-ellipsis">{{ e.title }}</strong>
            <small class="es-muted es-ellipsis">{{ e.detail }}<template v-if="jobOf(e)"> · {{ jobLabel(jobOf(e)) || t('Empezando…') }}</template></small>
          </a>
          <span class="es-chapter-actions">
            <button v-if="catalogGot[keyOf(e)] && hasItem(e)" class="es-btn es-small" :title="t('Abrir lo descargado (para leerlo sin conexión o subirlo a tu servidor)')" @click="openDownloaded(e)">
              <i class="es-i es-i-check" aria-hidden="true"></i>
            </button>
            <button v-else class="es-btn es-small" :disabled="!!jobOf(e) || !canSave" :title="canSave ? t('Descargar el capítulo (CBZ) para leerlo sin conexión') : t('Esta versión no puede guardar archivos')" @click="downloadChapter(e)">
              <span v-if="jobOf(e)" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i>
            </button>
          </span>
        </div>
      </div>
      <div v-else-if="entries.length" class="es-grid">
        <article v-for="e in entries" :key="e.id" class="es-card es-entry" :class="{ 'es-entry-kept': catalogGot[keyOf(e)] }">
          <a href="#" class="es-card-cover" :title="e.title" @click.prevent="act(e)">
            <span class="es-cover-box">
              <img v-if="e.cover && img(e.cover)" :src="img(e.cover)" alt="" loading="lazy" />
              <span v-else class="es-cover-none"><i class="es-i" :class="e.href ? 'es-i-pages' : 'es-i-book'" aria-hidden="true"></i></span>
              <span v-if="jobOf(e)" class="es-card-wait"><span class="es-spin"></span><small>{{ jobLabel(jobOf(e)) || t('Empezando…') }}</small></span>
              <span v-else-if="catalogGot[keyOf(e)]" class="es-card-check" :title="t('En tu estantería')"><i class="es-i es-i-check" aria-hidden="true"></i></span>
            </span>
          </a>
          <div class="es-card-text">
            <a href="#" class="es-card-title es-ellipsis" :title="e.title" @click.prevent="act(e)">{{ e.title }}</a>
            <span class="es-muted es-small es-ellipsis">{{ [e.author, offerOf(e)?.format?.toUpperCase()].filter(Boolean).join(' · ') }}</span>
          </div>
          <div v-if="!e.href" class="es-entry-actions">
            <button class="es-btn es-small" :disabled="!!jobOf(e) || !offerOf(e)" :title="offerOf(e) ? '' : t('No ofrece un formato que se lea aquí')" @click="act(e)">
              <i class="es-i es-i-book-open" aria-hidden="true"></i> {{ t('Leer') }}
            </button>
            <button v-if="!catalogGot[keyOf(e)] || !hasItem(e)" class="es-btn es-small" :disabled="!!jobOf(e) || !offerOf(e)" :title="t('Descargarlo a tu estantería para leerlo sin conexión')" @click="download(e)">
              <span v-if="jobOf(e)" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i>
              <template v-if="jobOf(e)"> {{ jobLabel(jobOf(e)) }}</template>
            </button>
            <button v-else-if="store.state.server" class="es-btn es-small" :title="t('Descargado: ábrelo para subirlo a {server}', { server: serverLabel(store) })" @click="openDownloaded(e)">
              <i class="es-i es-i-cloud" aria-hidden="true"></i> {{ t('Subir') }}
            </button>
          </div>
        </article>
      </div>

      <p v-if="!entries.length && !feed.navigation.length" class="es-muted">{{ q ? t('Nada con «{q}».', { q }) : t('Nada por aquí.') }}</p>
      <!-- the chapters of a manga grow in place; a list goes page by page (each page its own, back and forth) -->
      <button v-if="next && isChapters" class="es-btn es-more" :disabled="loadingMore" @click="more">
        <span v-if="loadingMore" class="es-spin"></span> {{ t('Ver más') }}
      </button>
      <nav v-else-if="next || pageNumber > 1" class="es-pager" :aria-label="t('Páginas')">
        <button v-if="pageNumber > 1" class="es-btn" @click="back()"><i class="es-i es-i-prev" aria-hidden="true"></i> {{ t('Anterior') }}</button>
        <span v-if="pageNumber" class="es-muted">{{ t('Página {n}', { n: pageNumber }) }}</span>
        <button v-if="next" class="es-btn es-primary" @click="open(next)">{{ t('Siguiente') }} <i class="es-i es-i-next" aria-hidden="true"></i></button>
      </nav>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import type { Item } from '../lib/api'
import { bestFormat, fileName, languageName, type CatalogDef } from '../lib/catalogs'
import { t } from '../lib/i18n'
import { MANGADEX_LANGUAGES, mangadexFeed } from '../lib/mangadex'
import { browserNet } from '../lib/net'
import { authOf, netImageNow } from '../lib/netimages'
import { readFeed, searchUrl, type Feed, type FeedEntry } from '../lib/opds'
import { seriesOfTitle } from '../lib/local'
import { cachedFeed, prefetchFeed } from '../lib/feedcache'
import { catalogGot, catalogJobs, jobLabel, runCatalogDownload, type CatalogKind } from '../lib/catalogdownloads'
import { serverLabel, useStore } from '../lib/store'
import { storeZip } from '../lib/zipstore'
import { chapterPages } from '../lib/chapters'
import { suwayomiServer } from '../lib/devicelibraries'
import { randomTag, suwayomiFeed } from '../lib/suwayomi'

/** A catalog the app reads by itself: its sections, what it offers and its search. A book or a comic is
 * downloaded to this device's shelf to be read (and stays there); a chapter is read page by page. */
const props = defineProps<{ def: CatalogDef; path?: string; q?: string }>()
const store = useStore()
const { go } = store
const net = store.net || browserNet
const feed = shallowRef<Feed | null>(null)
const entries = ref<FeedEntry[]>([])
const next = ref<string | null>(null)
const loading = ref(true)
const loadingMore = ref(false)
const error = ref('')
let rootSearch: string | null = null

// ---- the language of a catalog in many (MangaDex), kept per catalog ----
const LANG_KEY = `estanteria.catalog.lang.${props.def.id}`
const lang = ref((() => {
  try { const saved = localStorage.getItem(LANG_KEY); if (saved) return saved } catch (_) {}
  const mine = (navigator.language || 'es').toLowerCase()
  return MANGADEX_LANGUAGES.includes(mine) ? mine : MANGADEX_LANGUAGES.includes(mine.slice(0, 2)) ? mine.slice(0, 2) : 'en'
})())
function setLang(l: string) {
  lang.value = l
  try { localStorage.setItem(LANG_KEY, l) } catch (_) {}
  load()
}

// ---- what was downloaded from catalogs: the shelf's item of each file ----
// what was downloaded and what is downloading: the app's (see catalogdownloads.ts), not this page's
// ---- chapters already opened ----
const SEEN_KEY = 'estanteria.catalogs.seen'
const seen = reactive<Record<string, number>>((() => { try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch (_) { return {} } })())

const img = (url: string | null | undefined) => netImageNow(store.net, url)
const offerOf = (e: FeedEntry) => bestFormat(e.offers)
const jobOf = (e: FeedEntry) => catalogJobs[keyOf(e)]
const keyOf = (e: FeedEntry) => (e.chapter ? `chapter:${props.def.id}:${e.chapter}` : offerOf(e)?.href || e.id)
const canSave = computed(() => !!store.shelf && !!store.net)
/** what was downloaded is still on the shelf (it may have been removed since) */
const hasItem = (e: FeedEntry) => !!store.shelf?.has(catalogGot[keyOf(e)])
/** the downloaded file's page: read it offline, upload it to a server of one's own */
function openDownloaded(e: FeedEntry) { go({ v: 'item', id: catalogGot[keyOf(e)] }) }
const canSearch = computed(() => props.def.protocol !== 'opds' || !!(feed.value?.search || rootSearch))

/** what a page is kept as (the language of a catalog in many is part of it) */
const keyOf$ = (address: string | undefined) => `${props.def.id}|${props.def.protocol === 'mangadex' ? lang.value : ''}|${address || ''}`
const refreshing = ref(false)
const isChapters = computed(() => !!entries.value[0]?.chapter)
/** the number of the page shown, when its address tells (page=, or offset= of MangaDex's 32) */
const pageNumber = computed(() => {
  const a = props.path || ''
  const page = a.match(/[?&]page=(\d+)/)
  if (page) return Number(page[1])
  const offset = a.match(/^mangadex:[^?]*\?.*\boffset=(\d+)/)
  return offset ? Math.floor(Number(offset[1]) / 32) + 1 : a.includes(':list') || a.includes(':search') ? 1 : 0
})
function back() { if (window.history.length > 1) window.history.back() }

async function fetchFeed(address: string | undefined): Promise<Feed> {
  if (props.def.protocol === 'mangadex') return mangadexFeed(net, address || 'mangadex:home', lang.value)
  if (props.def.protocol === 'suwayomi') {
    const server = props.def.library ? suwayomiServer(props.def.library) : null
    if (!server) throw new Error(t('Ese servidor Suwayomi ya no está entre tus bibliotecas.'))
    return suwayomiFeed(net, server, props.def.source!, address || 'suwayomi:home', props.def.supportsLatest !== false)
  }
  return readFeed(net, address || props.def.url)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    let address = props.path
    if (props.q) {
      if (props.def.protocol === 'mangadex') address = `mangadex:search?q=${encodeURIComponent(props.q)}`
      else if (props.def.protocol === 'suwayomi') address = `suwayomi:search?q=${encodeURIComponent(props.q)}`
      else {
        if (!rootSearch) rootSearch = (await fetchFeed(undefined)).search
        if (!rootSearch) throw new Error(t('Este catálogo no permite buscar.'))
        address = searchUrl(rootSearch, props.q)
      }
    }
    const shown = address
    const show = (f: Feed) => {
      if (!address) rootSearch = f.search
      feed.value = f
      entries.value = f.entries
      next.value = f.next
      // the next page asked now, so that «Siguiente» is at once
      if (f.next && !f.entries[0]?.chapter) {
        const ahead = prefetchFeed(keyOf$(f.next), () => fetchFeed(f.next!))
        // at random each page is a slow page of the source: two ahead, so «Siguiente» rarely waits
        if (/^suwayomi:random/.test(f.next)) void ahead.then((g) => { if (g?.next) prefetchFeed(keyOf$(g.next), () => fetchFeed(g.next!)) })
      }
    }
    const { feed: f, stale } = await cachedFeed(keyOf$(address), () => fetchFeed(address), (fresh) => {
      // still on that page: the new one in place of what was kept
      if (shown === address && feed.value?.url === f.url) { show(fresh); refreshing.value = false }
    })
    refreshing.value = stale
    show(f)
  } catch (err: any) {
    error.value = t('No se pudo abrir {name}: {error}', { name: props.def.name, error: err?.message || String(err) })
  }
  loading.value = false
}
async function more() {
  if (!next.value) return
  loadingMore.value = true
  try {
    const f = await fetchFeed(next.value)
    entries.value = [...entries.value, ...f.entries]
    next.value = f.next
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  loadingMore.value = false
}
function open(address: string) {
  // «Al azar»: each time a new run (its pages are kept as they were, back and forth)
  if (/^suwayomi:random/.test(address) && !/[?&]s=/.test(address)) address = `suwayomi:random?s=${randomTag()}&page=1`
  go({ v: 'catalog', kind: props.def.id, path: address })
}
function search(q: string) {
  q = q.trim()
  go(q ? { v: 'catalog', kind: props.def.id, q } : { v: 'catalog', kind: props.def.id })
}

/** Opening an entry: a section goes there, a chapter is read, a file is read (downloaded first if needed). */
function act(e: FeedEntry) {
  if (e.href) return open(e.href)
  if (e.chapter) return readChapter(e)
  return readFile(e)
}
function readChapter(e: FeedEntry) {
  seen[e.chapter!] = Math.round(Date.now() / 1000)
  try { localStorage.setItem(SEEN_KEY, JSON.stringify(seen)) } catch (_) {}
  go({ v: 'chapter', catalog: props.def.id, chapter: e.chapter!, title: `${feed.value?.title || ''} · ${e.title}` })
}
/** what a file of the catalog is: a book, or a comic (manga when the catalog only has manga) */
function kindOf(e: FeedEntry, format: string): CatalogKind {
  if (!['cbz', 'cbr', 'cb7', 'cbt'].includes(format)) return 'book'
  return props.def.content.includes('manga') && !props.def.content.includes('comics') ? 'manga' : 'comic'
}
async function fetchToShelf(e: FeedEntry): Promise<Item | null> {
  const offer = offerOf(e)
  if (!offer) { store.notify(t('No ofrece un formato que se lea aquí.'), true); return null }
  if (!store.shelf || !store.net) { store.notify(t('Esta versión no puede guardar archivos en el dispositivo.'), true); return null }
  const known = catalogGot[keyOf(e)]
  if (known && store.shelf.has(known)) return store.shelf.item(known) as Item
  const shelf = store.shelf
  const saver = store.net
  try {
    // in the folder of its series; one on its own, in that of its title («The Flash 012» → The Flash)
    const series = (e as any).series || seriesOfTitle(e.title)
    const id = await runCatalogDownload(keyOf(e), e.title, { series, kind: kindOf(e, offer.format!), title: e.title }, 'bytes', async (progress) => {
      const uri = await saver.download(offer.href, fileName(e.title, offer.format!), undefined, progress, series)
      const [item] = await shelf.addFiles([uri])
      return item.id
    })
    await store.refresh()
    return shelf.item(id) as Item
  } catch (err: any) {
    store.notify(t('No se pudo descargar «{title}»: {error}', { title: e.title, error: err?.message || String(err) }), true)
    return null
  }
}
/** A chapter as a CBZ on the shelf: its pages fetched one by one and packed here, with a ComicInfo.xml
 * that says what it is (and that it reads right to left). */
// ---- a whole series ----
const gathering = ref(false)
/** the chapters shown that are not downloaded (nor going) */
const missing = computed(() => entries.value.filter((e) => e.chapter && !(catalogGot[keyOf(e)] && hasItem(e)) && !jobOf(e)).length)
/** how many of this series are waiting or going */
const queued = computed(() => entries.value.filter((e) => e.chapter && jobOf(e)).length)
async function downloadAll() {
  gathering.value = true
  try {
    // the rest of the chapters too (a long series comes in pages)
    while (next.value) {
      const f = await fetchFeed(next.value)
      entries.value = [...entries.value, ...f.entries]
      next.value = f.next
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  gathering.value = false
  const todo = entries.value.filter((e) => e.chapter && !(catalogGot[keyOf(e)] && hasItem(e)) && !jobOf(e))
  if (!todo.length) return
  store.notify(t('{n} capítulos en la cola de descargas.', { n: todo.length }))
  let ok = 0
  await Promise.all(todo.map((e) => downloadChapter(e, true).then((got) => { if (got) ok++ })))
  await store.refresh()
  store.notify(t('{series}: {n} capítulos descargados.', { series: feed.value?.title || props.def.name, n: ok }))
}

async function downloadChapter(e: FeedEntry, quiet = false): Promise<boolean> {
  if (!store.shelf || !store.net) return false
  const shelf = store.shelf
  const saver = store.net
  const series = feed.value?.title || props.def.name
  try {
    await runCatalogDownload(keyOf(e), `${series} · ${e.title}`, { series, kind: 'manga', title: e.title }, 'pages', async (progress) => {
      const urls = await chapterPages(net, props.def, e.chapter!)
      const files: { name: string; data: Uint8Array }[] = []
      progress(0, urls.length)
      for (const [i, url] of urls.entries()) {
        const res = await net.fetch(url, { headers: { Accept: 'image/*', ...authOf(url) } })
        if (!res.ok) throw new Error(t('la página {n} respondió {status}', { n: i + 1, status: res.status }))
        const ext = (url.match(/\.(jpe?g|png|webp|gif|avif)(?:$|\?)/i)?.[1] || 'jpg').toLowerCase()
        files.push({ name: `${String(i + 1).padStart(3, '0')}.${ext}`, data: new Uint8Array(await res.arrayBuffer()) })
        progress(i + 1, urls.length)
      }
      const number = e.number || ''
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const info = `<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo><Series>${esc(series)}</Series>${number ? `<Number>${number}</Number>` : ''}<Title>${esc(e.title)}</Title>`
        + `<LanguageISO>${esc(e.language || lang.value)}</LanguageISO><Manga>YesAndRightToLeft</Manga><Web>${esc(props.def.site || props.def.url)}</Web></ComicInfo>`
      files.unshift({ name: 'ComicInfo.xml', data: new TextEncoder().encode(info) })
      const zip = storeZip(files)
      const uri = await saver.save(`${series} - ${e.title}`.replace(/[\\/:*?"<>|]+/g, ' ').slice(0, 140) + '.cbz', new Blob([zip.buffer as ArrayBuffer], { type: 'application/vnd.comicbook+zip' }), series)
      const [item] = await shelf.addFiles([uri])
      return item.id
    })
    if (!quiet) await store.refresh()
    if (!quiet) store.notify(t('«{title}» descargado: se lee sin conexión.', { title: e.title }))
    return true
  } catch (err: any) {
    store.notify(t('No se pudo descargar «{title}»: {error}', { title: e.title, error: err?.message || String(err) }), true)
    return false
  }
}
async function readFile(e: FeedEntry) {
  const item = await fetchToShelf(e)
  if (item) store.read(item)
}
async function download(e: FeedEntry) {
  const item = await fetchToShelf(e)
  if (item) store.notify(t('«{title}» está en tu estantería.', { title: e.title }))
}

onMounted(load)
watch(() => [props.path, props.q, props.def.id], load)
</script>
