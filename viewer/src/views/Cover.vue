<template>
  <span class="es-cover-box" :class="{ 'es-cover-ready': !!url }">
    <img v-if="url" :src="url" alt="" />
    <span v-else class="es-cover-none"><i class="es-i" :class="icon" aria-hidden="true"></i></span>
    <slot />
  </span>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useStore } from '../lib/store'

/** A cover, fetched with the session's credential and kept in the shared cache. `has` false shows a placeholder at once. */
const props = withDefaults(defineProps<{ id: number; has?: boolean; icon?: string }>(), { has: true, icon: 'es-i-book' })
const store = useStore()
const url = ref('')
let gone = false

async function load() {
  url.value = ''
  if (!props.has) return
  const id = props.id
  try {
    const got = await store.covers.get(store.api.coverPath(id))
    if (!gone && id === props.id) url.value = got
  } catch (_) { /* placeholder stays */ }
}
watch(() => [props.id, props.has], load, { immediate: true })
onBeforeUnmount(() => { gone = true })
</script>
