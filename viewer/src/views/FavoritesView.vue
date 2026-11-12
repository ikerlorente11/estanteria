<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Favoritos') }}</h1>
    </header>
    <div class="es-chips" role="tablist">
      <button v-for="tab in TABS" :key="tab.type" class="es-chip" :class="{ on: shown === tab.type }" role="tab" :aria-selected="shown === tab.type" @click="shown = tab.type">
        <i class="es-i" :class="tab.icon" aria-hidden="true"></i> {{ t(tab.label) }}<span class="es-chip-count">{{ favs[tab.type].length }}</span>
      </button>
    </div>

    <!-- series of the shelf -->
    <template v-if="shown === 'series'">
      <p v-if="!favs.series.length" class="es-muted">{{ t('Ninguna serie todavía: márcala con la estrella en su página.') }}</p>
      <div v-else class="es-grid">
        <article v-for="f in favs.series" :key="f.key" class="es-card">
          <a href="#" class="es-card-cover" :title="f.value.title" @click.prevent="go({ v: 'series', name: f.value.series! })">
            <Cover v-if="seriesOf(f.value.series!)" :id="seriesOf(f.value.series!)!.cover_item" :has="seriesOf(f.value.series!)!.cover" />
            <span v-else class="es-cover-box"><span class="es-cover-none"><i class="es-i es-i-grid" aria-hidden="true"></i></span></span>
          </a>
          <div class="es-card-text">
            <a href="#" class="es-card-title es-ellipsis" :title="f.value.title" @click.prevent="go({ v: 'series', name: f.value.series! })">{{ f.value.title }}</a>
            <span class="es-muted es-small es-ellipsis">
              <template v-if="seriesOf(f.value.series!)">{{ plural(seriesOf(f.value.series!)!.items, '{n} número', '{n} números') }}</template>
              <template v-else>{{ t('No está en tu estantería ahora') }}</template>
            </span>
          </div>
          <FavoriteButton :fav="f" small class="es-fav-corner" />
        </article>
      </div>
    </template>

    <!-- single files -->
    <template v-else-if="shown === 'item'">
      <p v-if="!favs.item.length" class="es-muted">{{ t('Ningún archivo todavía: márcalo con la estrella en su ficha.') }}</p>
      <div v-else class="es-grid">
        <template v-for="f in favs.item" :key="f.key">
          <div v-if="items[f.key]" class="es-fav-wrap">
            <ItemCard :item="items[f.key]!" @read="store.read(items[f.key]!)" @open="go({ v: 'item', id: items[f.key]!.id })" />
            <FavoriteButton :fav="f" small class="es-fav-corner" />
          </div>
          <article v-else class="es-card">
            <span class="es-card-cover"><span class="es-cover-box"><span class="es-cover-none">
              <span v-if="missing[f.key] === undefined" class="es-spin"></span><i v-else class="es-i es-i-page" aria-hidden="true"></i>
            </span></span></span>
            <div class="es-card-text">
              <span class="es-card-title es-ellipsis" :title="f.value.title">{{ f.value.title }}</span>
              <span v-if="missing[f.key]" class="es-muted es-small">{{ missing[f.key] }}</span>
            </div>
            <FavoriteButton :fav="f" small class="es-fav-corner" />
          </article>
        </template>
      </div>
    </template>

    <!-- series of the catalogs -->
    <template v-else>
      <p v-if="!favs.catalog.length" class="es-muted">{{ t('Ninguna serie de catálogos todavía: márcala con la estrella en su página del catálogo.') }}</p>
      <div v-else class="es-catalogs">
        <div v-for="f in favs.catalog" :key="f.key" class="es-catalog">
          <a href="#" class="es-catalog-open" @click.prevent="openCatalog(f.value)">
            <img v-if="img(f.value.image)" :src="img(f.value.image)" class="es-catalog-mark es-catalog-icon" alt="" loading="lazy" />
            <span v-else class="es-catalog-mark" aria-hidden="true">{{ f.value.title.slice(0, 1) }}</span>
            <span class="es-catalog-text">
              <strong>{{ f.value.title }}</strong>
              <span class="es-muted es-small">{{ catalogName(f.value.catalog!) }}</span>
            </span>
          </a>
          <FavoriteButton :fav="f" small />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { favoritesOf, useSync, type Favorite, type FavoriteType } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { netImageNow } from '../lib/netimages'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import FavoriteButton from './FavoriteButton.vue'
import ItemCard from './ItemCard.vue'

/** What was marked with the star: series of the shelf, single files and series of the catalogs. */
const store = useStore()
const { state, go } = store
useSync(store)

const TABS: { type: FavoriteType; label: string; icon: string }[] = [
  { type: 'series', label: 'Series', icon: 'es-i-grid' },
  { type: 'item', label: 'Archivos', icon: 'es-i-page' },
  { type: 'catalog', label: 'De catálogos', icon: 'es-i-cloud' },
]
const shown = ref<FavoriteType>('series')
const favs = computed(() => ({ series: favoritesOf('series'), item: favoritesOf('item'), catalog: favoritesOf('catalog') }))
// the tab with something in it, the first time
watch(favs, (f) => { if (!f[shown.value].length) shown.value = TABS.find((tab) => f[tab.type].length)?.type || shown.value }, { immediate: true })

const seriesOf = (name: string) => state.series.find((s) => s.series.toLowerCase() === name.toLowerCase())

// ---- the files, as they are now (their progress, their cover); found again by their path if they moved ids ----
const items = reactive<Record<string, Item | null>>({})
const missing = reactive<Record<string, string>>({})
async function find(key: string, fav: Favorite): Promise<Item | null> {
  try {
    const it = await store.api.item(fav.id!)
    if (key.startsWith('local:') || it.path === fav.path) return it
  } catch (_) { /* not with that id any more */ }
  if (!fav.path || key.startsWith('local:')) return null
  const name = fav.path.split('/').pop() || ''
  const found = await store.api.items({ q: name.replace(/\.[^.]+$/, ''), limit: 50 }).catch(() => [] as Item[])
  return found.find((i) => i.path === fav.path) || null
}
watch(() => [favs.value.item.map((f) => f.key).join('\n'), state.connected], async () => {
  if (!state.connected) return
  for (const f of favs.value.item) {
    if (items[f.key] || missing[f.key]) continue
    const it = await find(f.key, f.value)
    if (it) items[f.key] = it
    else missing[f.key] = state.server || f.key.startsWith('local:') ? t('Ya no está en tu estantería') : t('Está en tu servidor: conéctalo para verlo')
  }
}, { immediate: true })

// ---- series of the catalogs ----
const img = (url: string | null | undefined) => netImageNow(store.net, url)
const catalogName = (id: string) => store.catalogs?.get(id)?.name || id
function openCatalog(f: Favorite) {
  if (!store.catalogs?.get(f.catalog!)) { store.notify(t('Ese catálogo ya no está entre los tuyos: añádelo otra vez en Catálogos.'), true); return }
  go({ v: 'catalog', kind: f.catalog!, path: f.address })
}
</script>
