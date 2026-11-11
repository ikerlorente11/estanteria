<template>
  <div class="es-rfield">
    <span>{{ label }} <small v-if="unit" class="es-muted">({{ unit }})</small></span>
    <div class="es-chips es-numrow">
      <button class="es-chip" :title="t('Menos ({step})', { step })" @click="change(-step)">−</button>
      <input class="es-num" type="number" :min="min" :max="max" :step="step" :value="modelValue" @change="typed(($event.target as HTMLInputElement).value)" />
      <button class="es-chip" :title="t('Más ({step})', { step })" @click="change(step)">+</button>
      <button v-for="p in presets" :key="p" class="es-chip es-chip-preset" :class="{ on: Math.abs(modelValue - p) < 1e-9 }" @click="emit('update:modelValue', p)">{{ p }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '../lib/i18n'

/** A number with a few shortcuts and, for the exact value, a box to type it in. */
const props = defineProps<{ modelValue: number; label: string; unit?: string; min: number; max: number; step: number; presets: number[] }>()
const emit = defineEmits<{ 'update:modelValue': [number] }>()

function clamp(value: number): number {
  if (!Number.isFinite(value)) return props.modelValue
  const decimals = (String(props.step).split('.')[1] || '').length
  return Number(Math.min(props.max, Math.max(props.min, value)).toFixed(decimals))
}
function change(by: number) { emit('update:modelValue', clamp(props.modelValue + by)) }
function typed(value: string) { emit('update:modelValue', clamp(Number(value.replace(',', '.')))) }
</script>
