<template>
  <section class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p class="es-muted es-small es-crumbs"><a href="#" @click.prevent="store.go({ v: 'sources' })">{{ t('Bibliotecas') }}</a> › {{ lib?.name || 'Suwayomi' }}</p>
        <h1 class="es-h1">{{ t('Extensiones') }}</h1>
      </div>
      <span class="es-grow"></span>
      <button class="es-btn" :disabled="loading" :title="t('Volver a leer los repositorios')" @click="load(true)">
        <span v-if="loading" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i> {{ t('Buscar actualizaciones') }}
      </button>
    </header>

    <p v-if="!server" class="es-banner es-banner-error">{{ t('Ese servidor Suwayomi ya no está entre tus bibliotecas.') }}</p>
    <template v-else>
      <p class="es-muted">{{ t('Las extensiones se instalan en tu servidor Suwayomi; sus fuentes salen en Catálogos, en todos tus dispositivos.') }}</p>
      <div v-if="installedCount" class="es-banner es-ext-read">
        <span>{{ plural(installedCount, 'Tienes {n} extensión instalada: sus mangas se leen desde Catálogos.', 'Tienes {n} extensiones instaladas: sus mangas se leen desde Catálogos.') }}</span>
        <button class="es-btn es-primary es-small" @click="store.go({ v: 'catalogs' })"><i class="es-i es-i-cloud" aria-hidden="true"></i> {{ t('Ir a Catálogos') }}</button>
      </div>

      <!-- the repositories the server reads -->
      <details class="es-ext-repos">
        <summary>{{ plural(stores.length, '{n} repositorio', '{n} repositorios') }}</summary>
        <ul class="es-sources">
          <li v-for="r in stores" :key="r.indexUrl" class="es-source">
            <span class="es-source-icon"><i class="es-i es-i-list" aria-hidden="true"></i></span>
            <span class="es-source-text"><strong>{{ r.name }}</strong><small class="es-muted es-ellipsis">{{ r.indexUrl }}</small></span>
            <span class="es-source-actions"><button class="es-btn es-small" :title="t('Quitar')" :disabled="busy !== ''" @click="removeStore(r.indexUrl)"><i class="es-i es-i-delete" aria-hidden="true"></i></button></span>
          </li>
        </ul>
        <form class="es-ext-addrepo" @submit.prevent="addStore">
          <input v-model="newStore" class="es-search" type="url" required :placeholder="t('URL de un repositorio de Mihon (index.min.json)')" />
          <button class="es-btn" type="submit" :disabled="busy !== ''">{{ t('Añadir') }}</button>
        </form>
      </details>

      <div class="es-filters">
        <div class="es-seg" role="tablist">
          <button class="es-seg-btn" :class="{ on: show === 'installed' }" @click="show = 'installed'">{{ t('Instaladas') }} ({{ installedCount }})</button>
          <button class="es-seg-btn" :class="{ on: show === 'all' }" @click="show = 'all'">{{ t('Todas') }}</button>
        </div>
        <select class="es-select" :value="lang" :aria-label="t('Idioma')" @change="lang = ($event.target as HTMLSelectElement).value">
          <option value="">{{ t('Todos los idiomas') }}</option>
          <option v-for="l in languages" :key="l" :value="l">{{ languageName(l) }}</option>
        </select>
        <span class="es-grow"></span>
        <input v-model="q" class="es-search" type="search" :placeholder="t('Buscar extensión')" :aria-label="t('Buscar')" />
      </div>

      <p v-if="loading && !extensions.length" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
      <p v-else-if="error" class="es-banner es-banner-error">{{ error }}</p>
      <ul v-else class="es-sources es-extensions">
        <template v-for="e in shown" :key="e.pkgName">
        <li class="es-source">
          <img v-if="img(e.iconUrl)" :src="img(e.iconUrl)" class="es-ext-icon" alt="" loading="lazy" />
          <span v-else class="es-source-icon"><i class="es-i es-i-pages" aria-hidden="true"></i></span>
          <span class="es-source-text">
            <strong>{{ e.name.replace(/^Tachiyomi: /, '') }} <small v-if="e.isNsfw" class="es-ext-nsfw">+18</small></strong>
            <small class="es-muted">{{ languageName(e.lang) }} · {{ e.versionName }}<template v-if="e.isObsolete"> · {{ t('obsoleta') }}</template></small>
          </span>
          <span class="es-source-actions">
            <button v-if="e.hasUpdate" class="es-btn es-small es-primary" :disabled="busy !== ''" @click="act(e, 'update')"><span v-if="busy === e.pkgName" class="es-spin"></span> {{ t('Poner al día') }}</button>
            <button v-if="!e.isInstalled" class="es-btn es-small" :disabled="busy !== ''" @click="act(e, 'install')"><span v-if="busy === e.pkgName" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i> {{ t('Instalar') }}</button>
            <!-- one with a source per language (MangaDex…): which of them show in Catálogos -->
            <MultiPick v-if="e.isInstalled && sourcesOf(e).length > 1" end :label="t('Idiomas')" :title="t('Los idiomas de esta extensión que se ven en Catálogos')"
                       :options="sourcesOf(e).map((x) => ({ value: x.id, label: langOf(x) }))" :model-value="visibleOf(e)" @update:model-value="(ids) => showOnly(e, ids)" />
            <button v-if="e.isInstalled" class="es-btn es-small" :disabled="busy !== ''" :title="t('Quitar')" @click="act(e, 'uninstall')"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
          </span>
        </li>
        </template>
        <li v-if="!shown.length" class="es-source es-muted">{{ show === 'installed' ? t('Ninguna instalada todavía: mira en «Todas».') : t('Nada con esos filtros.') }}</li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { languageName } from '../lib/catalogs'
import { setSuwayomiHidden, suwayomiHidden, suwayomiServer, suwayomiSourcesNow, suwayomiSourcesOf } from '../lib/devicelibraries'
import { language, plural, t } from '../lib/i18n'
import { browserNet } from '../lib/net'
import { netImageNow } from '../lib/netimages'
import { useStore } from '../lib/store'
import MultiPick from './MultiPick.vue'
import type { SuwayomiSource } from '../lib/suwayomi'
import { suwayomiAddStore, suwayomiExtension, suwayomiExtensions, suwayomiRemoveStore, suwayomiStores, type SuwayomiExtension, type SuwayomiStore } from '../lib/suwayomi'

/** The extensions of a Suwayomi library (Mihon's): install, update or remove them, and the repositories
 * they come from. Their sources show in «Catálogos». */
const props = defineProps<{ library: string }>()
const store = useStore()
const net = store.net || browserNet
const server = suwayomiServer(props.library)
const lib = computed(() => store.libraries?.list.value.find((l) => l.id === props.library))
const extensions = ref<SuwayomiExtension[]>([])
const stores = ref<SuwayomiStore[]>([])
const loading = ref(false)
const error = ref('')
const busy = ref('')
const show = ref<'installed' | 'all'>('installed')
const lang = ref('')
const q = ref('')
const newStore = ref('')

const img = (url: string) => netImageNow(store.net, url)
const installedCount = computed(() => extensions.value.filter((e) => e.isInstalled).length)
const languages = computed(() => [...new Set(extensions.value.map((e) => e.lang))].sort((a, b) => languageName(a).localeCompare(languageName(b))))
const shown = computed(() => {
  const text = q.value.trim().toLowerCase()
  return extensions.value
    .filter((e) => (show.value === 'all' || e.isInstalled) && (!lang.value || e.lang === lang.value) && (!text || e.name.toLowerCase().includes(text)))
    .sort((a, b) => Number(b.hasUpdate) - Number(a.hasUpdate) || a.name.localeCompare(b.name))
})

/** the sources an installed extension brings (one per language, for some), by language name */
function sourcesOf(e: SuwayomiExtension): SuwayomiSource[] {
  return suwayomiSourcesNow(props.library).filter((x) => x.pkgName === e.pkgName).sort((a, b) => langOf(a).localeCompare(langOf(b)))
}
const langOf = (x: SuwayomiSource) => languageName(x.lang === 'all' ? 'multi' : x.lang)
const visibleOf = (e: SuwayomiExtension) => sourcesOf(e).filter((x) => !suwayomiHidden(props.library, x.id)).map((x) => x.id)
function showOnly(e: SuwayomiExtension, ids: string[]) {
  const all = sourcesOf(e).map((x) => x.id)
  setSuwayomiHidden(props.library, all.filter((id) => !ids.includes(id)), true)
  setSuwayomiHidden(props.library, ids, false)
}
/** Just installed with many languages: only the app's and English show (and the one «in many languages»);
 * the rest can be turned on below it. */
function keepFewLanguages(e: SuwayomiExtension): string {
  const all = sourcesOf(e)
  if (all.length <= 2) return ''
  const keep = new Set(['all', 'multi', language.value, 'en'])
  const off = all.filter((x) => !keep.has(x.lang.toLowerCase().split('-')[0]))
  if (!off.length || off.length === all.length) return ''
  setSuwayomiHidden(props.library, off.map((x) => x.id), true)
  return t('Trae {n} idiomas: se ven {shown}; cambia cuáles en «Idiomas», junto a la extensión.', { n: all.length, shown: all.filter((x) => !off.includes(x)).map(langOf).join(', ') })
}

async function load(refresh = false) {
  if (!server) return
  loading.value = true
  error.value = ''
  try {
    const [ext, st] = await Promise.all([suwayomiExtensions(net, server, refresh), suwayomiStores(net, server)])
    extensions.value = ext
    stores.value = st
    if (!ext.length && !refresh) extensions.value = await suwayomiExtensions(net, server, true)
  } catch (err: any) { error.value = err?.message || String(err) }
  loading.value = false
}
async function act(e: SuwayomiExtension, what: 'install' | 'update' | 'uninstall') {
  if (!server) return
  busy.value = e.pkgName
  try {
    const got = await suwayomiExtension(net, server, e.pkgName, what)
    if (got) extensions.value = extensions.value.map((x) => (x.pkgName === e.pkgName ? { ...got, iconUrl: x.iconUrl } : x))
    await suwayomiSourcesOf(net, props.library, true).catch(() => [])
    const few = what === 'install' ? keepFewLanguages(e) : ''
    store.notify(what === 'install' ? `${t('«{name}» instalada: sus fuentes ya están en Catálogos.', { name: e.name.replace(/^Tachiyomi: /, '') })}${few ? ` ${few}` : ''}`
      : what === 'update' ? t('«{name}» actualizada.', { name: e.name.replace(/^Tachiyomi: /, '') }) : t('«{name}» quitada.', { name: e.name.replace(/^Tachiyomi: /, '') }))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = ''
}
async function addStore() {
  if (!server) return
  busy.value = 'store'
  try {
    const added = await suwayomiAddStore(net, server, newStore.value.trim())
    newStore.value = ''
    store.notify(t('Repositorio «{name}» añadido.', { name: added?.name || '' }))
    await load(true)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = ''
}
async function removeStore(url: string) {
  if (!server || !window.confirm(t('¿Quitar este repositorio? Las extensiones instaladas se quedan.'))) return
  busy.value = 'store'
  try { await suwayomiRemoveStore(net, server, url); await load(true) } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = ''
}
onMounted(() => { load(); suwayomiSourcesOf(net, props.library, true).catch(() => []) })
</script>
