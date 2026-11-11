<template>
  <div class="es-lock" role="dialog" aria-modal="true" :aria-label="t('La Estantería está bloqueada')">
    <span class="es-lock-mark" aria-hidden="true"><i class="es-i es-i-book" aria-hidden="true"></i></span>
    <strong>{{ t('La Estantería está bloqueada') }}</strong>
    <button class="es-btn es-primary" :disabled="asking" @click="unlock">
      <span v-if="asking" class="es-spin"></span> {{ t('Desbloquear') }}
    </button>
    <small v-if="failed" class="es-muted">{{ t('No se ha podido comprobar que eres tú. Prueba otra vez.') }}</small>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { t } from '../lib/i18n'
import type { NativeFeatures } from '../lib/native'

/** What covers the app while it is locked: it asks the device's own lock (fingerprint, face, PIN) at once
 * and again with the button. */
const props = defineProps<{ lock: NonNullable<NativeFeatures['lock']> }>()
const emit = defineEmits<{ unlocked: [] }>()
const asking = ref(false)
const failed = ref(false)

async function unlock() {
  asking.value = true
  failed.value = false
  try {
    if (await props.lock.unlock(t('Desbloquear La Estantería'))) emit('unlocked')
    else failed.value = true
  } catch (_) { failed.value = true }
  asking.value = false
}
onMounted(unlock)
</script>
