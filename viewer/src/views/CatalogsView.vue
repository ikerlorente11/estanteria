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
          <select v-model="how">
            <option value="ready">{{ t('Uno de los preparados') }}</option>
            <option value="repo">{{ t('Un repositorio de catálogos (su URL)') }}</option>
            <option value="opds">{{ t('Un catálogo OPDS (su URL)') }}</option>
          </select>
        </label>
        <template v-if="how === 'ready'">
          <label>{{ t('Catálogo') }}
            <select v-model="chosen" required>
              <option value="" disabled>{{ t('Elige uno…') }}</option>
              <optgroup v-for="g in reg.available()" :key="g.from" :label="g.from">
                <option v-for="c in g.catalogs" :key="c.id" :value="c.id">{{ c.name }} · {{ c.languages.map(languageName).join(', ') }}</option>
              </optgroup>
            </select>
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
            <select v-model="opds.language">
              <option v-for="(name, code) in LANGUAGE_NAMES" :key="code" :value="code">{{ languageName(String(code)) }}</option>
            </select>
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

      <div v-if="!reg.active.length && !suwayomis.length && !adding" class="es-empty es-home-empty">
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

    <!-- the web of a server: the server's catalogs -->
    <template v-else>
      <p class="es-muted es-intro">{{ t('Bibliotecas públicas a las que ya estás conectado. Entra, busca y guarda en tu estantería lo que te interese: se lee aquí mismo y, si quieres, se copia a {server}.', { server: serverLabel(store) }) }}</p>
      <p v-if="loading" class="es-muted"><span class="es-spin"></span> {{ t('Cargando…') }}</p>
      <div v-else class="es-catalogs">
        <a v-for="c in catalogs" :key="c.kind" href="#" class="es-catalog" @click.prevent="go({ v: 'catalog', kind: c.kind })">
          <span class="es-catalog-mark" :class="`es-catalog-${c.kind}`" aria-hidden="true">{{ c.label.slice(0, 1) }}</span>
          <span class="es-catalog-text">
            <strong>{{ c.label }}</strong>
            <span class="es-muted es-small">{{ c.description }}</span>
            <span v-if="c.items" class="es-origin"><i class="es-i es-i-bookmark-fill" aria-hidden="true"></i> {{ plural(c.items, '{n} guardado', '{n} guardados') }}</span>
          </span>
          <i class="es-i es-i-next es-catalog-go" aria-hidden="true"></i>
        </a>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { useSync } from '../lib/favorites'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Catalog } from '../lib/api'
import { CONTENT_NAMES, INCLUDED_CATALOGS, LANGUAGE_NAMES, languageName, type CatalogDef } from '../lib/catalogs'
import { plural, t } from '../lib/i18n'
import { browserNet } from '../lib/net'
import { prefs } from '../lib/prefs'
import { netImageNow } from '../lib/netimages'
import MultiPick from './MultiPick.vue'
import FollowsList from './FollowsList.vue'
import { isCollapsed, toggleCollapsed } from '../lib/collapse'
import { suwayomiHiddenCount, suwayomiLibraries, suwayomiSourcesOf, suwayomiVisibleSources } from '../lib/devicelibraries'
import { serverLabel, useStore } from '../lib/store'

/** The catalogs: in an app, the ones it reads by itself (add, filter by language, remove; repositories);
 * on the web of a server, that server's catalogs. */
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

// ---- the web of a server ----
const catalogs = ref<Catalog[]>([])
const loading = ref(true)
async function load() {
  if (reg || !state.connected || !state.server) return
  try { catalogs.value = await store.api.catalogs() } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
onMounted(() => { load(); loadSources() })
watch(() => state.connected, load)
</script>
