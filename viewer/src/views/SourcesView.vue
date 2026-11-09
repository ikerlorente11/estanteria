<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">Bibliotecas</h1>
    </header>
    <p class="es-muted">Tu estantería es la carpeta «{{ store.readingRoot }}» de tu nube. Las bibliotecas de otros (Komga, Kavita, un catálogo OPDS…) se podrán añadir aquí.</p>
    <ul class="es-sources">
      <li class="es-source">
        <span class="es-source-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>El Archivador</strong>
          <small class="es-muted">
            <template v-if="state.status">{{ state.status.total }} {{ state.status.total === 1 ? 'elemento' : 'elementos' }}<template v-if="state.status.pending"> · {{ state.status.pending }} abriéndose</template><template v-if="state.status.errors"> · {{ state.status.errors }} con error</template></template>
            <template v-else>Conectando…</template>
          </small>
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useStore } from '../lib/store'

const store = useStore()
const { state } = store
</script>
