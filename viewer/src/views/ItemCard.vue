<template>
  <article v-if="!(done && appSettings.hideFinished)" class="es-card" :class="{ 'es-card-done': done }">
    <a href="#" class="es-card-cover" :title="t('Leer «{title}»', { title: item.title })" @click.prevent="emit('read')">
      <Cover :id="item.id" :has="item.cover" :icon="item.kind === 'book' ? 'es-i-book' : 'es-i-pages'" :title="item.kind === 'book' ? item.title : ''">
        <span v-if="item.state === 'listed'" class="es-card-wait" :title="t('Aún abriéndose')"><span class="es-spin"></span></span>
        <span v-else-if="item.state === 'error'" class="es-card-bad" :title="item.error || t('No se pudo abrir')"><i class="es-i es-i-info" aria-hidden="true"></i></span>
        <span v-if="percent > 0 && !done" class="es-card-bar"><span :style="{ width: `${Math.round(percent * 100)}%` }"></span></span>
        <span v-if="done" class="es-card-check" :title="t('Leído')"><i class="es-i es-i-check" aria-hidden="true"></i></span>
        <span v-if="kept" class="es-card-kept" :title="kept === 'done' ? t('Disponible sin conexión') : t('Descargando…')">
          <span v-if="kept !== 'done'" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i>
        </span>
      </Cover>
    </a>
    <div class="es-card-text">
      <a href="#" class="es-card-title es-ellipsis" :title="item.title" @click.prevent="emit('read')">{{ title }}</a>
      <span class="es-muted es-small es-ellipsis">{{ subtitle }}</span>
      <span v-if="origin" class="es-origin es-ellipsis" :title="local ? t('En este dispositivo: {where}', { where: origin }) : t('De {origin}', { origin })"><i class="es-i" :class="local ? 'es-i-computer' : 'es-i-server'" aria-hidden="true"></i> {{ origin }}</span>
    </div>
    <button class="es-card-info" :title="t('Detalles')" :aria-label="t('Detalles')" @click="emit('open')"><i class="es-i es-i-more" aria-hidden="true"></i></button>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Item } from '../lib/api'
import { appSettings } from '../lib/appsettings'
import { plural, t } from '../lib/i18n'
import { isLocal } from '../lib/local'
import { kindLabel, percentOf, shortTitle, sourceName, useStore } from '../lib/store'
import Cover from './Cover.vue'

const props = withDefaults(defineProps<{ item: Item; showSeries?: boolean }>(), { showSeries: true })
const emit = defineEmits<{ read: []; open: [] }>()
const store = useStore()
const origin = computed(() => sourceName(props.item, store.state.status?.sources))
const local = computed(() => isLocal(props.item.id))
/** 'done' when kept on this device, 'running'/'waiting' while downloading, '' else */
const kept = computed(() => { const s = store.offline?.status(props.item.id) || ''; return s === 'error' ? '' : s })

const percent = computed(() => percentOf(props.item))
const done = computed(() => !!props.item.progress?.finished)
const title = computed(() => (props.showSeries ? shortTitle(props.item) : props.item.number !== null && props.item.number !== undefined ? t('Nº {number}', { number: props.item.number }) : props.item.title))
const subtitle = computed(() => {
  const i = props.item
  const parts: string[] = []
  if (props.showSeries && i.series && i.title !== shortTitle(i)) parts.push(i.title)
  else if (!props.showSeries) parts.push(i.title)
  if (i.author && !parts.includes(i.author)) parts.push(i.author)
  const pages = i.pages && i.kind !== 'book' ? plural(i.pages, '{n} pág.', '{n} págs.') : ''
  const progress = i.progress && !i.progress.finished && i.progress.page !== null && i.kind !== 'book' ? t('pág. {page}', { page: i.progress.page + 1 }) : ''
  return [parts[0], kindLabel(i), progress || pages].filter(Boolean).join(' · ')
})
</script>
