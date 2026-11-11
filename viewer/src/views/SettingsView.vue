<template>
  <section class="es-page es-settings">
    <header class="es-page-head"><h1 class="es-h1">{{ t('Ajustes') }}</h1></header>

    <h2 class="es-h2">{{ t('General') }}</h2>
    <div class="es-setting">
      <span class="es-setting-label">{{ t('Idioma') }}</span>
      <div class="es-seg">
        <button v-for="l in LANGUAGES" :key="l.id" type="button" class="es-btn" :class="{ on: app.language === l.id }" @click="app.language = l.id">{{ l.id === 'system' ? t(l.label) : l.label }}</button>
      </div>
    </div>
    <div class="es-setting">
      <span class="es-setting-label">{{ t('Al abrir la app') }}</span>
      <div class="es-seg">
        <button type="button" class="es-btn" :class="{ on: app.start === 'home' }" @click="app.start = 'home'">{{ t('Inicio') }}</button>
        <button type="button" class="es-btn" :class="{ on: app.start === 'library' }" @click="app.start = 'library'">{{ t('Estantería') }}</button>
      </div>
    </div>
    <label v-if="store.platform === 'android'" class="es-setting es-check">
      <input v-model="app.keepAwake" type="checkbox" />
      <span>{{ t('Mantener la pantalla encendida mientras lees') }}</span>
    </label>
    <label v-if="store.native?.volumeKeys" class="es-setting es-check">
      <input v-model="app.volumeKeys" type="checkbox" />
      <span>{{ t('Pasar página con las teclas de volumen') }}</span>
    </label>
    <label v-if="lockAvailable" class="es-setting es-check">
      <input v-model="app.lock" type="checkbox" />
      <span>{{ t('Bloquear la app con la huella, la cara o el PIN del dispositivo') }}</span>
    </label>

    <template v-if="store.appearance">
      <h2 class="es-h2">{{ t('Aspecto') }}</h2>
      <div class="es-setting">
        <span class="es-setting-label">{{ t('Tema') }}</span>
        <div class="es-seg" role="radiogroup" :aria-label="t('Tema')">
          <button v-for="th in THEMES" :key="th.id" type="button" class="es-btn" :class="{ on: store.appearance.theme.value === th.id }" role="radio"
                  :aria-checked="store.appearance.theme.value === th.id" @click="store.appearance!.setTheme(th.id)">
            <i class="es-i" :class="th.icon" aria-hidden="true"></i> {{ t(th.label) }}
          </button>
        </div>
      </div>
      <div class="es-setting">
        <span class="es-setting-label">{{ t('Portadas') }}</span>
        <div class="es-seg">
          <button v-for="c in COVERS" :key="c.id" type="button" class="es-btn" :class="{ on: app.covers === c.id }" @click="app.covers = c.id">{{ t(c.label) }}</button>
        </div>
      </div>
    </template>

    <h2 class="es-h2">{{ t('Estantería') }}</h2>
    <label class="es-setting es-check">
      <input v-model="app.hideFinished" type="checkbox" />
      <span>{{ t('Ocultar lo que ya has leído') }}</span>
    </label>
    <template v-if="store.shelf">
      <label class="es-setting es-check">
        <input v-model="app.scanOnStart" type="checkbox" />
        <span>{{ t('Buscar archivos nuevos en las carpetas del dispositivo al abrir la app') }}</span>
      </label>
      <div class="es-setting es-setting-block">
        <span class="es-setting-label">{{ t('Formatos que se listan de las carpetas del dispositivo') }}</span>
        <div class="es-formats">
          <label v-for="f in LOCAL_FORMATS" :key="f" class="es-check es-format">
            <input type="checkbox" :checked="!app.hiddenFormats.includes(f)" @change="toggleFormat(f, ($event.target as HTMLInputElement).checked)" />
            <span>{{ f.toUpperCase() }}</span>
          </label>
        </div>
      </div>
    </template>

    <template v-if="store.shelf || store.offline || store.downloadsFolder || store.native?.wifiOnly">
      <h2 class="es-h2">{{ t('Descargas y almacenamiento') }}</h2>
      <div v-if="store.downloadsFolder && folder" class="es-setting es-setting-block">
        <span class="es-setting-label">{{ t('Lo que descargas de los catálogos se guarda en') }}</span>
        <code class="es-path">{{ folder }}</code>
      </div>
      <label v-if="store.native?.wifiOnly" class="es-setting es-check">
        <input v-model="app.wifiOnly" type="checkbox" />
        <span>{{ t('Descargar solo con wifi (nunca con datos móviles)') }}</span>
      </label>
      <div v-if="store.offline || store.shelf" class="es-setting">
        <span class="es-setting-label">{{ t('Descargas') }}</span>
        <span class="es-muted">{{ plural(downloaded, '{n} elemento', '{n} elementos') }}</span>
        <a v-if="store.offline" href="#" class="es-btn es-small" @click.prevent="store.go({ v: 'downloads' })">{{ t('Ver') }}</a>
        <ConfirmButton v-if="downloaded" :label="t('Borrar todas')" icon="es-i-delete" :question="t('¿Borrar las {n} descargas?', { n: downloaded })" :action="clearDownloads" />
      </div>
      <div v-if="store.shelf" class="es-setting es-setting-block">
        <span class="es-setting-label">{{ t('Páginas preparadas') }}</span>
        <p class="es-muted es-small">{{ t('Lo abierto de cbr, cb7 y PDF de este dispositivo se guarda descomprimido para pasar de página al instante. Ocupa {size}; lo más antiguo se borra solo al pasar del máximo.', { size: sizeLabel(store.shelf.state.cacheBytes) }) }}</p>
        <div class="es-cache">
          <span>{{ t('Máximo') }}</span>
          <select class="es-select" :value="store.shelf.state.cacheLimit" @change="setLimit(Number(($event.target as HTMLSelectElement).value))">
            <option v-for="b in limits" :key="b" :value="b">{{ Math.round(b / 2 ** 30) }} GB</option>
          </select>
          <button class="es-btn es-small" :disabled="busy" @click="clearCache">{{ t('Vaciar') }}</button>
        </div>
      </div>
    </template>

    <h2 class="es-h2">{{ t('Copia de seguridad') }}</h2>
    <div class="es-setting es-setting-block">
      <p class="es-muted es-small">{{ t('Tu progreso, notas, subrayados y marcadores de lo que lees en este dispositivo, tus catálogos y estos ajustes, en un archivo. Las contraseñas de tus bibliotecas no van en él.') }}</p>
      <div class="es-cache">
        <button class="es-btn" :disabled="busy" @click="exportBackup"><i class="es-i es-i-download" aria-hidden="true"></i> {{ t('Exportar') }}</button>
        <button class="es-btn" :disabled="busy" @click="pickBackup?.click()"><i class="es-i es-i-refresh" aria-hidden="true"></i> {{ t('Importar…') }}</button>
        <input ref="pickBackup" type="file" accept="application/json,.json" hidden @change="importBackup" />
      </div>
    </div>

    <h2 class="es-h2">{{ t('Acerca de') }}</h2>
    <div v-if="store.version" class="es-setting">
      <span class="es-setting-label">{{ t('Versión') }}</span>
      <span class="es-muted">{{ store.version }}</span>
    </div>
    <div class="es-setting es-setting-block">
      <span class="es-setting-label">{{ t('Hecha con software libre') }}</span>
      <ul class="es-licenses">
        <li v-for="l in LICENSES" :key="l.name"><a :href="l.url" target="_blank" rel="noopener">{{ t(l.name) }}</a> <small class="es-muted">{{ l.license }}</small></li>
      </ul>
    </div>
  </section>
</template>

<script setup lang="ts">
import ConfirmButton from './ConfirmButton.vue'
import { clearAllDownloads, downloadsCount } from '../lib/downloads'
import { computed, onMounted, ref } from 'vue'
import type { Format } from '../lib/api'
import { LICENSES, appSettings as app, makeBackup, restoreBackup } from '../lib/appsettings'
import { LANGUAGES, plural, t } from '../lib/i18n'
import { CACHE_LIMITS, LOCAL_FORMATS } from '../lib/local'
import { sizeLabel, useStore, type Theme } from '../lib/store'

/** The app's own settings: where it opens, its look, what the shelf lists, downloads and space, the backup
 * and what it is made with. How each thing is read is set in its reader. */
const store = useStore()
const THEMES: { id: Theme; label: string; icon: string }[] = [
  { id: 'system', label: 'Como el sistema', icon: 'es-i-computer' }, { id: 'light', label: 'Claro', icon: 'es-i-sun' }, { id: 'dark', label: 'Oscuro', icon: 'es-i-moon' },
]
const COVERS = [{ id: 'small', label: 'Pequeñas' }, { id: 'medium', label: 'Medianas' }, { id: 'large', label: 'Grandes' }] as const

function toggleFormat(f: Format, shown: boolean) {
  app.hiddenFormats = shown ? app.hiddenFormats.filter((x) => x !== f) : [...app.hiddenFormats, f]
  store.refresh()
}

const folder = ref('')
/** the lock is offered only when the device has one set up */
const lockAvailable = ref(false)
onMounted(async () => {
  try { folder.value = (await store.downloadsFolder?.()) || '' } catch (_) { /* unknown */ }
  try { lockAvailable.value = !!(await store.native?.lock?.available()) } catch (_) { /* none */ }
})

const busy = ref(false)
const limits = computed(() => [...new Set([...CACHE_LIMITS, store.shelf?.state.cacheLimit || CACHE_LIMITS[1]])].sort((a, b) => a - b))
async function work(job: () => Promise<unknown>, done?: string) {
  busy.value = true
  try {
    await job()
    if (done) store.notify(done)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = false
}
function setLimit(bytes: number) { return work(() => store.shelf!.setCacheLimit(bytes)) }
function clearCache() { return work(() => store.shelf!.clearCache(), t('Vaciado.')) }

// ---- the backup ----
const pickBackup = ref<HTMLInputElement>()
function exportBackup() {
  return work(async () => {
    const name = `copia-la-estanteria-${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([JSON.stringify(makeBackup(), null, 1)], { type: 'application/json' })
    if (store.net && store.platform !== 'web') {
      const where = await store.net.save(name, blob)
      store.notify(t('Copia guardada: {where}', { where: decodeURIComponent(where.replace(/^file:\/\//, '')) }))
    } else {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    }
  })
}
async function importBackup(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  await work(async () => {
    const n = restoreBackup(await file.text())
    store.notify(plural(n, 'Copia restaurada ({n} dato): la app se vuelve a abrir.', 'Copia restaurada ({n} datos): la app se vuelve a abrir.'))
    setTimeout(() => window.location.reload(), 1200)
  })
}

// ---- everything downloaded: how much, and all of it deleted (asked first) ----
const downloaded = computed(() => downloadsCount(store))
async function clearDownloads() {
  const n = await clearAllDownloads(store)
  store.notify(plural(n, '{n} descarga borrada.', '{n} descargas borradas.'))
  store.refresh()
}
</script>
