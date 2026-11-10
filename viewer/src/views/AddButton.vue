<template>
  <div ref="wrap" class="es-fab-wrap">
    <Transition name="es-fab-pop">
      <div v-if="open" class="es-fab-menu" role="menu" aria-label="Añadir">
        <template v-if="store.shelf">
          <button class="es-fab-item" role="menuitem" :disabled="busy" @click="files">
            <span class="es-fab-icon"><i class="es-i es-i-book-open" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>Abrir archivos…</strong><small>cbz, cbr, cb7, pdf o epub de este PC</small></span>
          </button>
          <button class="es-fab-item" role="menuitem" :disabled="busy" @click="folder">
            <span class="es-fab-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>Añadir una carpeta…</strong><small>Sus cómics y libros, con sus subcarpetas</small></span>
          </button>
          <span class="es-fab-sep" role="separator"></span>
        </template>
        <button class="es-fab-item" role="menuitem" @click="server">
          <span class="es-fab-icon"><i class="es-i es-i-server" aria-hidden="true"></i></span>
          <span class="es-fab-text"><strong>Conectar una biblioteca…</strong><small>Komga, Kavita, OPDS, Audiobookshelf…</small></span>
        </button>
        <button class="es-fab-item" role="menuitem" @click="catalogs">
          <span class="es-fab-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
          <span class="es-fab-text"><strong>Explorar catálogos</strong><small>Gutenberg, Internet Archive, MangaDex</small></span>
        </button>
      </div>
    </Transition>
    <button class="es-fab" :class="{ open }" :aria-expanded="open" :title="open ? 'Cerrar' : 'Añadir'" aria-label="Añadir" @click="open = !open">
      <span v-if="busy" class="es-spin"></span><i v-else class="es-i es-i-add" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useStore } from '../lib/store'

/** The «+» at the bottom right: open files or add a folder of this PC (the desktop), connect someone
 * else's library or browse the public catalogues. */
const store = useStore()
const open = ref(false)
const busy = ref(false)
const wrap = ref<HTMLElement>()

async function files() {
  open.value = false
  busy.value = true
  try {
    const added = await store.shelf!.pickFiles()
    if (added.length) {
      await store.refresh()
      if (added.length === 1) store.read(added[0])
      else { store.notify(`${added.length} archivos en tu estantería.`); store.go({ v: 'library', source: String(added[0].source_id) }) }
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = false
}
async function folder() {
  open.value = false
  busy.value = true
  try {
    const roots = await store.shelf!.addFolders()
    if (roots.length) {
      await store.refresh()
      store.notify(roots.length === 1 ? `«${roots[0].name}» está en tu biblioteca.` : `${roots.length} carpetas en tu biblioteca.`)
      store.go({ v: 'library', source: String(-roots[roots.length - 1].id) })
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = false
}
function server() {
  open.value = false
  store.go({ v: 'sources', add: true })
}
function catalogs() {
  open.value = false
  store.go({ v: 'catalogs' })
}

function outside(event: MouseEvent) {
  if (open.value && wrap.value && !wrap.value.contains(event.target as Node)) open.value = false
}
function key(event: KeyboardEvent) {
  if (event.key === 'Escape' && open.value) open.value = false
}
onMounted(() => { document.addEventListener('mousedown', outside); document.addEventListener('keydown', key) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', key) })
</script>
