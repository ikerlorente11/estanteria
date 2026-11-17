<template>
  <div class="es-tg-video" role="dialog" :aria-label="title" @keydown.esc="emit('close')">
    <header class="es-tg-video-head">
      <strong class="es-ellipsis">{{ title }}</strong>
      <span class="es-grow"></span>
      <button ref="closer" class="es-btn es-small" :title="t('Cerrar')" @click="emit('close')"><i class="es-i es-i-close" aria-hidden="true"></i></button>
    </header>
    <div class="es-tg-video-body">
      <video v-if="url" class="es-tg-video-player" :src="url" controls autoplay playsinline></video>
      <div v-else class="es-tg-video-wait">
        <template v-if="error">
          <p class="es-source-bad">{{ error }}</p>
          <button class="es-btn" @click="load(true)">{{ t('Reintentar') }}</button>
        </template>
        <template v-else-if="askBig">
          <p>{{ t('Este vídeo ocupa {size}: se carga entero en la memoria antes de verse.', { size: sizeText(size) }) }}</p>
          <button class="es-btn es-primary" @click="load(true)">{{ t('Cargarlo igualmente') }}</button>
        </template>
        <template v-else>
          <p><span class="es-spin"></span> {{ size ? t('Cargando el vídeo… {done} de {size}', { done: sizeText(done) || '0 KB', size: sizeText(size) }) : t('Pidiendo el vídeo a Telegram…') }}</p>
          <progress v-if="size" class="es-tg-video-bar" :value="done" :max="size"></progress>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { isCancelled } from '../lib/catalogdownloads'
import { t } from '../lib/i18n'
import { telegramError, type TelegramLink } from '../lib/telegram'
import { sizeText } from '../lib/webdav'

/** A video of a Telegram chat, seen right here: loaded into memory (nothing is saved) and played once whole. */
const props = defineProps<{ link: TelegramLink; peer: string; message: number; title: string }>()
const emit = defineEmits<{ (e: 'close'): void }>()

/** bigger than this, it asks first (the whole video stays in memory while it is seen) */
const BIG = 500 * 2 ** 20

const url = ref('')
const error = ref('')
const askBig = ref(false)
const size = ref(0)
const done = ref(0)
const closer = ref<HTMLButtonElement | null>(null)
let stopper: AbortController | null = null

async function load(anyway = false) {
  error.value = ''
  askBig.value = false
  stopper?.abort()
  stopper = new AbortController()
  const signal = stopper.signal
  try {
    const file = await props.link.file(props.peer, props.message)
    size.value = file.size
    if (file.size > BIG && !anyway) { askBig.value = true; return }
    const pieces: Uint8Array[] = []
    done.value = 0
    for await (const piece of file.read(signal)) {
      pieces.push(piece)
      done.value += piece.length
    }
    url.value = URL.createObjectURL(new Blob(pieces as BlobPart[], { type: file.mime.startsWith('video/') ? file.mime : 'video/mp4' }))
  } catch (err) {
    if (!isCancelled(err) && !signal.aborted) error.value = t('No se pudo cargar el vídeo: {error}', { error: telegramError(err) })
  }
}

onMounted(() => {
  void nextTick(() => closer.value?.focus())
  void load()
})
onBeforeUnmount(() => {
  stopper?.abort()
  if (url.value) URL.revokeObjectURL(url.value)
})
</script>
