<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Bibliotecas') }}</h1>
      <span class="es-grow"></span>
      <button v-if="!adding && (store.libraries || state.server)" class="es-btn es-primary" @click="startAdd"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Añadir biblioteca') }}</button>
    </header>
    <p v-if="store.libraries" class="es-muted">{{ t('Tus servidores (un servidor propio, Komga, Kavita…): conéctate con su dirección y tus credenciales y lo que tienen aparece en tu estantería. Puedes tener varios a la vez.') }}</p>
    <p v-else-if="state.server" class="es-muted">{{ t('{server} lee la carpeta «{folder}» de tu nube. Añade bibliotecas de otros (un Komga, un Kavita, un catálogo OPDS, una carpeta WebDAV) y sus cómics y libros aparecen junto a los tuyos, con el progreso guardado allí cuando el servidor lo permite.', { server: serverLabel(store), folder: store.readingRoot }) }}</p>

    <!-- an app: a library it connects by itself -->
    <form v-if="adding && store.libraries" class="es-form" @submit.prevent="saveLibrary">
      <label>{{ t('Tipo') }}
        <select v-model="lib.type" :disabled="!!lib.id">
          <option v-for="ty in store.libraries.types" :key="ty" :value="ty">{{ t(LIBRARY_TYPES[ty].label) }}</option>
        </select>
      </label>
      <p class="es-muted es-small">{{ t(libInfo.hint) }}</p>
      <label>{{ t('Nombre') }} <input v-model="lib.name" type="text" maxlength="120" :placeholder="lib.url ? nameFromUrl(lib.url) : t('Cómo quieres llamarla')" /></label>
      <label>{{ t('Dirección') }} <input v-model="lib.url" type="url" required :placeholder="t(libInfo.example)" /></label>
      <label v-if="libInfo.username">{{ t('Usuario') }} <input v-model="lib.username" type="text" autocomplete="off" autocapitalize="none" /></label>
      <label>{{ t(libInfo.secretLabel) }} <input v-model="lib.secret" type="password" autocomplete="new-password" :placeholder="lib.id ? t('(sin cambios)') : ''" /></label>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ lib.id ? t('Guardar') : t('Conectar y añadir') }}</button>
        <button class="es-btn" type="button" @click="adding = false">Cancelar</button>
      </div>
    </form>

    <!-- the web of a server: a library the server connects -->
    <form v-if="adding && !store.libraries && state.server" class="es-form" @submit.prevent="save">
      <label>{{ t('Tipo') }}
        <select v-model="form.kind">
          <option v-for="k in kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
        </select>
      </label>
      <p v-if="hint" class="es-muted es-small">{{ hint }}</p>
      <label>{{ t('Nombre') }} <input v-model="form.name" type="text" required maxlength="120" :placeholder="t('Komga de Ana')" /></label>
      <label>{{ t('Dirección') }} <input v-model="form.url" type="url" required :placeholder="t('https://komga.ejemplo.com')" /></label>
      <label v-if="kindInfo?.fields.includes('username')">{{ t('Usuario') }} <input v-model="form.username" type="text" autocomplete="off" /></label>
      <label v-if="kindInfo?.fields.includes('secret')">{{ kindInfo?.secret_label || t('Contraseña') }} <input v-model="form.secret" type="password" autocomplete="new-password" :placeholder="editing ? t('(sin cambios)') : ''" /></label>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ editing ? t('Guardar') : t('Conectar y añadir') }}</button>
        <button class="es-btn" type="button" @click="adding = false">Cancelar</button>
      </div>
    </form>

    <!-- an app: the libraries it is connected to -->
    <ul v-if="store.libraries" class="es-sources">
      <li v-for="l in store.libraries.list.value" :key="l.id" class="es-source">
        <span class="es-source-icon"><i class="es-i" :class="l.type === 'server' ? 'es-i-cloud' : 'es-i-server'" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ l.name }} <small class="es-muted">{{ t(LIBRARY_TYPES[l.type].label) }}</small></strong>
          <small class="es-muted es-ellipsis">{{ l.url }}<template v-if="l.username"> · {{ l.username }}</template></small>
          <small v-if="l.error" class="es-source-bad">{{ l.error }}</small>
          <small v-else-if="l.type === 'server' && state.server && state.status" class="es-muted">{{ plural(state.status.archivador.total, '{n} elemento', '{n} elementos') }}<template v-if="state.status.archivador.pending"> · {{ t('{n} abriéndose', { n: state.status.archivador.pending }) }}</template></small>
        </span>
        <span class="es-source-actions">
          <a v-if="l.type === 'server' && state.server" href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: 'archivador' })">{{ t('Ver') }}</a>
          <a v-if="l.type === 'suwayomi'" href="#" class="es-btn es-small" @click.prevent="go({ v: 'extensions', library: l.id })">{{ t('Extensiones') }}</a>
          <template v-if="!l.fixed">
            <button class="es-btn es-small" :title="t('Cambiar')" @click="startEditLibrary(l)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
            <button class="es-btn es-small" :title="t('Quitar')" :disabled="saving" @click="removeLibrary(l)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
          </template>
        </span>
      </li>
      <li v-if="!store.libraries.list.value.length" class="es-source es-muted">{{ t('Ninguna todavía: añade una con «Añadir biblioteca».') }}</li>
    </ul>

    <!-- the outside libraries a server connects by itself (the web; in an app, when it has a server) -->
    <header v-if="store.libraries && state.server && sources.length" class="es-page-head es-subhead">
      <h2 class="es-h2">{{ t('Las de {server}', { server: serverLabel(store) }) }}</h2>
    </header>
    <ul v-if="state.server && (!store.libraries || sources.length)" class="es-sources">
      <li v-if="!store.libraries" class="es-source">
        <span class="es-source-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ serverLabel(store) }}</strong>
          <small class="es-muted">
            <template v-if="state.status">{{ plural(state.status.archivador.total, '{n} elemento', '{n} elementos') }}<template v-if="state.status.archivador.pending"> · {{ t('{n} abriéndose', { n: state.status.archivador.pending }) }}</template><template v-if="state.status.archivador.errors"> · {{ t('{n} con error', { n: state.status.archivador.errors }) }}</template></template>
            <template v-else>{{ t('Conectando…') }}</template>
          </small>
        </span>
        <span class="es-source-actions"><a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: 'archivador' })">{{ t('Ver') }}</a></span>
      </li>
      <li v-for="s in sources" :key="s.id" class="es-source" :class="{ 'es-source-off': !s.enabled }">
        <span class="es-source-icon"><i class="es-i es-i-server" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ s.name }} <small class="es-muted">{{ s.label }}</small></strong>
          <small class="es-muted es-ellipsis">{{ s.url }}</small>
          <small :class="s.scan_error ? 'es-source-bad' : 'es-muted'">
            <template v-if="s.scan_error">{{ s.scan_error }}</template>
            <template v-else-if="!s.enabled">{{ t('Desactivada') }}</template>
            <template v-else-if="s.scanned">{{ plural(s.items, '{n} elemento · revisada {ago}', '{n} elementos · revisada {ago}', { ago: ago(s.scanned) }) }}<template v-if="s.supports_progress"> · {{ t('progreso sincronizado') }}</template></template>
            <template v-else>{{ t('Revisando por primera vez…') }}</template>
          </small>
        </span>
        <span class="es-source-actions">
          <a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: String(s.id) })">{{ t('Ver') }}</a>
          <button class="es-btn es-small" :disabled="busy === s.id" :title="t('Mirar ya qué hay nuevo')" @click="scan(s)"><span v-if="busy === s.id" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="t('Cambiar')" @click="startEdit(s)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="s.enabled ? t('Desactivar') : t('Activar')" @click="toggle(s)"><i class="es-i" :class="s.enabled ? 'es-i-pause' : 'es-i-play'" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="t('Quitar')" @click="remove(s)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
        </span>
      </li>
    </ul>

  </section>
</template>

<script setup lang="ts">
import { useSync } from '../lib/favorites'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Source, SourceKind, SourceKindInfo } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { LIBRARY_TYPES, nameFromUrl, type Library, type LibraryType } from '../lib/libraries'
import { serverLabel, useStore } from '../lib/store'

/** The libraries: in an app, the servers it connects by itself (a server of its own, Komga, Kavita…); on
 * the web of a server, the outside libraries that server connects (add one, see how each is doing, scan,
 * edit, pause or remove it). This device's own folders are in «Estantería». */
/** `add`: open with the form to add a library (the «+» menu) */
const props = defineProps<{ add?: boolean }>()
const store = useStore()
// what is shared with the other devices, kept in step from the first page (see sync.ts)
useSync(store)
const { state, go } = store
const kinds = ref<SourceKindInfo[]>([])
const sources = ref<Source[]>([])
const adding = ref(false)
const editing = ref<Source | null>(null)
const saving = ref(false)
const busy = ref<number | null>(null)

const form = reactive({ kind: 'komga' as SourceKind, name: '', url: '', username: '', secret: '' })

const kindInfo = computed(() => kinds.value.find((k) => k.kind === form.kind))
const HINTS: Record<string, string> = {
  komga: 'Un servidor Komga: entra con tu usuario y contraseña de Komga (o deja el usuario vacío y pon una clave de API). El progreso de lectura se guarda en Komga.',
  kavita: 'Un servidor Kavita: hace falta tu clave de API (en Kavita: tu usuario › Ajustes › API). El progreso de lectura se guarda en Kavita.',
  opds: 'Cualquier catálogo OPDS (Calibre-Web, Ubooquity, el servidor de Calibre…): la dirección del catálogo y, si lo pide, usuario y contraseña. El progreso se guarda aquí.',
  opds2: 'Un catálogo OPDS 2.0 (JSON), como el de Komga en /opds/v2/catalog: los cómics con manifiesto se leen página a página. El progreso se guarda aquí.',
  audiobookshelf: 'Un servidor Audiobookshelf: sus libros electrónicos (epub, pdf, cbz…; los audiolibros no). Tu usuario y contraseña, o el usuario vacío y una clave de API. El progreso se guarda también en Audiobookshelf.',
  suwayomi: 'Un servidor Suwayomi (el de Tachiyomi/Mihon): los manga de su biblioteca, un elemento por capítulo. Usuario y contraseña solo si los tiene activados. Lo leído se guarda también en Suwayomi.',
  webdav: 'Una carpeta WebDAV (otro Nextcloud u OpenCloud, un NAS): la dirección de la carpeta con los archivos. El progreso se guarda aquí.'
}
const hint = computed(() => (HINTS[form.kind] ? t(HINTS[form.kind]) : ''))

function ago(epoch: number): string {
  const min = Math.round((Date.now() / 1000 - epoch) / 60)
  if (min < 2) return t('ahora mismo')
  if (min < 60) return t('hace {n} min', { n: min })
  const h = Math.round(min / 60)
  if (h < 48) return t('hace {n} h', { n: h })
  return t('hace {n} días', { n: Math.round(h / 24) })
}

// ---- an app's own libraries ----
const lib = reactive({ id: '' as string, type: 'server' as LibraryType, name: '', url: '', username: '', secret: '' })
const libInfo = computed(() => LIBRARY_TYPES[lib.type])
function startEditLibrary(l: Library) {
  Object.assign(lib, { id: l.id, type: l.type, name: l.name, url: l.url, username: l.username, secret: '' })
  adding.value = true
}
async function saveLibrary() {
  saving.value = true
  try {
    const name = lib.name.trim() || nameFromUrl(lib.url.trim())
    const saved = await store.libraries!.save({ id: lib.id || undefined, type: lib.type, name, url: lib.url.trim().replace(/\/+$/, ''), username: lib.username.trim(), secret: lib.secret || undefined })
    store.notify(lib.id ? t('«{name}» guardada.', { name: saved.name }) : t('«{name}» conectada.', { name: saved.name }))
    adding.value = false
    lib.secret = ''
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function removeLibrary(l: Library) {
  if (!window.confirm(t('¿Quitar «{name}»? Se olvida su contraseña y sus elementos dejan de estar en tu estantería (lo descargado y lo leído se quedan en este dispositivo).', { name: l.name }))) return
  saving.value = true
  try {
    await store.libraries!.remove(l.id)
    store.notify(t('«{name}» quitada.', { name: l.name }))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}

async function load() {
  if (!state.connected || !state.server) return
  try {
    if (!kinds.value.length) kinds.value = await store.api.sourceKinds()
    sources.value = await store.api.sources()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function startAdd() {
  if (store.libraries) {
    Object.assign(lib, { id: '', type: store.libraries.types[0], name: '', url: '', username: '', secret: '' })
    adding.value = true
    return
  }
  editing.value = null
  Object.assign(form, { kind: 'komga', name: '', url: '', username: '', secret: '' })
  adding.value = true
}
function startEdit(s: Source) {
  editing.value = s
  Object.assign(form, { kind: s.kind, name: s.name, url: s.url, username: s.username, secret: '' })
  adding.value = true
}
async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await store.api.changeSource(editing.value.id, { name: form.name.trim(), url: form.url.trim(), username: form.username.trim(), secret: form.secret || undefined })
      store.notify(t('Biblioteca guardada.'))
    } else {
      await store.api.addSource({ kind: form.kind, name: form.name.trim(), url: form.url.trim(), username: form.username.trim(), secret: form.secret })
      store.notify(t('Biblioteca añadida; se está revisando.'))
    }
    adding.value = false
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function scan(s: Source) {
  busy.value = s.id
  try {
    const r = await store.api.scanSource(s.id)
    store.notify(t('{name}: {files} elementos, {new} nuevos.', { name: s.name, files: r.files, new: r.new }))
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = null
}
async function toggle(s: Source) {
  try { await store.api.changeSource(s.id, { enabled: !s.enabled }); await load() } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function remove(s: Source) {
  if (!window.confirm(t('¿Quitar «{name}»? Sus elementos desaparecen de la biblioteca (el progreso guardado en ese servidor se queda allí).', { name: s.name }))) return
  try {
    await store.api.deleteSource(s.id)
    store.notify(t('Biblioteca quitada.'))
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
onMounted(() => { load(); if (props.add) startAdd() })
watch(() => props.add, (now) => { if (now) startAdd() })
watch(() => state.connected, load)
watch(() => state.status?.sources?.map((s) => `${s.id}:${s.scanned}:${s.items}`).join(','), load)
</script>
