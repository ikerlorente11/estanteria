<template>
  <button class="es-btn es-fav" :class="{ 'es-fav-on': on, 'es-small': small }" :aria-pressed="on"
          :title="on ? t('Quitar de favoritos') : t('Añadir a favoritos')" @click.stop="toggle">
    <i class="es-i" :class="on ? 'es-i-star-fill' : 'es-i-star'" aria-hidden="true"></i>
    <template v-if="!small"> {{ on ? t('En favoritos') : t('Favorito') }}</template>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { isFavorite, setFavorite, useSync, type Favorite } from '../lib/favorites'
import { t } from '../lib/i18n'
import { useStore } from '../lib/store'

/** The star of a series, a file or a series of a catalog: on, it is in «Favoritos» (on every device). */
const props = defineProps<{ fav: { key: string; value: Favorite; onlyHere?: boolean }; small?: boolean }>()
const store = useStore()
useSync(store)
const on = computed(() => isFavorite(props.fav.key))
function toggle() {
  setFavorite(props.fav.key, on.value ? null : props.fav.value, props.fav.onlyHere)
  store.notify(on.value ? t('En favoritos.') : t('Quitado de favoritos.'))
}
</script>
