<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Colecciones') }}</h1>
    </header>
    <p class="es-muted">{{ t('Junta lo que quieras de tu biblioteca (series, archivos, series de catálogos) en colecciones tuyas: «Mafalda», «The Flash»… Una misma cosa puede estar en varias. Se añade con el botón de colección de su ficha.') }}</p>

    <form class="es-col-new es-col-new-page" @submit.prevent="create">
      <input v-model="name" type="text" maxlength="80" :placeholder="t('Nueva colección…')" :aria-label="t('Nueva colección')" />
      <button class="es-btn es-primary" type="submit" :disabled="!name.trim()"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Crear') }}</button>
    </form>

    <p v-if="!all.length" class="es-muted">{{ t('Ninguna todavía.') }}</p>
    <div v-else class="es-grid">
      <article v-for="c in all" :key="c.id" class="es-card">
        <a href="#" class="es-card-cover" :title="c.name" @click.prevent="go({ v: 'collection', id: c.id })">
          <Cover v-if="coverOf(c.id)" :id="coverOf(c.id)!.id" :has="coverOf(c.id)!.has" />
          <span v-else class="es-cover-box"><span class="es-cover-none"><i class="es-i es-i-list" aria-hidden="true"></i></span></span>
        </a>
        <div class="es-card-text">
          <a href="#" class="es-card-title es-ellipsis" :title="c.name" @click.prevent="go({ v: 'collection', id: c.id })">{{ c.name }}</a>
          <span class="es-muted es-small">{{ plural(c.count, '{n} cosa', '{n} cosas') }}</span>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { collections, createCollection, membersOf } from '../lib/collections'
import { useSync } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { isLocal } from '../lib/local'
import { useStore } from '../lib/store'
import Cover from './Cover.vue'

/** The person's collections, each with the cover of something in it. */
const store = useStore()
const { state, go } = store
useSync(store)
const all = computed(() => collections())
const name = ref('')

/** the cover of the first thing in it that has one: a file of the server, or the cover of a series of the shelf */
function coverOf(id: string): { id: number; has: boolean } | null {
  for (const m of membersOf(id)) {
    if (m.value.type === 'item' && m.value.cover && m.value.id !== undefined && !isLocal(m.value.id)) return { id: m.value.id, has: true }
    if (m.value.type === 'series') {
      const s = state.series.find((x) => x.series.toLowerCase() === (m.value.series || '').toLowerCase())
      if (s?.cover) return { id: s.cover_item, has: true }
    }
  }
  return null
}

function create() {
  const clean = name.value.trim()
  if (!clean) return
  const id = createCollection(clean)
  name.value = ''
  go({ v: 'collection', id })
}
</script>
