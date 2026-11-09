<template>
  <div class="es-notes">
    <p v-if="!items.length" class="es-muted es-small">Nada todavía. {{ hint }}</p>
    <ul v-else class="es-notelist">
      <li v-for="b in items" :key="b.id" :class="`es-note-${b.kind}`">
        <a href="#" class="es-note-where" @click.prevent="emit('go', b)">
          <i class="es-i" :class="b.kind === 'bookmark' ? 'es-i-bookmark-fill' : b.kind === 'note' ? 'es-i-note' : 'es-i-marker'" aria-hidden="true"></i>
          <span class="es-note-text">
            <span class="es-note-place">{{ place(b) }}</span>
            <q v-if="b.kind !== 'bookmark' && b.excerpt" class="es-note-excerpt">{{ b.excerpt }}</q>
          </span>
        </a>
        <textarea v-if="editing === b.id" v-model="draft" class="es-note-edit" rows="3" placeholder="Tu nota" @keydown.esc="editing = null" @keydown.ctrl.enter="save(b)"></textarea>
        <p v-else-if="b.note" class="es-note-body">{{ b.note }}</p>
        <div class="es-note-actions">
          <template v-if="editing === b.id">
            <button class="es-chip" @click="save(b)">Guardar</button>
            <button class="es-chip" @click="editing = null">Cancelar</button>
          </template>
          <template v-else>
            <button class="es-chip" @click="edit(b)">{{ b.note ? 'Editar' : 'Añadir nota' }}</button>
            <button class="es-chip" @click="emit('remove', b)">Quitar</button>
          </template>
          <small class="es-muted es-tiny">{{ new Date(b.created * 1000).toLocaleDateString() }}</small>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { Bookmark } from '../lib/api'

/** Bookmarks, notes and highlights of what is being read: go to one, edit its note, remove it. */
const props = defineProps<{ items: Bookmark[]; hint: string; place: (b: Bookmark) => string }>()
const emit = defineEmits<{ go: [Bookmark]; remove: [Bookmark]; save: [Bookmark, string] }>()
const editing = ref<number | null>(null)
const draft = ref('')

function edit(b: Bookmark) {
  editing.value = b.id
  draft.value = b.note
}
function save(b: Bookmark) {
  emit('save', b, draft.value.trim())
  editing.value = null
}
</script>
