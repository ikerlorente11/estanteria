<template>
  <template v-if="canFollow">
    <ConfirmButton v-if="!follow" :label="t('Mantenerme al día')" icon="es-i-refresh" :danger="false" :disabled="!loaded"
                   :title="t('{server} descarga cada capítulo nuevo según sale, y los que faltan ahora; aunque el catálogo los quite, siguen en tu nube', { server: serverLabel(store) })"
                   :question="missing ? t('Descargará ahora {n} capítulos que faltan y luego los nuevos. ¿Seguir?', { n: missing }) : t('Descargará los nuevos según salgan. ¿Seguir?')"
                   :action="start" />
    <span v-else class="es-follow">
      <span class="es-follow-state" :class="{ 'es-follow-bad': follow.check_error }" :title="follow.check_error || ''">
        <i class="es-i" :class="follow.going ? 'es-i-download' : follow.enabled ? 'es-i-check' : 'es-i-pause'" aria-hidden="true"></i>
        {{ follow.check_error ? t('Error: {error}', { error: follow.check_error }) : follow.enabled && !follow.going && follow.checked ? t('Al día') + ' · ' + followStatus(follow) : followStatus(follow) }}
      </span>
      <button class="es-btn es-small" :title="t('Mirar ya si hay capítulos nuevos')" :disabled="!!follow.going || !follow.enabled" @click="checkFollowNow(store.api, follow)">
        <i class="es-i es-i-refresh" aria-hidden="true"></i>
      </button>
      <button class="es-btn es-small" :title="follow.enabled ? t('Pausar') : t('Reanudar')" @click="setFollowEnabled(store.api, follow, !follow.enabled)">
        <i class="es-i" :class="follow.enabled ? 'es-i-pause' : 'es-i-play'" aria-hidden="true"></i>
      </button>
      <ConfirmButton :label="t('Dejar de seguir')" icon="es-i-close" :question="t('¿Dejar de seguirla? Lo descargado se queda.')" :action="stop" />
    </span>
  </template>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import type { CatalogDef } from '../lib/catalogs'
import { suwayomiCredentials } from '../lib/devicelibraries'
import { checkFollowNow, feedAddress, followOf, followSeries, followState, followStatus, loadFollows, seriesIdOf, setFollowEnabled, unfollow } from '../lib/follows'
import { authOf } from '../lib/netimages'
import { t } from '../lib/i18n'
import { catalogFolder } from '../lib/local'
import { serverLabel, useStore } from '../lib/store'
import ConfirmButton from './ConfirmButton.vue'

/** «Mantenerme al día» of a series of a catalog: the server fetches every chapter that is missing and, from then
 * on, each new one as it comes out (see follows.ts); of an OPDS series, each book. Only with a server of one's own. */
const props = defineProps<{ def: CatalogDef; address: string; title: string; cover?: string | null; missing: number; lang: string
  /** what it holds (an OPDS series: comics or books), for the folder its files go to */
  kind?: 'manga' | 'comic' | 'book' }>()
const store = useStore()
const seriesId = computed(() => seriesIdOf(props.address))
const canFollow = computed(() => !!store.state.server && !store.api.standalone && !!seriesId.value && ['mangadex', 'suwayomi', 'opds'].includes(props.def.protocol))
const loaded = computed(() => followState.loaded)
const follow = computed(() => (seriesId.value ? followOf(props.def.id, seriesId.value) : undefined))

// once connected (the page may show before the server answers)
watch(() => (canFollow.value && store.state.connected ? store.api : null), (api) => { if (api) loadFollows(api) }, { immediate: true })

async function start() {
  try {
    const creds = props.def.protocol === 'suwayomi' && props.def.library ? suwayomiCredentials(props.def.library) : null
    if (props.def.protocol === 'suwayomi' && !creds) throw new Error(t('Ese servidor Suwayomi ya no está entre tus bibliotecas.'))
    const language = props.def.protocol === 'mangadex' ? props.lang : props.def.languages.find((l) => l !== 'multi') || ''
    const opds = props.def.protocol === 'opds'
    const address = opds ? feedAddress(props.address) : props.address.replace(/\?.*$/, '')
    await followSeries(store.api, {
      catalog: props.def.id, protocol: props.def.protocol as 'mangadex' | 'suwayomi' | 'opds', series_id: seriesId.value!, address,
      title: props.title, folder: catalogFolder({ series: props.title, kind: props.kind || 'manga', title: props.title }, store.state.status?.folders || []),
      ...(opds ? { headers: authOf(address) } : {}),
      language, web: props.def.site || props.def.url, cover: props.cover || null,
      ...(creds ? { suwayomi_url: creds.url, suwayomi_username: creds.username, suwayomi_secret: creds.secret } : {}),
    })
    store.notify(t('Sigues «{title}»: sus capítulos irán llegando a {server}.', { title: props.title, server: serverLabel(store) }))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function stop() {
  if (!follow.value) return
  try { await unfollow(store.api, follow.value); store.notify(t('Ya no sigues «{title}».', { title: props.title })) } catch (err: any) { store.notify(err?.message || String(err), true) }
}
</script>
