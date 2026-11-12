<template>
  <template v-if="followState.list.length">
    <header class="es-page-head es-subhead">
      <button class="es-collapse" :aria-expanded="!isCollapsed('follows')" @click="toggleCollapsed('follows')">
        <i class="es-i es-i-chevron" :class="{ 'es-collapse-closed': isCollapsed('follows') }" aria-hidden="true"></i>
        <h2 class="es-h2">{{ t('Series que sigues') }}</h2>
        <span class="es-chip-count">{{ followState.list.length }}</span>
        <span v-if="newOnes" class="es-chip-count es-follow-new">{{ plural(newOnes, '{n} nuevo', '{n} nuevos') }}</span>
      </button>
    </header>
    <template v-if="!isCollapsed('follows')">
    <p class="es-muted es-small">{{ t('{server} descarga sus capítulos nuevos según salen (los mira cada pocas horas).', { server: serverLabel(store) }) }}</p>
    <div class="es-catalogs">
      <div v-for="f in followState.list" :key="f.id" class="es-catalog">
        <a href="#" class="es-catalog-open" @click.prevent="open(f)">
          <img v-if="img(f.cover)" :src="img(f.cover)" class="es-catalog-mark es-catalog-icon" alt="" loading="lazy" />
          <span v-else class="es-catalog-mark" aria-hidden="true">{{ f.title.slice(0, 1) }}</span>
          <span class="es-catalog-text">
            <strong>{{ f.title }} <span v-if="f.new" class="es-chip-count es-follow-new">{{ plural(f.new, '{n} nuevo', '{n} nuevos') }}</span></strong>
            <span class="es-muted es-small" :class="{ 'es-follow-bad': f.check_error }">{{ f.check_error ? t('Error: {error}', { error: f.check_error }) : followStatus(f) }}</span>
            <span class="es-origin">{{ catalogName(f.catalog) }} · {{ f.folder }}</span>
          </span>
        </a>
        <span class="es-follow-actions">
          <button class="es-btn es-small" :title="t('Mirar ya si hay capítulos nuevos')" :disabled="!!f.going || !f.enabled" @click="checkFollowNow(store.api, f)"><i class="es-i es-i-refresh" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="f.enabled ? t('Pausar') : t('Reanudar')" @click="setFollowEnabled(store.api, f, !f.enabled)">
            <i class="es-i" :class="f.enabled ? 'es-i-pause' : 'es-i-play'" aria-hidden="true"></i>
          </button>
        </span>
      </div>
    </div>
    </template>
  </template>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import { isCollapsed, toggleCollapsed } from '../lib/collapse'
import type { Follow } from '../lib/api'
import { checkFollowNow, followState, followStatus, loadFollows, markFollowsSeen, setFollowEnabled } from '../lib/follows'
import { plural, t } from '../lib/i18n'
import { netImageNow } from '../lib/netimages'
import { serverLabel, useStore } from '../lib/store'

/** The series followed (see follows.ts), at the top of «Catálogos»: how each one goes, and what came new. */
const store = useStore()
const newOnes = computed(() => followState.list.reduce((n, f) => n + f.new, 0))
const img = (url: string | null | undefined) => netImageNow(store.net, url)
const catalogName = (id: string) => store.catalogs?.get(id)?.name || id
function open(f: Follow) {
  if (!store.catalogs?.get(f.catalog)) { store.notify(t('Ese catálogo ya no está entre los tuyos: añádelo otra vez en Catálogos.'), true); return }
  go(f)
}
function go(f: Follow) { store.go({ v: 'catalog', kind: f.catalog, path: f.address }) }
// once connected (the page may show before the server answers), and again with another server
watch(() => store.state.connected && store.state.server && !store.api.standalone ? store.api : null, (api) => { if (api) loadFollows(api) }, { immediate: true })
// what came new has been seen once this page is left
onBeforeUnmount(() => { if (!isCollapsed('follows') && followState.list.some((f) => f.new)) markFollowsSeen(store.api).catch(() => {}) })
</script>
