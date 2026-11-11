<template>
  <div class="es-reader-shell">
    <div v-if="loading" class="es-reader-loading"><span class="es-spin"></span> {{ t('Abriendo el capítulo…') }}</div>
    <div v-else-if="error" class="es-reader-loading">
      <p>{{ error }}</p>
      <button class="es-btn" @click="store.back()">{{ t('Volver') }}</button>
    </div>
    <ComicReader v-else-if="item" :item="item" :source="source" @changed="() => {}" />
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

/** A chapter of a catalog read online, page by page, in the comic reader (nothing is downloaded): its
 * pages come from the catalog's servers through the app's network. */
const props = defineProps<{ catalog: string; chapter: string; title?: string }>()
const store = useStore()
const net = store.net || browserNet
const item = shallowRef<ItemDetail | null>(null)
const loading = ref(true)
const error = ref('')
let urls: string[] = []

/** a page, at whatever width: the catalog's image, fetched once */
function source(page: number): Promise<string> {
  return netImage(net, urls[page])
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
    urls = await chapterPages(net, def, props.chapter)
    const now = Math.round(Date.now() / 1000)
    item.value = {
      id: idOf(`${props.catalog}:${props.chapter}`), source_id: null, path: '', folder: '', name: props.title || t('Capítulo'), format: 'cbz', kind: 'comic',
      size: 0, modified: now, title: props.title || t('Capítulo'), series: null, number: null, author: null, year: null, summary: null,
      pages: urls.length, direction: 'ltr', cover: false, state: 'ready', error: null, added: now, updated: now, meta: {}, progress: null,
      page_sizes: [], bookmarks: [],
    }
  } catch (err: any) {
    error.value = t('No se pudo abrir el capítulo: {error}', { error: err?.message || err })
  }
  loading.value = false
})
</script>
