<template>
  <div ref="root" class="es-pick" :class="{ 'es-pick-field': field }">
    <button ref="btn" type="button" :class="field ? 'es-pick-btn es-pick-btn-field' : [buttonClass || 'es-select', 'es-pick-btn']" :disabled="disabled"
            aria-haspopup="listbox" :aria-expanded="open" :aria-label="ariaLabel" :title="title" @click="toggle" @keydown="key">
      <span class="es-ellipsis">{{ current?.label ?? placeholder ?? '' }}</span>
      <i class="es-i es-i-chevron" aria-hidden="true"></i>
    </button>
    <!-- fixed, placed under (or over) the button: an overflowing panel does not cut it, and Android's WebView
         does not get to place a native one (it put it at the top of the screen, as wide as it) -->
    <div v-if="open" ref="menu" class="es-fab-menu es-pick-menu" role="listbox" :style="place" @click.prevent @keydown="key">
      <template v-for="g in groups" :key="g.name">
        <div v-if="g.name" class="es-pick-group">{{ g.name }}</div>
        <button v-for="o in g.options" :key="String(o.value)" type="button" class="es-pick-item" role="option" :aria-selected="o.value === modelValue"
                :class="{ on: o.value === modelValue, active: o.value === active }" :disabled="o.disabled" @click="choose(o)">
          <span>{{ o.label }}</span>
          <i v-if="o.value === modelValue" class="es-i es-i-check" aria-hidden="true"></i>
        </button>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
export interface PickOption<T = string> { value: T; label: string; group?: string; disabled?: boolean }
</script>

<script setup lang="ts" generic="V extends string | number">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/**
 * A drop-down to choose one of a list, drawn by the page instead of the system's `<select>`: inside
 * Android's WebView the native list came out at the top of the screen, as wide as it, far from its field.
 * Options may come in groups (`group`); `field`: it looks like the other fields of a form.
 */
const props = defineProps<{
  options: PickOption<V>[]
  modelValue: V
  placeholder?: string
  title?: string
  ariaLabel?: string
  disabled?: boolean
  field?: boolean
  /** the button's class when it is not a form field (es-select by default; es-rselect in the reader) */
  buttonClass?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: V]; change: [value: V] }>()
const root = ref<HTMLElement>()
const btn = ref<HTMLButtonElement>()
const menu = ref<HTMLElement>()
const open = ref(false)
const active = ref<V | null>(null)
const place = ref<Record<string, string>>({})

const current = computed(() => props.options.find((o) => o.value === props.modelValue))
const groups = computed(() => {
  const out: { name: string; options: PickOption<V>[] }[] = []
  for (const o of props.options) {
    const name = o.group || ''
    const last = out[out.length - 1]
    if (last && last.name === name) last.options.push(o)
    else out.push({ name, options: [o] })
  }
  return out
})

function position() {
  const r = btn.value?.getBoundingClientRect()
  if (!r) return
  const vw = window.innerWidth, vh = window.innerHeight, gap = 6, margin = 8
  const below = vh - r.bottom - gap - margin, above = r.top - gap - margin
  const up = below < 220 && above > below
  const width = Math.max(r.width, 200)
  const left = Math.max(margin, Math.min(r.left, vw - width - margin))
  place.value = {
    left: `${left}px`, minWidth: `${Math.min(width, vw - 2 * margin)}px`, maxWidth: `${vw - 2 * margin}px`,
    maxHeight: `${Math.max(120, Math.min(up ? above : below, 420))}px`,
    ...(up ? { bottom: `${vh - r.top + gap}px` } : { top: `${r.bottom + gap}px` }),
  }
}
async function toggle() {
  if (open.value) { open.value = false; return }
  position()
  active.value = props.modelValue
  open.value = true
  await nextTick()
  menu.value?.querySelector<HTMLElement>('.es-pick-item.on')?.scrollIntoView({ block: 'nearest' })
}
function choose(o: PickOption<V>) {
  if (o.disabled) return
  open.value = false
  btn.value?.focus()
  if (o.value !== props.modelValue) { emit('update:modelValue', o.value); emit('change', o.value) }
}
function key(e: KeyboardEvent) {
  const usable = props.options.filter((o) => !o.disabled)
  if (e.key === 'Escape' && open.value) { e.stopPropagation(); open.value = false; btn.value?.focus(); return }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) { void toggle(); return }
    const i = usable.findIndex((o) => o.value === active.value)
    const next = usable[Math.max(0, Math.min(usable.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) active.value = next.value
    void nextTick(() => menu.value?.querySelector<HTMLElement>('.es-pick-item.active')?.scrollIntoView({ block: 'nearest' }))
  } else if ((e.key === 'Enter' || e.key === ' ') && open.value) {
    e.preventDefault()
    const o = usable.find((x) => x.value === active.value)
    if (o) choose(o)
  }
}
function outside(e: Event) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false
}
// the page moved under it: closed rather than left floating away from its field
function moved(e: Event) { if (open.value && !(menu.value && menu.value.contains(e.target as Node))) open.value = false }
function resized() { if (open.value) open.value = false }
onMounted(() => {
  document.addEventListener('pointerdown', outside)
  window.addEventListener('scroll', moved, true)
  window.addEventListener('resize', resized)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside)
  window.removeEventListener('scroll', moved, true)
  window.removeEventListener('resize', resized)
})
</script>
