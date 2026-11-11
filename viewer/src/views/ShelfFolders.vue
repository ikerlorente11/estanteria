<template>
  <div v-if="shelf" class="es-shelf-folders">
    <p class="es-muted es-small">{{ t('Los cómics (cbz, cbr, cb7, cbt), documentos (pdf, djvu) y libros (epub, mobi, azw3, fb2, fbz, txt) de estas carpetas aparecen en tu estantería con sus subcarpetas. Se leen aquí mismo, sin copiarlos; el progreso y las notas se guardan en este dispositivo. Lo que abres desde otra app (o arrastras a la ventana) se queda en «Archivos sueltos».') }}</p>
    <p v-if="shelf.state.error" class="es-banner es-banner-error">{{ shelf.state.error }}</p>
    <ul class="es-sources">
      <li v-for="s in roots" :key="s.id" class="es-source">
        <span class="es-source-icon"><i class="es-i es-i-computer" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ s.name }}</strong>
          <small v-if="s.url" class="es-muted es-ellipsis es-path">{{ s.url }}</small>
          <small class="es-muted">{{ plural(s.items, '{n} archivo', '{n} archivos') }}</small>
        </span>
        <span class="es-source-actions">
          <a href="#" class="es-btn es-small" @click.prevent="store.go({ v: 'library', source: String(s.id) })">{{ t('Ver') }}</a>
          <button class="es-btn es-small" :disabled="shelf.state.scanning || busy" :title="t('Mirar otra vez qué hay')" @click="rescan"><span v-if="shelf.state.scanning" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i></button>
          <button v-if="s.id !== -1" class="es-btn es-small" :disabled="busy" :title="t('Cambiar el nombre')" @click="rename(s)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
          <button v-if="s.id !== -1" class="es-btn es-small" :disabled="busy" :title="t('Quitar de la estantería (la carpeta no se toca)')" @click="remove(s)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
        </span>
      </li>
      <li v-if="!roots.length" class="es-source es-muted">{{ t('Ninguna todavía: añade una con el botón +.') }}</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Source } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { useStore } from '../lib/store'

/** The folders of this device on the shelf (and «Archivos sueltos»): see, rescan, rename or remove them. */
const store = useStore()
const shelf = computed(() => store.shelf || null)
const roots = computed(() => (shelf.value ? shelf.value.sources() : []))
const busy = ref(false)

async function work(job: () => Promise<unknown>, done?: string) {
  busy.value = true
  try {
    await job()
    await store.refresh()
    if (done) store.notify(done)
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = false
}
function rescan() { return work(() => shelf.value!.scan()) }
function remove(s: Source) { return work(() => shelf.value!.removeRoot(-s.id), t('«{name}» ya no está en tu estantería (la carpeta sigue en su sitio).', { name: s.name })) }
function rename(s: Source) {
  const name = window.prompt(t('Nombre de la carpeta en tu estantería'), s.name)?.trim()
  if (name && name !== s.name) return work(() => shelf.value!.renameRoot(-s.id, name))
}
</script>
