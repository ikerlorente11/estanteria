<template>
  <div v-if="here.length || there.length" ref="root" class="es-filebtn es-delete">
    <button class="es-btn es-btn-danger" :disabled="working" aria-haspopup="menu" :aria-expanded="open" @click.stop="open = !open">
      <span v-if="working" class="es-spin"></span><i v-else class="es-i es-i-delete" aria-hidden="true"></i> {{ label || t('Borrar') }}
    </button>
    <div v-if="open" class="es-fab-menu es-file-menu es-file-menu-end" role="menu" @click.stop>
      <button v-if="here.length" class="es-fab-item" role="menuitem" @click="removeHere">
        <span class="es-fab-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Quitar de este dispositivo') }}</strong>
          <small class="es-muted">{{ many ? plural(here.length, '{n} copia de aquí', '{n} copias de aquí') : there.length ? t('Sigue en {server}', { server: serverLabel(store) }) : t('Era la única copia: desaparece') }}</small></span>
      </button>
      <button v-if="there.length" class="es-fab-item es-fab-danger" role="menuitem" @click="removeEverywhere">
        <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ here.length ? t('Borrar de todos lados') : t('Borrar de {server}', { server: serverLabel(store) }) }}</strong>
          <small class="es-muted">{{ t('De {server} (queda un tiempo en su papelera) y de tus dispositivos', { server: serverLabel(store) }) }}</small></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Item } from '../lib/api'
import { forgetCatalogItems } from '../lib/catalogdownloads'
import { collectionsOf, setInCollection } from '../lib/collections'
import { type Favorite, setFavorite } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { DOWNLOADS_ROOT, isLocal, LOOSE_ROOT } from '../lib/local'
import { serverLabel, useStore } from '../lib/store'
import { serverCopyOf } from '../lib/uploads'

/** Deleting things of the shelf (an item, or every number of a series): off this device (a file downloaded or put
 * here, or the copy kept to read offline), or for good from everywhere (the server's file, which OpenCloud keeps in
 * its trash a while, and this device's). The files of a folder of one's own on this device are not deleted from the
 * disk here (they are one's own); an outside library's or a folder of images is not deleted from the server here. */
const props = defineProps<{
  items: Item[]
  what: string
  label?: string
  /** what marks the whole of it (a series' favourite), unmarked too when it is deleted from everywhere */
  marked?: { key: string; value: Favorite }
}>()
const emit = defineEmits<{ removed: [] }>()
const store = useStore()
const open = ref(false)
const working = ref(false)
const root = ref<HTMLElement | null>(null)
const many = computed(() => props.items.length > 1)

/** what this device has of each that can go: a file downloaded or put here, or the offline copy */
const canHere = (item: Item) => (isLocal(item.id)
  ? item.source_id === -LOOSE_ROOT || item.source_id === -DOWNLOADS_ROOT
  : store.offline?.status(item.id) === 'done')
const here = computed(() => props.items.filter(canHere))
/** the server's file of each: itself (one of the reading folder), or the copy a file of this device has there */
const there = ref<Item[]>([])
async function findServer() {
  there.value = []
  if (!store.state.server || store.api.standalone) return
  const found = new Map<number, Item>()
  for (const item of props.items) {
    if (!isLocal(item.id)) {
      if (item.source_id === null && item.format !== 'folder') found.set(item.id, item)
      continue
    }
    const copy = await serverCopyOf(store, item).catch(() => null)
    if (copy && copy.format !== 'folder') found.set(copy.id, copy)
  }
  there.value = [...found.values()]
}
watch(() => [props.items.map((i) => i.id).join(','), store.state.server], findServer, { immediate: true })

async function removeLocalCopies(items: Item[]) {
  for (const item of items) {
    if (isLocal(item.id)) {
      await store.shelf?.removeFile(item.id)
      forgetCatalogItems([item.id])
    } else {
      await store.offline?.remove(item.id)
    }
  }
}

async function removeHere() {
  open.value = false
  const sure = many.value
    ? plural(here.value.length, '¿Quitar de este dispositivo {n} copia de «{what}»? Lo que esté en {server} se queda allí.',
        '¿Quitar de este dispositivo {n} copias de «{what}»? Lo que esté en {server} se queda allí.', { what: props.what, server: serverLabel(store) })
    : there.value.length
      ? t('¿Quitar «{title}» de este dispositivo? Sigue en {server}.', { title: props.what, server: serverLabel(store) })
      : t('¿Borrar «{title}» de este dispositivo? Es la única copia: no se puede recuperar.', { title: props.what })
  if (!window.confirm(sure)) return
  working.value = true
  try {
    const leaving = props.items.some(isLocalItem)
    await removeLocalCopies(here.value)
    store.notify(t('Quitado de este dispositivo.'))
    await store.refresh()
    if (leaving) emit('removed')
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}
const isLocalItem = (item: Item) => isLocal(item.id) && canHere(item)

async function removeEverywhere() {
  open.value = false
  if (!there.value.length) return
  const sure = many.value
    ? t('¿Borrar «{what}» de todos lados ({n} números)? Se borran de {server} (quedan un tiempo en su papelera), de este dispositivo y de tus colecciones y favoritos.',
        { what: props.what, n: there.value.length, server: serverLabel(store) })
    : t('¿Borrar «{title}» de todos lados? Se borra de {server} (queda un tiempo en su papelera), de este dispositivo y de tus colecciones y favoritos.',
        { title: props.what, server: serverLabel(store) })
  if (!window.confirm(sure)) return
  working.value = true
  let failed = 0
  try {
    for (const item of there.value) {
      try { await store.api.deleteItem(item.id) } catch (_) { failed++ }
    }
    await removeLocalCopies(here.value).catch(() => {})
    forgetCatalogItems(there.value.map((i) => i.id))
    if (failed) store.notify(t('{n} no se pudieron borrar de {server}.', { n: failed, server: serverLabel(store) }), true)
    else {
      const marked = props.marked
      if (marked) {
        setFavorite(marked.key, null)
        for (const id of collectionsOf(marked.key)) setInCollection(id, marked, false)
      }
      store.notify(t('«{title}» borrado.', { title: props.what }))
    }
    await store.refresh()
    emit('removed')
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  working.value = false
}

function outside(e: MouseEvent) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false }
onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))
</script>
