<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Catálogos') }}</h1>
      <span class="es-grow"></span>
      <button v-if="reg && !adding" class="es-btn es-primary" @click="startAdd"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Añadir catálogo') }}</button>
    </header>

    <!-- an app: the catalogs it reads by itself -->
    <template v-if="reg">
      <p class="es-muted es-intro">{{ t('Sitios que ofrecen libros, cómics y manga para leer. Usa los que quieras a la vez: añade más o quítalos cuando quieras.') }}</p>

      <form v-if="adding" class="es-form es-addcatalog" @submit.prevent="addChosen">
        <label>{{ t('Cómo') }}
          <Pick v-model="how" field :options="[{ value: 'ready', label: t('Uno de los preparados') }, { value: 'repo', label: t('Un repositorio de catálogos (su URL)') }, { value: 'opds', label: t('Un catálogo OPDS (su URL)') }]" />
        </label>
        <template v-if="how === 'ready'">
          <label>{{ t('Catálogo') }}
            <Pick v-model="chosen" field :placeholder="t('Elige uno…')"
                  :options="reg.available().flatMap((g) => g.catalogs.map((c) => ({ value: c.id, label: `${c.name} · ${c.languages.map(languageName).join(', ')}`, group: g.from })))" />
          </label>
          <p v-if="chosenDef?.description" class="es-muted es-small">{{ t(chosenDef.description) }}</p>
          <p v-if="!reg.available().length" class="es-muted es-small">{{ t('Ya tienes todos los preparados. Añade un repositorio para tener más.') }}</p>
        </template>
        <template v-else-if="how === 'repo'">
          <p class="es-muted es-small"><template v-for="(part, i) in t('Un repositorio es una lista de catálogos (un archivo {file}) que alguien publica. Sus catálogos aparecen entre los preparados para que actives los que quieras.').split('{file}')" :key="i"><code v-if="i">index.json</code>{{ part }}</template></p>
          <label>{{ t('Dirección del repositorio') }} <input v-model="repoUrl" type="url" required :placeholder="t('https://ejemplo.com/catalogos/index.json')" /></label>
        </template>
        <template v-else>
          <p class="es-muted es-small">{{ t('Cualquier catálogo OPDS 1.2 o 2.0 público.') }}</p>
          <label>{{ t('Dirección') }} <input v-model="opds.url" type="url" required :placeholder="t('https://ejemplo.com/opds')" /></label>
          <label>{{ t('Nombre') }} <input v-model="opds.name" type="text" maxlength="80" :placeholder="t('Cómo quieres llamarlo')" /></label>
          <label>{{ t('Idioma') }}
            <Pick v-model="opds.language" field :options="Object.keys(LANGUAGE_NAMES).map((code) => ({ value: code, label: languageName(code) }))" />
          </label>
        </template>
        <div class="es-form-actions">
          <button class="es-btn es-primary" type="submit" :disabled="working"><span v-if="working" class="es-spin"></span> {{ how === 'repo' ? t('Añadir repositorio') : t('Añadir') }}</button>
          <button class="es-btn" type="button" @click="adding = false">{{ t('Cancelar') }}</button>
        </div>
      </form>

      <div v-if="langOptions.length > 1" class="es-langs">
        <MultiPick v-model="langs" :options="langOptions" :label="t('Idiomas')" empty-means-all
                   :title="t('Ver solo los catálogos y fuentes de estos idiomas')" />
      </div>

      <div v-if="shown.length" class="es-catalogs">
        <div v-for="c in shown" :key="c.id" class="es-catalog">
          <a href="#" class="es-catalog-open" @click.prevent="go({ v: 'catalog', kind: c.id })">
            <span class="es-catalog-mark" aria-hidden="true">{{ c.name.slice(0, 1) }}</span>
            <span class="es-catalog-text">
              <strong>{{ c.name }}</strong>
              <span class="es-muted es-small">{{ c.description ? t(c.description) : c.url }}</span>
              <span class="es-origin">{{ c.content.map((k) => t(CONTENT_NAMES[k])).join(' · ') }} · {{ c.languages.map(languageName).join(', ') }}</span>
            </span>
          </a>
          <button class="es-btn es-small es-catalog-remove" :title="t('Quitar {name}', { name: c.name })" @click="remove(c)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
        </div>
      </div>
      <!-- the libraries connected in «Bibliotecas» that are read as catalogs: a Komga, a Kavita, an OPDS, a WebDAV folder -->
      <template v-if="libs.length">
        <header class="es-page-head es-subhead">
          <button class="es-collapse" :aria-expanded="!isCollapsed('libraries')" @click="toggleCollapsed('libraries')">
            <i class="es-i es-i-chevron" :class="{ 'es-collapse-closed': isCollapsed('libraries') }" aria-hidden="true"></i>
            <h2 class="es-h2">{{ t('Tus bibliotecas') }}</h2>
            <span class="es-chip-count">{{ libs.length }}</span>
          </button>
          <span class="es-grow"></span>
          <button class="es-btn es-small" @click="go({ v: 'sources' })"><i class="es-i es-i-settings" aria-hidden="true"></i> {{ t('Bibliotecas') }}</button>
        </header>
        <div v-if="!isCollapsed('libraries')" class="es-catalogs">
          <a v-for="l in libs" :key="l.id" href="#" class="es-catalog" @click.prevent="go({ v: 'catalog', kind: `lib:${l.id}` })">
            <span class="es-catalog-mark" aria-hidden="true"><i class="es-i es-i-server"></i></span>
            <span class="es-catalog-text">
              <strong>{{ l.name }}</strong>
              <span class="es-muted es-small es-ellipsis">{{ l.url }}</span>
              <span class="es-origin">{{ t(LIBRARY_TYPES[l.type].label) }}</span>
            </span>
            <i class="es-i es-i-next es-catalog-go" aria-hidden="true"></i>
          </a>
        </div>
      </template>

      <!-- the sources of each Suwayomi library: its installed extensions, every one a catalog -->
      <template v-for="s in suwayomis" :key="s.id">
        <header class="es-page-head es-subhead">
          <button class="es-collapse" :aria-expanded="!isCollapsed(`suwayomi:${s.id}`)" @click="toggleCollapsed(`suwayomi:${s.id}`)">
            <i class="es-i es-i-chevron" :class="{ 'es-collapse-closed': isCollapsed(`suwayomi:${s.id}`) }" aria-hidden="true"></i>
            <h2 class="es-h2">{{ t('Fuentes de {name}', { name: s.name }) }}</h2>
            <span class="es-chip-count">{{ sourcesShown(s.id).length }}</span>
          </button>
          <span class="es-grow"></span>
          <button class="es-btn es-small" @click="go({ v: 'extensions', library: s.id })"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Extensiones') }}</button>
        </header>
        <template v-if="!isCollapsed(`suwayomi:${s.id}`)">
        <p v-if="suwayomiHiddenCount(s.id)" class="es-muted es-small">
          {{ plural(suwayomiHiddenCount(s.id), '{n} fuente oculta (un idioma que no te interesa…).', '{n} fuentes ocultas (idiomas que no te interesan…).') }}
          <a href="#" @click.prevent="go({ v: 'extensions', library: s.id })">{{ t('Elegir cuáles se ven') }}</a>
        </p>
        <div v-if="sourcesShown(s.id).length" class="es-catalogs">
          <a v-for="src in sourcesShown(s.id)" :key="src.id" href="#" class="es-catalog" @click.prevent="go({ v: 'catalog', kind: `suwayomi:${s.id}:${src.id}` })">
            <img v-if="img(src.iconUrl)" :src="img(src.iconUrl)" class="es-catalog-mark es-catalog-icon" alt="" loading="lazy" />
            <span v-else class="es-catalog-mark" aria-hidden="true">{{ src.displayName.slice(0, 1) }}</span>
            <span class="es-catalog-text">
              <strong>{{ src.name }} <small v-if="src.isNsfw" class="es-ext-nsfw">+18</small></strong>
              <span class="es-origin">{{ t('Manga') }} · {{ languageName(src.lang === 'all' ? 'multi' : src.lang) }}</span>
            </span>
            <i class="es-i es-i-next es-catalog-go" aria-hidden="true"></i>
          </a>
        </div>
        <p v-else-if="sourceErrors[s.id]" class="es-banner es-banner-error">{{ sourceErrors[s.id] }}</p>
        <p v-else class="es-muted">{{ t('Ninguna fuente todavía: instala extensiones.') }}</p>
        </template>
      </template>

      <div v-if="!reg.active.length && !suwayomis.length && !libs.length && !adding" class="es-empty es-home-empty">
        <span class="es-empty-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <p><strong>{{ t('Aún no tienes catálogos.') }}</strong></p>
        <p class="es-muted">{{ t('Añade alguno de los preparados (Project Gutenberg, textos.info, MangaDex…), un repositorio o un catálogo OPDS.') }}</p>
        <div class="es-empty-actions"><button class="es-btn es-primary" @click="startAdd"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Añadir catálogo') }}</button></div>
      </div>

      <template v-if="reg.repos.length">
        <h2 class="es-h2 es-subhead">{{ t('Repositorios') }}</h2>
        <ul class="es-sources">
          <li v-for="r in reg.repos" :key="r.url" class="es-source">
            <span class="es-source-icon"><i class="es-i es-i-list" aria-hidden="true"></i></span>
            <span class="es-source-text">
              <strong>{{ r.name }}</strong>
              <small class="es-muted es-ellipsis">{{ r.url }}</small>
              <small class="es-muted">{{ plural(r.catalogs.length, '{n} catálogo', '{n} catálogos') }}</small>
            </span>
            <span class="es-source-actions">
              <button class="es-btn es-small" :title="t('Leerlo otra vez')" :disabled="working" @click="refreshRepo(r.url)"><i class="es-i es-i-refresh" aria-hidden="true"></i></button>
              <button class="es-btn es-small" :title="t('Quitar el repositorio (los catálogos que activaste se quedan)')" @click="reg.removeRepo(r.url)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
            </span>
          </li>
        </ul>
      </template>
      <!-- the series followed: their new chapters come by themselves (with a server of one's own) -->
      <FollowsList />
    </template>

  </section>
</template>

<script setup lang="ts">
import Pick from './Pick.vue'
import { useSync } from '../lib/favorites'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { CONTENT_NAMES, INCLUDED_CATALOGS, LANGUAGE_NAMES, languageName, type CatalogDef } from '../lib/catalogs'
import { plural, t } from '../lib/i18n'
import { browserNet } from '../lib/net'
import { prefs } from '../lib/prefs'
import { netImageNow } from '../lib/netimages'
import MultiPick from './MultiPick.vue'
import FollowsList from './FollowsList.vue'
import { isCollapsed, toggleCollapsed } from '../lib/collapse'
import { LIBRARY_TYPES } from '../lib/libraries'
import { catalogLibraries, suwayomiHiddenCount, suwayomiLibraries, suwayomiSourcesOf, suwayomiVisibleSources } from '../lib/devicelibraries'
import { serverLabel, useStore } from '../lib/store'

/** The catalogs: in an app, the ones it reads by itself (add, filter by language, remove; repositories);
 * the same on the web of a server, through its network. */
const store = useStore()
// what is shared with the other devices, kept in step from the first page (see sync.ts)
useSync(store)
const { state, go } = store
const reg = store.catalogs || null

// ---- an app's catalogs ----
const adding = ref(false)
const working = ref(false)
const how = ref<'ready' | 'repo' | 'opds'>('ready')
const chosen = ref('')
const repoUrl = ref('')
const opds = reactive({ url: '', name: '', language: 'es' })
/** the languages to choose from (one «in many languages» shows with any), by their names */
const langOptions = computed(() => languages.value.filter((l) => l !== 'multi').map((l) => ({ value: l, label: languageName(l) })).sort((a, b) => a.label.localeCompare(b.label)))
/** the languages chosen to see (none: all), kept with the person's settings */
const LANGS_KEY = 'estanteria.catalogs.langs'
const langs = ref<string[]>((() => { try { return JSON.parse(prefs.get(LANGS_KEY) || '[]') } catch (_) { return [] } })())
watch(langs, (v) => prefs.set(LANGS_KEY, JSON.stringify(v)))
/** a catalog «in many languages» shows with any choice */
const seen = (l: string) => !langs.value.length || l === 'all' || l === 'multi' || langs.value.includes(l)
const allDefs = computed(() => [...INCLUDED_CATALOGS, ...(reg?.repos.flatMap((r) => r.catalogs) || [])])
const chosenDef = computed(() => allDefs.value.find((c) => c.id === chosen.value))
const languages = computed(() => [...new Set([...(reg?.active || []).flatMap((c) => c.languages), ...suwayomis.value.flatMap((s) => suwayomiVisibleSources(s.id).map((src) => (src.lang === 'all' ? 'multi' : src.lang)))])].sort((a, b) => (a === 'multi' ? 1 : b === 'multi' ? -1 : a.localeCompare(b))))
/** a catalog «in many languages» shows under each one */
// ---- the Suwayomi libraries: their sources ----
const suwayomis = computed(() => (reg ? suwayomiLibraries() : []))
const libs = computed(() => (reg ? catalogLibraries() : []))
const sourceErrors = reactive<Record<string, string>>({})
const img = (url: string) => netImageNow(store.net, url)
function sourcesShown(id: string) {
  return suwayomiVisibleSources(id).filter((s) => seen(s.lang))
    .sort((a, b) => a.name.localeCompare(b.name))
}
async function loadSources() {
  for (const s of suwayomis.value) {
    try { await suwayomiSourcesOf(store.net || browserNet, s.id, true); delete sourceErrors[s.id] } catch (err: any) { sourceErrors[s.id] = err?.message || String(err) }
  }
}
const shown = computed(() => (reg?.active || []).filter((c) => c.languages.some(seen)))

function startAdd() {
  how.value = reg!.available().length ? 'ready' : 'repo'
  chosen.value = ''
  repoUrl.value = ''
  Object.assign(opds, { url: '', name: '', language: 'es' })
  adding.value = true
}
async function addChosen() {
  working.value = true
  try {
    if (how.value === 'ready') {
      const def = chosenDef.value
      if (!def) throw new Error(t('Elige un catálogo.'))
      reg!.add(def)
      store.notify(t('«{name}» añadido.', { name: def.name }))
      adding.value = false
    } else if (how.value === 'repo') {
      const repo = await reg!.addRepo(store.net || browserNet, repoUrl.value.trim())
      store.notify(plural(repo.catalogs.length, 'Repositorio «{name}»: {n} catálogo para elegir.', 'Repositorio «{name}»: {n} catálogos para elegir.', { name: repo.name }))
      how.value = 'ready'
      chosen.value = ''
    } else {
      const def = reg!.addOpds(opds.url.trim(), opds.name.trim(), opds.language)
      store.notify(t('«{name}» añadido.', { name: def.name }))
      adding.value = false
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}
async function refreshRepo(url: string) {
  working.value = true
  try { await reg!.addRepo(store.net || browserNet, url); store.notify(t('Repositorio al día.')) } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}
function remove(c: CatalogDef) {
  if (!window.confirm(t('¿Quitar «{name}»? Lo que descargaste de él se queda en tu estantería.', { name: c.name }))) return
  reg!.remove(c.id)
}

onMounted(loadSources)
// the libraries may come later (the web: from the server): their sources asked when they do
watch(() => suwayomis.value.map((s) => s.id).join(','), (now, before) => { if (now && now !== before) loadSources() })
</script>
