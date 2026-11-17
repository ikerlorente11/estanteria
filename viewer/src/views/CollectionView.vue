<template>
  <section class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p class="es-muted es-small es-crumbs"><a href="#" @click.prevent="go({ v: 'collections' })">{{ t('Colecciones') }}</a></p>
        <h1 v-if="!renaming" class="es-h1">{{ info?.name || t('Colección') }}</h1>
        <form v-else class="es-col-new" @submit.prevent="rename">
          <input ref="field" v-model="newName" type="text" maxlength="80" :aria-label="t('Nombre')" />
          <button class="es-btn es-small es-primary" type="submit" :disabled="!newName.trim()">{{ t('Guardar') }}</button>
          <button class="es-btn es-small" type="button" @click="renaming = false">{{ t('Cancelar') }}</button>
        </form>
      </div>
      <span class="es-grow"></span>
      <template v-if="info && !renaming">
        <button class="es-btn es-small" :title="t('Cambiar el nombre')" @click="startRename"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
        <button class="es-btn es-small" :title="t('Borrar la colección')" @click="remove"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
      </template>
    </header>

    <p v-if="!info" class="es-muted">{{ t('Esa colección ya no existe.') }}</p>
    <p v-else-if="!members.length" class="es-muted">{{ t('Vacía: añade cosas con el botón de colección de su ficha, de una serie o de una serie de un catálogo.') }}</p>

    <!-- series of the shelf -->
    <template v-if="groups.series.length">
      <h2 class="es-h2">{{ t('Series') }}</h2>
      <div class="es-grid">
        <article v-for="m in groups.series" :key="m.key" class="es-card">
          <a href="#" class="es-card-cover" :title="m.value.title" @click.prevent="go({ v: 'series', name: m.value.series! })">
            <Cover v-if="seriesOf(m.value.series!)" :id="seriesOf(m.value.series!)!.cover_item" :has="seriesOf(m.value.series!)!.cover" />
            <span v-else class="es-cover-box"><span class="es-cover-none"><i class="es-i es-i-grid" aria-hidden="true"></i></span></span>
          </a>
          <div class="es-card-text">
            <a href="#" class="es-card-title es-ellipsis" :title="m.value.title" @click.prevent="go({ v: 'series', name: m.value.series! })">{{ m.value.title }}</a>
            <span class="es-muted es-small es-ellipsis">
              <template v-if="seriesOf(m.value.series!)">{{ plural(seriesOf(m.value.series!)!.items, '{n} número', '{n} números') }}</template>
              <template v-else>{{ t('No está en tu estantería ahora') }}</template>
            </span>
          </div>
          <button class="es-btn es-small es-fav-corner" :title="t('Quitar de la colección')" @click="takeOut(m)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
        </article>
      </div>
    </template>

    <!-- single files -->
    <template v-if="groups.item.length">
      <h2 class="es-h2">{{ t('Archivos') }}</h2>
      <div class="es-grid">
        <template v-for="m in groups.item" :key="m.key">
          <div v-if="items[m.key]" class="es-fav-wrap">
            <ItemCard :item="items[m.key]!" @read="store.read(items[m.key]!)" @open="go({ v: 'item', id: items[m.key]!.id })" />
            <button class="es-btn es-small es-fav-corner" :title="t('Quitar de la colección')" @click="takeOut(m)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </div>
          <article v-else class="es-card">
            <span class="es-card-cover"><span class="es-cover-box"><span class="es-cover-none">
              <span v-if="missing[m.key] === undefined" class="es-spin"></span><i v-else class="es-i es-i-page" aria-hidden="true"></i>
            </span></span></span>
            <div class="es-card-text">
              <span class="es-card-title es-ellipsis" :title="m.value.title">{{ m.value.title }}</span>
              <span v-if="missing[m.key]" class="es-muted es-small">{{ missing[m.key] }}</span>
            </div>
            <button class="es-btn es-small es-fav-corner" :title="t('Quitar de la colección')" @click="takeOut(m)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
          </article>
        </template>
      </div>
    </template>

    <!-- series of the catalogs -->
    <template v-if="groups.catalog.length">
      <h2 class="es-h2">{{ t('De catálogos') }}</h2>
      <div class="es-catalogs">
        <div v-for="m in groups.catalog" :key="m.key" class="es-catalog">
          <a href="#" class="es-catalog-open" @click.prevent="openCatalog(m.value)">
            <img v-if="img(m.value.image)" :src="img(m.value.image)" class="es-catalog-mark es-catalog-icon" alt="" loading="lazy" />
            <span v-else class="es-catalog-mark" aria-hidden="true">{{ m.value.title.slice(0, 1) }}</span>
            <span class="es-catalog-text">
              <strong>{{ m.value.title }}</strong>
              <span class="es-muted es-small">{{ catalogName(m.value.catalog!) }}</span>
            </span>
          </a>
          <button class="es-btn es-small" :title="t('Quitar de la colección')" @click="takeOut(m)"><i class="es-i es-i-close" aria-hidden="true"></i></button>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { collection, deleteCollection, membersOf, renameCollection, setInCollection, type Member } from '../lib/collections'
import { findMarkedItem, useSync, type Favorite } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { netImageNow } from '../lib/netimages'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'
import ItemCard from './ItemCard.vue'

/** A collection: what is in it (series, files, series of catalogs), each to open or take out; its name to change. */
const props = defineProps<{ id: string }>()
const store = useStore()
const { state, go } = store
useSync(store)

const info = computed(() => collection(props.id))
const members = computed(() => membersOf(props.id))
const groups = computed(() => ({
  series: members.value.filter((m) => m.value.type === 'series'),
  item: members.value.filter((m) => m.value.type === 'item'),
  catalog: members.value.filter((m) => m.value.type === 'catalog'),
}))
const seriesOf = (name: string) => state.series.find((s) => s.series.toLowerCase() === name.toLowerCase())

function takeOut(m: Member) {
  setInCollection(props.id, m, false)
  store.notify(t('Quitado de «{name}».', { name: info.value?.name || '' }))
}

// ---- its name ----
const renaming = ref(false)
const newName = ref('')
const field = ref<HTMLInputElement | null>(null)
function startRename() {
  newName.value = info.value?.name || ''
  renaming.value = true
  void nextTick(() => field.value?.select())
}
function rename() {
  renameCollection(props.id, newName.value)
  renaming.value = false
}
function remove() {
  if (!info.value) return
  if (!window.confirm(t('¿Borrar la colección «{name}»? Lo que tiene se queda donde está; solo deja de estar agrupado.', { name: info.value.name }))) return
  const name = info.value.name
  deleteCollection(props.id)
  store.notify(t('«{name}» borrada.', { name }))
  go({ v: 'collections' }, true)
}

// ---- the files, as they are now (found again by their path if their id changed) ----
const items = reactive<Record<string, Item | null>>({})
const missing = reactive<Record<string, string>>({})
watch(() => [groups.value.item.map((m) => m.key).join('\n'), state.connected], async () => {
  if (!state.connected) return
  for (const m of groups.value.item) {
    if (items[m.key] || missing[m.key]) continue
    const it = await findMarkedItem(store.api, m.key, m.value)
    if (it) items[m.key] = it
    else missing[m.key] = state.server || m.key.startsWith('local:') ? t('Ya no está en tu estantería') : t('Está en tu servidor: conéctalo para verlo')
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
