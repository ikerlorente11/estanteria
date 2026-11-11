<template>
  <span class="es-confirm">
    <button v-if="!asking" class="es-btn es-small" :class="danger ? 'es-btn-danger' : ''" :disabled="disabled || busy" :title="title" @click="asking = true">
      <span v-if="busy" class="es-spin"></span><i v-else-if="icon" class="es-i" :class="icon" aria-hidden="true"></i> {{ label }}
    </button>
    <template v-else>
      <span class="es-confirm-q">{{ question }}</span>
      <button class="es-btn es-small es-btn-danger" @click="yes">{{ t('Sí') }}</button>
      <button class="es-btn es-small" @click="asking = false">{{ t('No') }}</button>
    </template>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../lib/i18n'

/** A button for something that cannot be undone: it asks first, right there («¿Seguro? Sí · No»). */
const props = withDefaults(defineProps<{ label: string; question: string; icon?: string; title?: string; danger?: boolean; disabled?: boolean; action: () => Promise<unknown> | unknown }>(),
  { icon: '', title: '', danger: true, disabled: false })
const asking = ref(false)
const busy = ref(false)
async function yes() {
  asking.value = false
  busy.value = true
  try { await props.action() } finally { busy.value = false }
}
</script>
