<template>
  <div class="es-tg-video" role="dialog" :aria-label="item.title" @keydown.esc="store.back()">
    <header class="es-tg-video-head">
      <button ref="closer" class="es-btn es-small" :title="t('Volver')" @click="store.back()"><i class="es-i es-i-back" aria-hidden="true"></i></button>
      <strong class="es-ellipsis">{{ item.title }}</strong>
    </header>
    <div class="es-tg-video-body">
      <video v-if="url" class="es-tg-video-player" :src="url" controls autoplay playsinline></video>
      <div v-else class="es-tg-video-wait">
        <template v-if="error">
          <p class="es-source-bad">{{ error }}</p>
          <button class="es-btn" @click="load()">{{ t('Reintentar') }}</button>
        </template>
        <template v-else>
          <p><span class="es-spin"></span> {{ total ? t('Cargando el vídeo… {done} de {size}', { done: sizeText(done) || '0 KB', size: sizeText(total) }) : t('Abriendo…') }}</p>
          <progress v-if="total" class="es-tg-video-bar" :value="done" :max="total"></progress>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ItemDetail } from '../lib/api'
import { t } from '../lib/i18n'
import { isLocal } from '../lib/local'
import { useStore } from '../lib/store'
import { sizeText } from '../lib/webdav'

/** A video of the library: from this device's own file, played as it is read; from the server, loaded whole (its
 * file needs the session's credential, which a <video> cannot send) and then played. */
const props = defineProps<{ item: ItemDetail }>()
const store = useStore()
const url = ref('')
const error = ref('')
const done = ref(0)
const total = ref(0)
const closer = ref<HTMLButtonElement | null>(null)
let blobUrl = ''
let stopper: AbortController | null = null

async function load() {
  error.value = ''
  stopper?.abort()
  stopper = new AbortController()
  try {
    if (isLocal(props.item.id) && store.shelf) {
      url.value = store.shelf.backend.url(props.item.id, 'f')
      return
    }
    const blob = await store.api.fileBlob(props.item.id, props.item.path, (d, all) => { done.value = d; total.value = all || props.item.size }, stopper.signal)
    blobUrl = URL.createObjectURL(blob)
    url.value = blobUrl
  } catch (err: any) {
    if (err?.name !== 'AbortError') error.value = t('No se pudo cargar el vídeo: {error}', { error: err?.message || String(err) })
  }
}

onMounted(() => {
  total.value = props.item.size || 0
  void nextTick(() => closer.value?.focus())
  void load()
})
onBeforeUnmount(() => {
  stopper?.abort()
  if (blobUrl) URL.revokeObjectURL(blobUrl)
})
</script>
