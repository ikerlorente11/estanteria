<template>
  <div class="es-filebtn" ref="root">
    <!-- not on this device yet: one button, «Descargar» -->
    <button v-if="!have" class="es-btn" :disabled="!canDownload" :title="hint" @click="download">
      <span v-if="busy" class="es-spin"></span><i v-else class="es-i es-i-download" aria-hidden="true"></i>
      {{ label }}
    </button>
    <!-- on this device: what to do with it -->
    <button v-else class="es-btn es-btn-done" aria-haspopup="menu" :aria-expanded="open" :disabled="!!working" @click="toggle">
      <span v-if="working" class="es-spin"></span><i v-else class="es-i" :class="local ? 'es-i-page' : 'es-i-check'" aria-hidden="true"></i>
      {{ working === 'share' ? t('Preparando…') : working === 'save' ? t('Guardando…') : local ? t('Archivo') : t('Descargado') }}
      <i class="es-i es-i-chevron" aria-hidden="true"></i>
    </button>
    <div v-if="open" class="es-fab-menu es-file-menu" :class="{ 'es-file-menu-end': toEnd }" role="menu" @click.stop>
      <button v-if="canSave" class="es-fab-item" role="menuitem" :disabled="!!working" @click="saveAs">
        <span class="es-fab-icon"><i class="es-i es-i-download" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Guardar en el dispositivo') }}<i v-if="savedAt" class="es-i es-i-check es-saved-mark" aria-hidden="true"></i></strong>
          <small class="es-muted">{{ savedAt ? t('Ya guardado el {date}; otra copia donde elijas', { date: savedAt }) : t('Una copia donde tú elijas') }}</small></span>
      </button>
      <button v-if="canShare" class="es-fab-item" role="menuitem" :disabled="!!working" @click="share">
        <span class="es-fab-icon"><i class="es-i es-i-share" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Compartir') }}</strong><small class="es-muted">{{ t('Enviarlo a quien quieras o a otra app') }}</small></span>
      </button>
      <button v-if="canUpload" class="es-fab-item" role="menuitem" @click="close(); emit('upload')">
        <span class="es-fab-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Subir a {server}', { server: serverLabel(store) }) }}</strong><small class="es-muted">{{ t('Para tenerlo en tu servidor') }}</small></span>
      </button>
      <button v-if="local && store.platform !== 'android'" class="es-fab-item" role="menuitem" @click="close(); emit('reveal')">
        <span class="es-fab-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Mostrar en el Explorador') }}</strong></span>
      </button>
      <button v-if="canDelete" class="es-fab-item es-fab-danger" role="menuitem" @click="remove">
        <span class="es-fab-icon"><i class="es-i es-i-delete" aria-hidden="true"></i></span>
        <span class="es-fab-text"><strong>{{ t('Borrar') }}</strong><small class="es-muted">{{ local ? t('Quitarlo de la estantería (lo descargado de un catálogo se borra)') : t('Borrar la descarga de este dispositivo') }}</small></span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { ItemDetail } from '../lib/api'
import { keptAsFile } from '../lib/offline'
import { DOWNLOADS_ROOT, LOOSE_ROOT } from '../lib/local'
import { forgetCatalogItems } from '../lib/catalogdownloads'
import { t } from '../lib/i18n'
import type { FileToHand } from '../lib/native'
import { serverLabel, useStore } from '../lib/store'

/**
 * The file of an item, in one button: «Descargar» while it is not on this device (a copy kept to read it
 * without connection), and once it is (or when it is a file of this device), a menu of what to do with it:
 * save it where one wants, share it, upload it to the server, delete it.
 * On the web (no copies kept) «Descargar» is the browser's download.
 */
const props = defineProps<{ item: ItemDetail; local: boolean }>()
const emit = defineEmits<{ upload: []; reveal: []; removed: [] }>()
const store = useStore()
const open = ref(false)
/** what is being done with it now (the button says so: copying a big file takes a moment) */
const working = ref<'' | 'save' | 'share'>('')
const root = ref<HTMLElement>()

const offline = computed(() => store.offline)
const status = computed(() => offline.value?.status(props.item.id) || '')
const busy = computed(() => status.value === 'running' || status.value === 'waiting')
const have = computed(() => props.local || status.value === 'done')
const canDownload = computed(() => props.item.format !== 'folder')

const percent = computed(() => {
  const job = offline.value?.state.jobs[props.item.id]
  return job?.total ? Math.round((job.done / job.total) * 100) : 0
})
const label = computed(() => busy.value ? t('Descargando {percent} %', { percent: percent.value }) : status.value === 'error' ? t('Reintentar la descarga') : t('Descargar'))
const hint = computed(() => {
  if (busy.value) return t('Pulsa para pararla')
  const error = offline.value?.state.jobs[props.item.id]?.error
  return error ? t('No se pudo: {error}', { error }) : offline.value ? t('Lo guarda en este dispositivo para leerlo sin conexión') : ''
})

const MIME: Record<string, string> = {
  cbz: 'application/vnd.comicbook+zip', cbr: 'application/vnd.comicbook-rar', cb7: 'application/x-7z-compressed', cbt: 'application/x-tar',
  pdf: 'application/pdf', djvu: 'image/vnd.djvu', epub: 'application/epub+zip', mobi: 'application/x-mobipocket-ebook',
  fb2: 'application/x-fictionbook+xml', fbz: 'application/zip', txt: 'text/plain',
}
/** where the file is read: a file of this device or a kept book, else the original from the server */
function file(): FileToHand {
  const path = store.api.filePath(props.item.id)
  const kept = offline.value?.local(path)
  const src = kept || path
  return {
    name: props.item.name,
    mime: MIME[props.item.format] || 'application/octet-stream',
    src,
    blob: async () => {
      if (!kept) return store.api.blob(path)
      const r = await fetch(kept)
      if (!r.ok) throw new Error(t('No se pudo leer el archivo ({status})', { status: r.status }))
      return r.blob()
    },
  }
}
/** a comic or a PDF kept for reading offline is its pages, not the file: the original comes from the server */
const needsServer = computed(() => !props.local && !keptAsFile(props.item))
const canSave = computed(() => true)
const canShare = computed(() => !!store.native?.share || (typeof navigator.share === 'function' && typeof navigator.canShare === 'function'))
const canUpload = computed(() => !!store.state.server && (props.local || !!props.item.source_id))
/** a file of the device: those added on their own and the downloads (a file of one's folders stays) */
const canDelete = computed(() => props.local ? props.item.source_id === -LOOSE_ROOT || props.item.source_id === -DOWNLOADS_ROOT : status.value === 'done')

async function download() {
  const o = offline.value
  if (!o) { await browserDownload(); return }
  if (busy.value) { await o.remove(props.item.id); return }
  o.add([props.item])
}

async function browserDownload() {
  try {
    const blob = await file().blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = props.item.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}

function failed(err: any) {
  const offlineNow = offline.value?.state.online === false
  store.notify(needsServer.value && offlineNow ? t('Para eso hace falta conexión: la copia sin conexión de un cómic o un PDF son sus páginas, no el archivo.') : err?.message || String(err), true)
}

// ---- saved to the device: remembered, so the menu says it (where it went is the system's to know) ----
const SAVED_KEY = 'estanteria.saved'
const saved = ref<Record<number, number>>((() => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || '{}') } catch (_) { return {} } })())
const savedAt = computed(() => {
  const at = saved.value[props.item.id]
  return at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''
})
function rememberSaved() {
  saved.value = { ...saved.value, [props.item.id]: Date.now() }
  try { localStorage.setItem(SAVED_KEY, JSON.stringify(saved.value)) } catch (_) { /* this session only */ }
}

async function saveAs() {
  close()
  working.value = 'save'
  try {
    if (store.native?.saveAs) {
      if (await store.native.saveAs(file())) { rememberSaved(); store.notify(t('Guardado en el dispositivo.')) }
    } else await browserDownload()
  } catch (err: any) { failed(err) }
  working.value = ''
}

async function share() {
  close()
  working.value = 'share'
  try {
    if (store.native?.share) await store.native.share(file())
    else {
      const f = file()
      const shared = new File([await f.blob()], f.name, { type: f.mime })
      if (!navigator.canShare({ files: [shared] })) throw new Error(t('Este navegador no deja compartir archivos.'))
      await navigator.share({ files: [shared], title: props.item.title })
    }
  } catch (err: any) { if (err?.name !== 'AbortError') failed(err) }
  working.value = ''
}

async function remove() {
  close()
  try {
    if (props.local) {
      await store.shelf?.removeFile(props.item.id)
      forgetCatalogItems([props.item.id])
      store.notify(t('Quitado de la estantería.'))
      // listed again before going back, so the list is not the old one for a moment
      await store.refresh()
      emit('removed')
    } else {
      await offline.value?.remove(props.item.id)
      store.notify(t('Descarga borrada de este dispositivo.'))
    }
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}

function close() { open.value = false }
/** the menu opens towards where there is room: from the button's right edge when it is on the right half */
const toEnd = ref(false)
function toggle() {
  const box = root.value?.getBoundingClientRect()
  toEnd.value = !!box && box.left + 300 > window.innerWidth - 8
  open.value = !open.value
}
// a tap anywhere else closes the menu
const outside = (e: Event) => { if (open.value && root.value && !root.value.contains(e.target as Node)) close() }
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
