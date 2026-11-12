<template>
  <div ref="root" class="es-multipick" :class="{ 'es-multipick-end': end }">
    <button type="button" class="es-select es-multipick-btn" :class="{ on: modelValue.length > 0 && modelValue.length < options.length }" aria-haspopup="listbox" :aria-expanded="open"
            :title="title" @click="open = !open">
      <i v-if="icon" class="es-i" :class="icon" aria-hidden="true"></i>
      <span class="es-ellipsis">{{ summary }}</span>
      <i class="es-i es-i-chevron" aria-hidden="true"></i>
    </button>
    <div v-if="open" class="es-fab-menu es-multipick-menu" role="listbox" aria-multiselectable="true" @keydown.esc.stop="open = false">
      <div class="es-multipick-quick">
        <button type="button" class="es-btn es-small" @click="emit('update:modelValue', options.map((o) => o.value))">{{ t('Todos') }}</button>
        <button type="button" class="es-btn es-small" @click="emit('update:modelValue', [])">{{ noneLabel || t('Ninguno') }}</button>
      </div>
      <label v-for="o in options" :key="o.value" class="es-multipick-item" role="option" :aria-selected="modelValue.includes(o.value)">
        <input type="checkbox" :checked="modelValue.includes(o.value)" @change="toggle(o.value)" />
        <span>{{ o.label }}</span>
      </label>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../lib/i18n'

/**
 * A drop-down to choose several of a list (languages, say), in little room: the button says what is chosen
 * («Todos», «Español, English», «5 de 12»), and opens a list of checkboxes with «Todos» and «Ninguno».
 * `emptyMeansAll`: nothing chosen reads as all (a filter); without it, nothing chosen is nothing.
 */
const props = defineProps<{
  options: { value: string; label: string }[]
  modelValue: string[]
  /** what the button says before the choice («Idiomas») */
  label?: string
  title?: string
  icon?: string
  emptyMeansAll?: boolean
  /** the «Ninguno» button's text (a filter: «Quitar el filtro») */
  noneLabel?: string
  /** the list opens towards the left (a button at the end of a row) */
  end?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>()
const root = ref<HTMLElement>()
const open = ref(false)

const summary = computed(() => {
  const chosen = props.options.filter((o) => props.modelValue.includes(o.value))
  const head = props.label ? `${props.label}: ` : ''
  if (!chosen.length) return head + (props.emptyMeansAll ? t('Todos') : t('Ninguno'))
  if (chosen.length === props.options.length) return head + t('Todos')
  if (chosen.length <= 2) return head + chosen.map((o) => o.label).join(', ')
  return head + t('{n} de {total}', { n: chosen.length, total: props.options.length })
})

function toggle(value: string) {
  const now = props.modelValue
  emit('update:modelValue', now.includes(value) ? now.filter((v) => v !== value) : [...now, value])
}
function outside(e: Event) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>
