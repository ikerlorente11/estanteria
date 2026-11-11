<template>
  <span class="es-cover-box" :class="{ 'es-cover-ready': !!url }">
    <img v-if="url" :src="url" alt="" />
    <!-- no picture: a made-up cover with the title, when there is one, like a book with a plain cloth binding -->
    <span v-else-if="title" class="es-cover-made" :style="{ background: tint }"><span class="es-cover-made-title">{{ title }}</span></span>
    <span v-else class="es-cover-none"><i class="es-i" :class="icon" aria-hidden="true"></i></span>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useStore } from '../lib/store'

/** A cover, fetched with the session's credential and kept in the shared cache. `has` false shows a
 * placeholder at once. An item's by `id`, or any image of the API by `src` (a catalogue's cover). */
const props = withDefaults(defineProps<{ id?: number; src?: string; has?: boolean; icon?: string; title?: string }>(), { id: 0, src: '', has: true, icon: 'es-i-book', title: '' })
/** the made-up cover's colour, always the same for the same title */
const TINTS = ['#3d5a80', '#7a3e48', '#3f6b4f', '#7a5c2e', '#5b4a7a', '#2f6f73', '#6b4f3a', '#4a4f5c']
const tint = computed(() => { let h = 0; for (const c of props.title) h = (h * 31 + c.charCodeAt(0)) | 0; return TINTS[Math.abs(h) % TINTS.length] })
const store = useStore()
const url = ref('')
let gone = false

async function load() {
  url.value = ''
  if (!props.has) return
  const path = props.src || store.api.coverPath(props.id)
  try {
    const got = await store.covers.get(path)
    if (!gone && path === (props.src || store.api.coverPath(props.id))) url.value = got
  } catch (_) { /* placeholder stays */ }
}
watch(() => [props.id, props.src, props.has], load, { immediate: true })
onBeforeUnmount(() => { gone = true })
</script>
