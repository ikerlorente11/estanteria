<template>
  <div v-if="offer" class="es-handoff" role="status">
    <i class="es-i es-i-book-open" aria-hidden="true"></i>
    <span>{{ text }}</span>
    <button class="es-btn es-small es-primary" @click="emit('go', offer)">{{ t('Ir allí') }}</button>
    <button class="es-btn es-small" :title="t('Seguir aquí')" @click="emit('dismiss')"><i class="es-i es-i-close" aria-hidden="true"></i></button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { Progress } from '../lib/api'
import { deviceWhere } from '../lib/handoff'
import { timeAgo } from '../lib/follows'
import { t } from '../lib/i18n'

/** «Ibas por la página 45 en el móvil (hace 10 min) · Ir allí»: read on since on another device (see handoff.ts). */
const props = defineProps<{ offer: Progress | null }>()
const emit = defineEmits<{ go: [Progress]; dismiss: [] }>()
const text = computed(() => {
  const p = props.offer
  if (!p) return ''
  const where = deviceWhere(p.device)
  const ago = p.updated ? timeAgo(p.updated) : ''
  if (p.finished) return t('Lo terminaste {where} ({ago})', { where, ago })
  if (p.page !== null && p.page !== undefined && !p.location) return t('Ibas por la página {n} {where} ({ago})', { n: p.page + 1, where, ago })
  return t('Ibas por el {percent} % {where} ({ago})', { percent: Math.round((p.percent || 0) * 100), where, ago })
})
</script>
