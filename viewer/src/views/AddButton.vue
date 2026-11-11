<template>
  <div v-if="store.shelf" ref="wrap" class="es-fab-wrap">
    <Transition name="es-fab-pop">
      <div v-if="open" class="es-fab-menu" role="menu" :aria-label="t('Añadir')">
        <button class="es-fab-item" role="menuitem" :disabled="busy" @click="files">
            <span class="es-fab-icon"><i class="es-i es-i-book-open" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>{{ t('Abrir archivos…') }}</strong><small>{{ t('Cómics, libros y documentos de este dispositivo') }}</small></span>
          </button>
          <button class="es-fab-item" role="menuitem" :disabled="busy" @click="folder">
            <span class="es-fab-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
            <span class="es-fab-text"><strong>{{ t('Añadir una carpeta…') }}</strong><small>{{ t('Sus cómics y libros, con sus subcarpetas') }}</small></span>
          </button>
      </div>
    </Transition>
    <button class="es-fab" :class="{ open }" :aria-expanded="open" :title="open ? t('Cerrar') : t('Añadir')" :aria-label="t('Añadir')" @click="open = !open">
      <span v-if="busy" class="es-spin"></span><i v-else class="es-i es-i-add" aria-hidden="true"></i>
    </button>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../lib/i18n'
import { useStore } from '../lib/store'

/** The «+» at the bottom right: open files or add a folder of this device (the apps). Libraries and catalogs
 * are added in their own pages. */
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
      else { store.notify(t('{n} archivos en tu estantería.', { n: added.length })); store.go({ v: 'library', source: String(added[0].source_id) }) }
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
      store.notify(roots.length === 1 ? t('«{name}» está en tu estantería.', { name: roots[0].name }) : t('{n} carpetas en tu estantería.', { n: roots.length }))
      store.go({ v: 'library', source: String(-roots[roots.length - 1].id) })
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = false
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
