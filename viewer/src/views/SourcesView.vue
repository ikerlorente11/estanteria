<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">Bibliotecas</h1>
      <span class="es-grow"></span>
      <button v-if="!adding" class="es-btn es-primary" @click="startAdd"><i class="es-i es-i-add" aria-hidden="true"></i> Añadir biblioteca</button>
    </header>
    <p class="es-muted">Tu estantería es la carpeta «{{ store.readingRoot }}» de tu nube. Añade bibliotecas de otros (un Komga, un Kavita, un catálogo OPDS, una carpeta WebDAV) y sus cómics y libros aparecen junto a los tuyos, con el progreso guardado allí cuando el servidor lo permite.</p>

    <form v-if="adding" class="es-form" @submit.prevent="save">
      <label>Tipo
        <select v-model="form.kind">
          <option v-for="k in kinds" :key="k.kind" :value="k.kind">{{ k.label }}</option>
        </select>
      </label>
      <p v-if="hint" class="es-muted es-small">{{ hint }}</p>
      <label>Nombre <input v-model="form.name" type="text" required maxlength="120" placeholder="Komga de Ana" /></label>
      <label>Dirección <input v-model="form.url" type="url" required placeholder="https://komga.ejemplo.com" /></label>
      <label v-if="kindInfo?.fields.includes('username')">Usuario <input v-model="form.username" type="text" autocomplete="off" /></label>
      <label v-if="kindInfo?.fields.includes('secret')">{{ kindInfo?.secret_label || 'Contraseña' }} <input v-model="form.secret" type="password" autocomplete="new-password" :placeholder="editing ? '(sin cambios)' : ''" /></label>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ editing ? 'Guardar' : 'Conectar y añadir' }}</button>
        <button class="es-btn" type="button" @click="adding = false">Cancelar</button>
      </div>
    </form>

    <ul class="es-sources">
      <li class="es-source">
        <span class="es-source-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>El Archivador</strong>
          <small class="es-muted">
            <template v-if="state.status">{{ state.status.archivador.total }} {{ state.status.archivador.total === 1 ? 'elemento' : 'elementos' }}<template v-if="state.status.archivador.pending"> · {{ state.status.archivador.pending }} abriéndose</template><template v-if="state.status.archivador.errors"> · {{ state.status.archivador.errors }} con error</template></template>
            <template v-else>Conectando…</template>
          </small>
        </span>
        <span class="es-source-actions"><a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: 'archivador' })">Ver</a></span>
      </li>
      <li v-for="s in sources" :key="s.id" class="es-source" :class="{ 'es-source-off': !s.enabled }">
        <span class="es-source-icon"><i class="es-i es-i-server" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ s.name }} <small class="es-muted">{{ s.label }}</small></strong>
          <small class="es-muted es-ellipsis">{{ s.url }}</small>
          <small :class="s.scan_error ? 'es-source-bad' : 'es-muted'">
            <template v-if="s.scan_error">{{ s.scan_error }}</template>
            <template v-else-if="!s.enabled">Desactivada</template>
            <template v-else-if="s.scanned">{{ s.items }} {{ s.items === 1 ? 'elemento' : 'elementos' }} · revisada {{ ago(s.scanned) }}<template v-if="s.supports_progress"> · progreso sincronizado</template></template>
            <template v-else>Revisando por primera vez…</template>
          </small>
        </span>
        <span class="es-source-actions">
          <a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: String(s.id) })">Ver</a>
          <button class="es-btn es-small" :disabled="busy === s.id" title="Mirar ya qué hay nuevo" @click="scan(s)"><span v-if="busy === s.id" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i></button>
          <button class="es-btn es-small" title="Cambiar" @click="startEdit(s)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="s.enabled ? 'Desactivar' : 'Activar'" @click="toggle(s)"><i class="es-i" :class="s.enabled ? 'es-i-pause' : 'es-i-play'" aria-hidden="true"></i></button>
          <button class="es-btn es-small" title="Quitar" @click="remove(s)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Source, SourceKind, SourceKindInfo } from '../lib/api'
import { useStore } from '../lib/store'

/** Other people's libraries: add one (the service checks it enters), see how each is doing, scan, edit, pause or remove it. */
const store = useStore()
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
const hint = computed(() => HINTS[form.kind] || '')

function ago(epoch: number): string {
  const min = Math.round((Date.now() / 1000 - epoch) / 60)
  if (min < 2) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  const h = Math.round(min / 60)
  if (h < 48) return `hace ${h} h`
  return `hace ${Math.round(h / 24)} días`
}

async function load() {
  if (!state.connected) return
  try {
    if (!kinds.value.length) kinds.value = await store.api.sourceKinds()
    sources.value = await store.api.sources()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function startAdd() {
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
      store.notify('Biblioteca guardada.')
    } else {
      await store.api.addSource({ kind: form.kind, name: form.name.trim(), url: form.url.trim(), username: form.username.trim(), secret: form.secret })
      store.notify('Biblioteca añadida; se está revisando.')
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
    store.notify(`${s.name}: ${r.files} elementos, ${r.new} nuevos.`)
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = null
}
async function toggle(s: Source) {
  try { await store.api.changeSource(s.id, { enabled: !s.enabled }); await load() } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function remove(s: Source) {
  if (!window.confirm(`¿Quitar «${s.name}»? Sus elementos desaparecen de la biblioteca (el progreso guardado en ese servidor se queda allí).`)) return
  try {
    await store.api.deleteSource(s.id)
    store.notify('Biblioteca quitada.')
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
onMounted(load)
watch(() => state.connected, load)
watch(() => state.status?.sources?.map((s) => `${s.id}:${s.scanned}:${s.items}`).join(','), load)
</script>
