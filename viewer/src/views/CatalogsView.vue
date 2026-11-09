<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">Catálogos</h1>
    </header>
    <p class="es-muted es-intro">Bibliotecas públicas a las que ya estás conectado. Entra, busca y guarda en tu estantería lo que te interese: se lee aquí mismo y, si quieres, se copia a tu Archivador.</p>
    <p v-if="loading" class="es-muted"><span class="es-spin"></span> Cargando…</p>
    <div v-else class="es-catalogs">
      <a v-for="c in catalogs" :key="c.kind" href="#" class="es-catalog" @click.prevent="go({ v: 'catalog', kind: c.kind })">
        <span class="es-catalog-mark" :class="`es-catalog-${c.kind}`" aria-hidden="true">{{ c.label.slice(0, 1) }}</span>
        <span class="es-catalog-text">
          <strong>{{ c.label }}</strong>
          <span class="es-muted es-small">{{ c.description }}</span>
          <span v-if="c.items" class="es-origin"><i class="es-i es-i-bookmark-fill" aria-hidden="true"></i> {{ c.items }} {{ c.items === 1 ? 'guardado' : 'guardados' }}</span>
        </span>
        <i class="es-i es-i-next es-catalog-go" aria-hidden="true"></i>
      </a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { Catalog } from '../lib/api'
import { useStore } from '../lib/store'

const store = useStore()
const { state, go } = store
const catalogs = ref<Catalog[]>([])
const loading = ref(true)

async function load() {
  if (!state.connected) return
  try { catalogs.value = await store.api.catalogs() } catch (err: any) { store.notify(err?.message || String(err), true) }
  loading.value = false
}
onMounted(load)
watch(() => state.connected, load)
</script>
