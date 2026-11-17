<template>
  <div v-if="canHere || serverItem" ref="root" class="es-filebtn es-delete">
    <button class="es-btn es-btn-danger" :disabled="working" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open">
      <span v-if="working" class="es-spin"></span><i v-else class="es-i es-i-delete" aria-hidden="true"></i> {{ t('Borrar') }}
    </button>
    <div v-if="open" class="es-fab-menu es-file-menu es-file-menu-end" role="menu" @click.stop>
      <button v-if="canHere" class="es-fab-item" role="menuitem" @click="removeHere">
        <span class="es-fab-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Quitar de este dispositivo') }}</strong>
          <small class="es-muted">{{ serverItem ? t('Sigue en {server}', { server: serverLabel(store) }) : t('Era la única copia: desaparece') }}</small></span>
      </button>
      <button v-if="serverItem" class="es-fab-item es-fab-danger" role="menuitem" @click="removeEverywhere">
        <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ canHere ? t('Borrar de todos lados') : t('Borrar de {server}', { server: serverLabel(store) }) }}</strong>
          <small class="es-muted">{{ t('De {server} (queda un tiempo en su papelera) y de tus dispositivos', { server: serverLabel(store) }) }}</small></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { forgetCatalogItems } from '../lib/catalogdownloads'
import { t } from '../lib/i18n'
import { DOWNLOADS_ROOT, isLocal, LOOSE_ROOT } from '../lib/local'
import { serverLabel, useStore } from '../lib/store'
import { serverCopyOf } from '../lib/uploads'

/** Deleting something of the shelf: off this device (a file downloaded or put here, or the copy kept to read offline),
 * or for good from everywhere (the server's file, which OpenCloud keeps in its trash a while, and this device's). The
 * files of a folder of one's own on this device are not deleted from the disk here (they are one's own). */
const props = defineProps<{ item: Item }>()
const emit = defineEmits<{ removed: [] }>()
const store = useStore()
const open = ref(false)
const working = ref(false)
const root = ref<HTMLElement | null>(null)

const local = computed(() => isLocal(props.item.id))
const keptOffline = computed(() => !local.value && store.offline?.status(props.item.id) === 'done')
/** what this device has of it that can go: a file downloaded or put here, or the offline copy */
const canHere = computed(() => (local.value ? props.item.source_id === -LOOSE_ROOT || props.item.source_id === -DOWNLOADS_ROOT : keptOffline.value))
/** the server's file of it: itself (one of the reading folder), or the copy a file of this device has there */
const serverItem = ref<Item | null>(null)
async function findServer() {
  serverItem.value = null
  if (!store.state.server || store.api.standalone) return
  if (!local.value) { if (props.item.source_id === null && props.item.format !== 'folder') serverItem.value = props.item; return }
  serverItem.value = await serverCopyOf(store, props.item).catch(() => null)
}
watch(() => [props.item.id, store.state.server], findServer, { immediate: true })

async function removeLocalCopy() {
  if (local.value) {
    await store.shelf?.removeFile(props.item.id)
    forgetCatalogItems([props.item.id])
  } else if (keptOffline.value) {
    await store.offline?.remove(props.item.id)
  }
}

async function removeHere() {
  open.value = false
  const sure = serverItem.value
    ? t('¿Quitar «{title}» de este dispositivo? Sigue en {server}.', { title: props.item.title, server: serverLabel(store) })
    : t('¿Borrar «{title}» de este dispositivo? Es la única copia: no se puede recuperar.', { title: props.item.title })
  if (!window.confirm(sure)) return
  working.value = true
  try {
    await removeLocalCopy()
    store.notify(t('Quitado de este dispositivo.'))
    await store.refresh()
    if (local.value) emit('removed')
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}

async function removeEverywhere() {
  open.value = false
  const there = serverItem.value
  if (!there) return
  if (!window.confirm(t('¿Borrar «{title}» de todos lados? Se borra de {server} (queda un tiempo en su papelera), de este dispositivo y de tus colecciones y favoritos.',
                        { title: props.item.title, server: serverLabel(store) }))) return
  working.value = true
  try {
    await store.api.deleteItem(there.id)
    if (canHere.value) await removeLocalCopy().catch(() => {})
    forgetCatalogItems([there.id])
    store.notify(t('«{title}» borrado.', { title: props.item.title }))
    await store.refresh()
    emit('removed')
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}

function outside(e: MouseEvent) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false }
onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))
</script>
