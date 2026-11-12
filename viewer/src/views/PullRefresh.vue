<template>
  <!-- pulled down from the top of the page: let go past the mark and it looks again for what is new -->
  <div ref="root" class="es-pull" :class="{ 'es-pull-on': pull > 0 || busy }" :style="{ height: `${busy ? MARK : pull}px` }" aria-live="polite">
    <span class="es-pull-dot" :class="{ ready: pull >= MARK }" :style="{ transform: `rotate(${pull * 4}deg)` }">
      <span v-if="busy" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i>
    </span>
    <span v-if="busy" class="es-visually-hidden">{{ t('Actualizando…') }}</span>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { t } from '../lib/i18n'

/**
 * «Pull to refresh», for the page it is at the top of: a pull down while the page is at its top shows the
 * mark, and letting go past it runs `action` (the mark spins until it is done). It listens on the page's
 * scrolling element (the shell's main), so nothing else has to know. F5 or Ctrl+R runs it too.
 */
const props = defineProps<{ action: () => Promise<unknown> }>()
const MARK = 64
const root = ref<HTMLElement>()
const pull = ref(0)
const busy = ref(false)
let scroller: HTMLElement | null = null
let startY: number | null = null

function onStart(e: TouchEvent) {
  if (busy.value || !scroller || scroller.scrollTop > 0 || e.touches.length !== 1) { startY = null; return }
  startY = e.touches[0].clientY
}
function onMove(e: TouchEvent) {
  if (startY === null || !scroller) return
  if (scroller.scrollTop > 0) { startY = null; pull.value = 0; return }
  const dy = e.touches[0].clientY - startY
  // a pull resists more the further it goes
  pull.value = dy > 0 ? Math.min(MARK * 1.6, dy * 0.5) : 0
}
async function onEnd() {
  if (startY === null) return
  startY = null
  const go = pull.value >= MARK
  pull.value = 0
  if (!go) return
  await run()
}
async function run() {
  if (busy.value) return
  busy.value = true
  try { await props.action() } finally { busy.value = false }
}
/** with a keyboard (the desktop) F5 or Ctrl+R does the same, instead of reloading the whole app */
function onKey(e: KeyboardEvent) {
  if (e.key === 'F5' || ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'r')) {
    e.preventDefault()
    run()
  }
}

onMounted(() => {
  scroller = root.value?.closest('.es-main') as HTMLElement | null
  scroller?.addEventListener('touchstart', onStart, { passive: true })
  scroller?.addEventListener('touchmove', onMove, { passive: true })
  scroller?.addEventListener('touchend', onEnd)
  scroller?.addEventListener('touchcancel', onEnd)
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  scroller?.removeEventListener('touchstart', onStart)
  scroller?.removeEventListener('touchmove', onMove)
  scroller?.removeEventListener('touchend', onEnd)
  scroller?.removeEventListener('touchcancel', onEnd)
  window.removeEventListener('keydown', onKey)
})
</script>
