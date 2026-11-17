<template>
  <div ref="root" class="es-multipick es-col-pick" :class="{ 'es-multipick-end': end }">
    <button type="button" class="es-btn" :class="{ 'es-small': small, 'es-fav-on': inSome }" aria-haspopup="listbox" :aria-expanded="open"
            :title="t('Añadir a una colección')" @click.stop="open = !open">
      <i class="es-i es-i-list" aria-hidden="true"></i>
      <template v-if="!small"> {{ inSome ? plural(mine.length, 'En {n} colección', 'En {n} colecciones') : t('Colección') }}</template>
    </button>
    <div v-if="open" class="es-fab-menu es-multipick-menu es-col-menu" role="listbox" aria-multiselectable="true" @keydown.esc.stop="open = false" @click.stop>
      <p v-if="!all.length" class="es-muted es-small">{{ t('Aún no tienes colecciones: crea la primera aquí.') }}</p>
      <label v-for="c in all" :key="c.id" class="es-multipick-item" role="option" :aria-selected="mine.includes(c.id)">
        <input type="checkbox" :checked="mine.includes(c.id)" @change="toggle(c.id)" />
        <span class="es-ellipsis">{{ c.name }}</span>
      </label>
      <form class="es-col-new" @submit.prevent="create">
        <input v-model="name" type="text" maxlength="80" :placeholder="t('Nueva colección…')" :aria-label="t('Nueva colección')" />
        <button class="es-btn es-small es-primary" type="submit" :disabled="!name.trim()"><i class="es-i es-i-add" aria-hidden="true"></i></button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { collections, createCollection, isInCollection, setInCollection, type Member } from '../lib/collections'
import { useSync } from '../lib/favorites'
import { plural, t } from '../lib/i18n'
import { useStore } from '../lib/store'

/** «Añadir a colección»: the collections of the library, ticked where `member` is; a new one is made and ticked
 * at once. Anything can be in several (a comic in «The Flash» and in «DC»). */
const props = defineProps<{ member: Member; small?: boolean; end?: boolean }>()
const store = useStore()
useSync(store)
const open = ref(false)
const name = ref('')
const root = ref<HTMLElement | null>(null)

const all = computed(() => collections())
const mine = computed(() => all.value.filter((c) => isInCollection(c.id, props.member.key)).map((c) => c.id))
const inSome = computed(() => mine.value.length > 0)

function toggle(id: string) {
  const on = !mine.value.includes(id)
  setInCollection(id, props.member, on)
  const col = all.value.find((c) => c.id === id)
  store.notify(on ? t('En «{name}».', { name: col?.name || '' }) : t('Quitado de «{name}».', { name: col?.name || '' }))
}
function create() {
  const clean = name.value.trim()
  if (!clean) return
  const id = createCollection(clean)
  setInCollection(id, props.member, true)
  name.value = ''
  store.notify(t('En «{name}».', { name: clean }))
}

// a click elsewhere closes it
function outside(e: MouseEvent) { if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false }
onMounted(() => document.addEventListener('click', outside))
onBeforeUnmount(() => document.removeEventListener('click', outside))
</script>
