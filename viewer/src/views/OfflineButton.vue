<template>
  <button v-if="offline" class="es-btn" :class="{ 'es-offline-on': allDone }" :disabled="!items.length" :title="hint" @click="act">
    <span v-if="busy" class="es-spin"></span>
    <i v-else class="es-i" :class="allDone ? 'es-i-check' : 'es-i-download'" aria-hidden="true"></i>
    {{ label }}
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Item } from '../lib/api'
import { t } from '../lib/i18n'
import { sizeLabel, useStore } from '../lib/store'

/** Makes one item, or a whole series or folder, available without connection (or stops / undoes it).
 * Only in the apps that can keep files: nothing on the web. */
const props = withDefaults(defineProps<{ items: Item[]; what?: string }>(), { what: '' })
const store = useStore()
const offline = computed(() => store.offline)

const states = computed(() => props.items.map((i) => offline.value?.status(i.id) || ''))
const done = computed(() => states.value.filter((s) => s === 'done').length)
const going = computed(() => states.value.filter((s) => s === 'running' || s === 'waiting').length)
const failed = computed(() => states.value.filter((s) => s === 'error').length)
const allDone = computed(() => props.items.length > 0 && done.value === props.items.length)
const busy = computed(() => going.value > 0)
const single = computed(() => props.items.length === 1)

const percent = computed(() => {
  const o = offline.value
  if (!o) return 0
  let got = 0
  let total = 0
  for (const i of props.items) {
    const job = o.state.jobs[i.id]
    if (o.state.entries[i.id]) { got += 1; total += 1 } else if (job) { total += 1; got += job.total ? job.done / job.total : 0 } else total += 1
  }
  return total ? Math.round((got / total) * 100) : 0
})

const label = computed(() => {
  if (busy.value) return single.value ? t('Descargando {percent} %', { percent: percent.value }) : t('Descargando {done} de {total}', { done: done.value, total: props.items.length })
  if (allDone.value) return single.value ? t('Disponible sin conexión') : props.what ? t('Todo {what} sin conexión', { what: props.what }) : t('Todo sin conexión')
  if (failed.value && single.value) return t('Reintentar la descarga')
  if (!single.value && done.value) return t('Descargar el resto ({n})', { n: props.items.length - done.value })
  return single.value ? t('Descargar para leer sin conexión') : props.what ? t('Descargar {what} ({n})', { what: props.what, n: props.items.length }) : t('Descargar ({n})', { n: props.items.length })
})
const hint = computed(() => {
  const o = offline.value
  if (!o) return ''
  if (busy.value) return t('Pulsa para pararla')
  if (allDone.value) {
    const bytes = props.items.reduce((sum, i) => sum + (o.state.entries[i.id]?.bytes || 0), 0)
    return t('Ocupa {size} en este equipo. Pulsa para quitar la copia.', { size: sizeLabel(bytes) })
  }
  const error = props.items.map((i) => o.state.jobs[i.id]?.error).find(Boolean)
  return error ? t('No se pudo: {error}', { error }) : t('Guarda una copia en este equipo para leerla sin conexión')
})

async function act() {
  const o = offline.value
  if (!o) return
  if (busy.value) {
    for (const i of props.items) if (o.state.jobs[i.id]) await o.remove(i.id)
    return
  }
  if (allDone.value) {
    await o.removeAll(props.items.map((i) => i.id))
    store.notify(single.value ? t('Copia quitada de este equipo.') : t('{n} copias quitadas de este equipo.', { n: props.items.length }))
    return
  }
  const added = o.add(props.items)
  if (!single.value) store.notify(added ? t('{n} en la cola de descargas.', { n: added }) : t('Ya estaba todo en la cola.'))
}
</script>
