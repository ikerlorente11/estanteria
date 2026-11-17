<template>
  <form class="es-form es-tg-save" @submit.prevent="save">
    <p v-if="video" class="es-muted es-small">{{ t('Se guarda el vídeo {where}.', { where }) }}</p>
    <p v-else class="es-muted es-small">{{ plural(messages.length, 'Se guarda {n} imagen como un cómic (CBZ): {where}.', 'Se guardan {n} imágenes como un cómic (CBZ), en orden: {where}.', { where }) }}</p>
    <label>{{ t('Nombre') }} <input v-model="name" type="text" required maxlength="140" :disabled="busy" /></label>

    <fieldset class="es-tg-save-cols" :disabled="busy">
      <legend>{{ t('En las colecciones') }} <small class="es-muted">{{ t('(opcional)') }}</small></legend>
      <label v-for="c in all" :key="c.id" class="es-multipick-item">
        <input type="checkbox" :checked="chosen.includes(c.id)" @change="toggle(c.id)" />
        <span class="es-ellipsis">{{ c.name }}</span>
      </label>
      <div class="es-col-new">
        <input v-model="newName" type="text" maxlength="80" :placeholder="t('Nueva colección…')" :aria-label="t('Nueva colección')" @keydown.enter.prevent="add" />
        <button class="es-btn es-small" type="button" :disabled="!newName.trim()" @click="add"><i class="es-i es-i-add" aria-hidden="true"></i></button>
      </div>
    </fieldset>

    <p v-if="busy" class="es-muted"><span class="es-spin"></span> {{ status }}</p>
    <p v-if="error" class="es-source-bad">{{ error }}</p>
    <div class="es-form-actions">
      <button class="es-btn es-primary" type="submit" :disabled="busy || !name.trim()"><i class="es-i es-i-download" aria-hidden="true"></i> {{ t('Guardar') }}</button>
      <button class="es-btn" type="button" @click="cancel">{{ t('Cancelar') }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { CatalogMeta } from '../lib/catalogdownloads'
import { isCancelled } from '../lib/catalogdownloads'
import { fileName } from '../lib/catalogs'
import { collections, createCollection, setInCollection } from '../lib/collections'
import { itemFavorite } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { keeperOf, serverKeeper, type Keeper } from '../lib/keeper'
import { serverLabel, useStore } from '../lib/store'
import { blobSource, photosComicInfo, telegramError, telegramPhotosCbz, type TelegramLink } from '../lib/telegram'

/** Images of a Telegram chat kept as a comic (a CBZ, in the order given), or a video of it (`video`: `messages` has
 * it alone), where what comes from catalogs is kept (the Archivador, or this device), and put in the collections
 * chosen. A video goes to the Archivador only for now (the shelf of a device does not take videos yet), with
 * Telegram's thumbnail as its cover. */
const props = defineProps<{ link: TelegramLink; peer: string; messages: number[]; chat: string; suggested: string; date?: number; video?: boolean }>()
const emit = defineEmits<{ (e: 'done'): void; (e: 'cancel'): void }>()
const store = useStore()

const name = ref(props.suggested)
const newName = ref('')
const all = computed(() => collections())
const chosen = ref<string[]>([])
const busy = ref(false)
const status = ref('')
const error = ref('')
let stopper: AbortController | null = null

const keeper = computed<Keeper | null>(() => {
  if (!props.video) return keeperOf(store)
  // a video: to the Archivador (the web's keeper is that already; an app's would put it on the device)
  if (!store.state.server) return null
  return store.keeper?.where === 'server' ? store.keeper : serverKeeper(store.api, store.state)
})
const where = computed(() => keeper.value?.where === 'server' || store.state.server ? t('en {server}', { server: serverLabel(store) }) : t('en este dispositivo'))

function toggle(id: string) {
  chosen.value = chosen.value.includes(id) ? chosen.value.filter((c) => c !== id) : [...chosen.value, id]
}
function add() {
  const clean = newName.value.trim()
  if (!clean) return
  const id = createCollection(clean)
  if (!chosen.value.includes(id)) chosen.value = [...chosen.value, id]
  newName.value = ''
}

async function save() {
  const keep = keeper.value
  if (!keep) {
    error.value = props.video ? t('Para guardar vídeos hace falta estar conectado a tu servidor (en el dispositivo aún no se guardan).')
      : t('Esta versión no puede guardar archivos en el dispositivo.')
    return
  }
  if (props.video) return saveVideo(keep)
  const title = name.value.trim()
  if (!title) return
  busy.value = true
  error.value = ''
  stopper = new AbortController()
  const signal = stopper.signal
  try {
    // its series: the first collection chosen (where the rest of it will be), else the chat
    const first = all.value.find((c) => c.id === chosen.value[0])
    const series = first?.name || props.chat
    const meta: CatalogMeta = { series, kind: 'comic', title }
    const info = photosComicInfo({ title, series, chat: props.chat, pages: props.messages.length, date: props.date })
    const cbz = await telegramPhotosCbz(props.link, props.peer, props.messages, info,
      (done, total) => { status.value = t('Bajando las imágenes… {done} de {total}', { done, total }) }, signal)
    status.value = t('Guardando…')
    const ids = props.messages
    const key = `tgset:${props.link.account?.id || ''}/${props.peer}/${ids[0]}-${ids[ids.length - 1]}-${ids.length}`
    const id = await keep.stream(key, blobSource(cbz), fileName(title, 'cbz'), meta, () => {}, signal)
    await store.refresh()
    let item = await keep.item(id)
    // an app with the Archivador: in the collections with the server's copy, so that every device has it
    if (item && keep.uploaded && store.state.server && chosen.value.length) {
      status.value = t('Subiendo a {server}…', { server: serverLabel(store) })
      item = (await keep.uploaded(id)) || item
    }
    if (item) for (const c of chosen.value) setInCollection(c, itemFavorite(item), true)
    const names = all.value.filter((c) => chosen.value.includes(c.id)).map((c) => `«${c.name}»`).join(', ')
    store.notify(names ? t('«{title}» guardado, en {names}.', { title, names }) : t('«{title}» guardado.', { title }))
    emit('done')
  } catch (err) {
    if (!isCancelled(err) && !signal.aborted) error.value = t('No se pudo guardar: {error}', { error: telegramError(err) })
  } finally {
    busy.value = false
  }
}

async function saveVideo(keep: Keeper) {
  const title = name.value.trim()
  busy.value = true
  error.value = ''
  stopper = new AbortController()
  const signal = stopper.signal
  try {
    const first = all.value.find((c) => c.id === chosen.value[0])
    const message = props.messages[0]
    const file = await props.link.file(props.peer, message)
    // its extension: its own name's, else its type's (a video sent as such has no name)
    const own = file.name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || ''
    const ext = /^(mp4|m4v|webm|mkv|mov)$/.test(own) ? own : file.mime.includes('webm') ? 'webm' : file.mime.includes('matroska') ? 'mkv' : file.mime.includes('quicktime') ? 'mov' : 'mp4'
    const meta: CatalogMeta = { series: first?.name || props.chat, kind: 'video', title }
    const key = `tg:${props.link.account?.id || ''}/${props.peer}/${message}`
    const clean = title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140) || 'Vídeo'
    const id = await keep.stream(key, file, `${clean}.${ext}`, meta,
      (done, total) => { status.value = t('Guardando el vídeo… {percent} %', { percent: total ? Math.round((done / total) * 100) : 0 }) }, signal)
    // its cover: the thumbnail Telegram has of it
    const thumb = await props.link.thumb(props.peer, message).catch(() => null)
    if (thumb) await store.api.setCover(id, await (await fetch(thumb)).blob()).catch(() => {})
    await store.refresh()
    const item = await keep.item(id)
    if (item) for (const c of chosen.value) setInCollection(c, itemFavorite(item), true)
    const names = all.value.filter((c) => chosen.value.includes(c.id)).map((c) => `«${c.name}»`).join(', ')
    store.notify(names ? t('«{title}» guardado, en {names}.', { title, names }) : t('«{title}» guardado.', { title }))
    emit('done')
  } catch (err) {
    if (!isCancelled(err) && !signal.aborted) error.value = t('No se pudo guardar: {error}', { error: telegramError(err) })
  } finally {
    busy.value = false
  }
}

function cancel() {
  stopper?.abort()
  emit('cancel')
}
onBeforeUnmount(() => stopper?.abort())
</script>
