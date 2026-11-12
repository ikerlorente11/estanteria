<template>
  <DeviceCatalogView v-if="device" :key="device.id" :def="device" :path="path" :q="q" />
  <section v-else class="es-page">
    <header class="es-page-head">
      <div class="es-page-title">
        <p class="es-muted es-small es-crumbs"><a href="#" @click.prevent="go({ v: 'catalogs' })">{{ t('Catálogos') }}</a></p>
        <h1 class="es-h1">{{ t('Catálogo') }}</h1>
      </div>
    </header>
    <p class="es-muted">{{ t('Ese catálogo ya no está entre los tuyos: añádelo otra vez en Catálogos.') }}</p>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { t } from '../lib/i18n'
import { useStore } from '../lib/store'
import DeviceCatalogView from './DeviceCatalogView.vue'

/** A catalog: one the app reads by itself (an included one, one of a repository, a library's, a Suwayomi source). */
const props = defineProps<{ kind: string; path?: string; q?: string }>()
const store = useStore()
const { go } = store
const device = computed(() => store.catalogs?.get(props.kind) || null)
</script>
