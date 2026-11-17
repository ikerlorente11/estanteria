<template>
  <div class="es-reader-shell">
    <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> {{ t('Abriendo el capítulo…') }}</div>
    <div v-else-if="error" class="es-reader-loading">
      <p>{{ error }}</p>
      <button class="es-btn" @click="store.back()">{{ t('Volver') }}</button>
    </div>
    <ComicReader v-else-if="item" :item="item" :start-page="item.progress?.finished ? 0 : item.progress?.page ?? 0" :source="source" @changed="() => {}" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, shallowRef } from 'vue'
import type { ItemDetail } from '../lib/api'
import { t } from '../lib/i18n'
import { chapterPages } from '../lib/chapters'
import { browserNet } from '../lib/net'
import { netImage } from '../lib/netimages'
import { useStore } from '../lib/store'
import ComicReader from './ComicReader.vue'
import { sharedProgress } from '../lib/handoff'
import { useSync } from '../lib/favorites'
import { telegramChapter, telegramLink } from '../lib/telegram'

/** A chapter of a catalog read online, page by page, in the comic reader (nothing is downloaded): its
 * pages come from the catalog's servers through the app's network. */
const props = defineProps<{ catalog: string; chapter: string; title?: string }>()
const store = useStore()
useSync(store)
const net = store.net || browserNet
const item = shallowRef<ItemDetail | null>(null)
const loading = ref(true)
const error = ref('')
let urls: string[] = []
/** Telegram: its images are asked to it, not fetched by address (telegram.ts) */
let telegramPage: ((n: number) => Promise<string>) | null = null

/** a page, at whatever width: the catalog's image, fetched once */
function source(page: number): Promise<string> {
  return telegramPage ? telegramPage(page) : netImage(net, urls[page])
}

/** A stable id for the chapter, below 0. */
function idOf(text: string): number {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0
  return -Math.abs(h || 1)
}

onMounted(async () => {
  try {
    const def = store.catalogs?.get(props.catalog)
    if (!def) throw new Error(t('Ese catálogo ya no está entre los tuyos.'))
    let count: number
    let start: number | null = null
    if (def.protocol === 'telegram') {
      const link = def.library ? telegramLink(store, def.library) : null
      if (!link) throw new Error(t('Esta versión de la app no puede conectar con Telegram.'))
      const chapter = telegramChapter(link, props.chapter)
      telegramPage = chapter.page
      count = chapter.count
      start = chapter.start
    } else {
      urls = await chapterPages(net, def, props.chapter)
      count = urls.length
    }
    const now = Math.round(Date.now() / 1000)
    item.value = {
      // its path is its key: what was read of it goes to the other devices (see handoff.ts)
      // (Telegram's images: a path without progress, see handoff.progressKey; what is seen of them is not noted)
      id: idOf(`${props.catalog}:${props.chapter}`), source_id: null,
      path: start !== null ? `telegram:${props.catalog}` : `chapter:${props.catalog}:${props.chapter}`, folder: '', name: props.title || t('Capítulo'), format: 'cbz', kind: 'comic',
      size: 0, modified: now, title: props.title || t('Capítulo'), series: null, number: null, author: null, year: null, summary: null,
      pages: count, direction: 'ltr', cover: false, state: 'ready', error: null, added: now, updated: now, meta: {},
      // Telegram's images open where they were tapped (what is seen of them is not kept)
      progress: start !== null ? { page: start, location: null, percent: 0, finished: false, device: null, updated: now }
        : sharedProgress({ path: `chapter:${props.catalog}:${props.chapter}` }),
      page_sizes: [], bookmarks: [],
    }
  } catch (err: any) {
    error.value = t('No se pudo abrir el capítulo: {error}', { error: err?.message || err })
  }
  loading.value = false
})
</script>
