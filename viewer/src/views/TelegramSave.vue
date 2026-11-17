<template>
  <form class="es-form es-tg-save" @submit.prevent="save">
    <p class="es-muted es-small">
      <template v-if="mode === 'photos'">{{ plural(entries.length, 'Se guarda {n} imagen como un cómic (CBZ): {where}.', 'Se guardan {n} imágenes como un cómic (CBZ), en orden: {where}.', { where }) }}</template>
      <template v-else-if="mode === 'videos'">{{ plural(entries.length, 'Se guarda {n} vídeo, con su nombre, {where}.', 'Se guardan {n} vídeos, cada uno con su nombre, {where}.', { where }) }}</template>
      <template v-else>{{ plural(entries.length, 'Se guarda {n} archivo {where}, como al descargarlo.', 'Se guardan {n} archivos {where}, como al descargarlos.', { where }) }}</template>
    </p>
    <label v-if="named">{{ t('Nombre') }} <input v-model="name" type="text" required maxlength="140" :disabled="busy" /></label>

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
      <button class="es-btn es-primary" type="submit" :disabled="busy || (named && !name.trim())"><i class="es-i es-i-download" aria-hidden="true"></i> {{ t('Guardar') }}</button>
      <button class="es-btn" type="button" @click="cancel">{{ t('Cancelar') }}</button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { Item } from '../lib/api'
import { cancelCatalogDownloads, isCancelled, runCatalogDownload, type CatalogKind, type CatalogMeta } from '../lib/catalogdownloads'
import { bestFormat, fileName } from '../lib/catalogs'
import { collections, createCollection, setInCollection } from '../lib/collections'
import { itemFavorite, useSync } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { keeperOf, serverKeeper, type Keeper } from '../lib/keeper'
import { seriesOfTitle } from '../lib/local'
import type { FeedEntry } from '../lib/opds'
import { serverLabel, useStore } from '../lib/store'
import { blobSource, parseFileHref, photosComicInfo, telegramError, telegramPhotosCbz, type TelegramLink } from '../lib/telegram'

/**
 * What was chosen of a Telegram chat, kept where what comes from catalogs is kept and put in the collections chosen:
 *  - `photos`: the images as one comic (a CBZ, oldest first) with the name given;
 *  - `videos`: each video with its own name, in the Archivador (a device's shelf does not take videos yet), with
 *    Telegram's thumbnail as its cover;
 *  - `files`: each document as when it is downloaded (the same key: shown as kept; one kept already is not fetched again).
 */
const props = defineProps<{ link: TelegramLink; mode: 'photos' | 'videos' | 'files'; entries: FeedEntry[]; chat: string; suggested?: string; date?: number }>()
const emit = defineEmits<{ (e: 'done'): void; (e: 'cancel'): void }>()
const store = useStore()
// the collections are the account's (sync.ts): its book has to be there, also when one came straight to a chat
useSync(store)

const named = computed(() => props.mode === 'photos')
const name = ref(props.suggested || '')
const newName = ref('')
const all = computed(() => collections())
const chosen = ref<string[]>([])
const busy = ref(false)
const status = ref('')
const error = ref('')
let stopper: AbortController | null = null

const keeper = computed<Keeper | null>(() => {
  if (props.mode !== 'videos') return keeperOf(store)
  // videos: to the Archivador (the web's keeper is that already; an app's would put them on the device)
  if (!store.state.server) return null
  return store.keeper?.where === 'server' ? store.keeper : serverKeeper(store.api, store.state)
})
const where = computed(() => keeper.value?.where === 'server' || store.state.server ? t('en {server}', { server: serverLabel(store) }) : t('en este dispositivo'))
const firstCollection = () => all.value.find((c) => c.id === chosen.value[0])?.name

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

/** In the collections chosen; an app with the Archivador waits for the server's copy, so that every device has it. */
async function intoCollections(keep: Keeper, id: number): Promise<void> {
  if (!chosen.value.length) return
  let item: Item | null = await keep.item(id)
  if (item && keep.uploaded && store.state.server) item = (await keep.uploaded(id)) || item
  if (item) for (const c of chosen.value) setInCollection(c, itemFavorite(item), true)
}

const clean = (text: string) => text.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140)
const peerOf = (e: FeedEntry) => parseFileHref(e.id)!.peer
const messageOf = (e: FeedEntry) => parseFileHref(e.id)!.message

async function save() {
  const keep = keeper.value
  if (!keep) {
    error.value = props.mode === 'videos' ? t('Para guardar vídeos hace falta estar conectado a tu servidor (en el dispositivo aún no se guardan).')
      : t('Esta versión no puede guardar archivos en el dispositivo.')
    return
  }
  busy.value = true
  error.value = ''
  stopper = new AbortController()
  const signal = stopper.signal
  try {
    if (props.mode === 'photos') await savePhotos(keep, signal)
    else await saveEach(keep, signal)
    await store.refresh()
    const names = all.value.filter((c) => chosen.value.includes(c.id)).map((c) => `«${c.name}»`).join(', ')
    const what = props.mode === 'photos' ? `«${name.value.trim()}»` : plural(props.entries.length, '{n} cosa', '{n} cosas')
    store.notify(names ? t('{what} guardado, en {names}.', { what, names }) : t('{what} guardado.', { what }))
    emit('done')
  } catch (err) {
    if (!isCancelled(err) && !signal.aborted) error.value = t('No se pudo guardar: {error}', { error: telegramError(err) })
  } finally {
    busy.value = false
  }
}

async function savePhotos(keep: Keeper, signal: AbortSignal) {
  const title = name.value.trim()
  const messages = props.entries.map(messageOf).sort((a, b) => a - b)
  const peer = peerOf(props.entries[0])
  // its series: the first collection chosen (where the rest of it will be), else the chat
  const series = firstCollection() || props.chat
  const meta: CatalogMeta = { series, kind: 'comic', title }
  const info = photosComicInfo({ title, series, chat: props.chat, pages: messages.length, date: props.date })
  const cbz = await telegramPhotosCbz(props.link, peer, messages, info,
    (done, total) => { status.value = t('Bajando las imágenes… {done} de {total}', { done, total }) }, signal)
  status.value = t('Guardando…')
  const key = `tgset:${props.link.account?.id || ''}/${peer}/${messages[0]}-${messages[messages.length - 1]}-${messages.length}`
  const id = await keep.stream(key, blobSource(cbz), fileName(title, 'cbz'), meta, () => {}, signal)
  if (chosen.value.length) status.value = t('Subiendo a {server}…', { server: serverLabel(store) })
  await intoCollections(keep, id)
}

/** videos and files: one after another, each as it is downloaded (its progress shows on it in the list too) */
async function saveEach(keep: Keeper, signal: AbortSignal) {
  for (const [i, e] of props.entries.entries()) {
    if (signal.aborted) return
    status.value = t('Guardando {n} de {total}…', { n: i + 1, total: props.entries.length })
    const key = e.id                                     // its address: the same key as a download of it
    let id = keep.gotOf(key)
    if (id === undefined) {
      const peer = peerOf(e)
      const message = messageOf(e)
      if (props.mode === 'videos') {
        const title = clean(e.summary?.split('\n')[0] || e.title || props.chat) || t('Vídeo')
        const meta: CatalogMeta = { series: firstCollection() || props.chat, kind: 'video', title }
        id = await runCatalogDownload(key, title, meta, 'bytes', async (progress, sig) => {
          const file = await props.link.file(peer, message)
          // its extension: its own name's, else its type's (a video sent as such has no name)
          const own = file.name.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase() || ''
          const ext = /^(mp4|m4v|webm|mkv|mov)$/.test(own) ? own
            : file.mime.includes('webm') ? 'webm' : file.mime.includes('matroska') ? 'mkv' : file.mime.includes('quicktime') ? 'mov' : 'mp4'
          return keep.stream(key, file, `${title}.${ext}`, meta, progress, sig)
        })
        // its cover: the thumbnail Telegram has of it
        const thumb = await props.link.thumb(peer, message).catch(() => null)
        if (thumb) await store.api.setCover(id, await (await fetch(thumb)).blob()).catch(() => {})
      } else {
        const offer = bestFormat(e.offers)
        if (!offer?.format) continue
        const kind: CatalogKind = ['cbz', 'cbr', 'cb7', 'cbt'].includes(offer.format) ? 'comic' : 'book'
        const meta: CatalogMeta = { series: seriesOfTitle(e.title), kind, title: e.title }
        id = await runCatalogDownload(key, e.title, meta, 'bytes', async (progress, sig) =>
          keep.stream(key, await props.link.file(peer, message), fileName(e.title, offer.format!), meta, progress, sig))
      }
    }
    await intoCollections(keep, id)
  }
}

function cancel() {
  stopper?.abort()
  // what was going of them (each one is a download of its own) stops too
  if (busy.value) cancelCatalogDownloads(props.entries.map((e) => e.id))
  emit('cancel')
}
onBeforeUnmount(() => stopper?.abort())
</script>
