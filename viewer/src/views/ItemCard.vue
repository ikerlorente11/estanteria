<template>
  <article class="es-card" :class="{ 'es-card-done': done }">
    <a href="#" class="es-card-cover" :title="`Leer «${item.title}»`" @click.prevent="emit('read')">
      <Cover :id="item.id" :has="item.cover" :icon="item.kind === 'book' ? 'es-i-book' : 'es-i-pages'">
        <span v-if="item.state === 'listed'" class="es-card-wait" title="Aún abriéndose"><span class="es-spin"></span></span>
        <span v-else-if="item.state === 'error'" class="es-card-bad" :title="item.error || 'No se pudo abrir'"><i class="es-i es-i-info" aria-hidden="true"></i></span>
        <span v-if="percent > 0 && !done" class="es-card-bar"><span :style="{ width: `${Math.round(percent * 100)}%` }"></span></span>
        <span v-if="done" class="es-card-check" title="Leído"><i class="es-i es-i-check" aria-hidden="true"></i></span>
      </Cover>
    </a>
    <div class="es-card-text">
      <a href="#" class="es-card-title es-ellipsis" :title="item.title" @click.prevent="emit('read')">{{ title }}</a>
      <span class="es-muted es-small es-ellipsis">{{ subtitle }}</span>
    </div>
    <button class="es-card-info" title="Detalles" aria-label="Detalles" @click="emit('open')"><i class="es-i es-i-more" aria-hidden="true"></i></button>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Item } from '../lib/api'
import { kindLabel, percentOf, shortTitle } from '../lib/store'
import Cover from './Cover.vue'

const props = withDefaults(defineProps<{ item: Item; showSeries?: boolean }>(), { showSeries: true })
const emit = defineEmits<{ read: []; open: [] }>()

const percent = computed(() => percentOf(props.item))
const done = computed(() => !!props.item.progress?.finished)
const title = computed(() => (props.showSeries ? shortTitle(props.item) : props.item.number !== null && props.item.number !== undefined ? `Nº ${props.item.number}` : props.item.title))
const subtitle = computed(() => {
  const i = props.item
  const parts: string[] = []
  if (props.showSeries && i.series && i.title !== shortTitle(i)) parts.push(i.title)
  else if (!props.showSeries) parts.push(i.title)
  if (i.author && !parts.includes(i.author)) parts.push(i.author)
  const pages = i.pages && i.kind !== 'book' ? `${i.pages} págs.` : ''
  const progress = i.progress && !i.progress.finished && i.progress.page !== null && i.kind !== 'book' ? `pág. ${i.progress.page + 1}` : ''
  return [parts[0], kindLabel(i), progress || pages].filter(Boolean).join(' · ')
})
</script>
