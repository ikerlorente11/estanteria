import { nextTick, watch, type Ref } from 'vue'

/**
 * Where each page was scrolled to, so that going back to a page (a list, a folder, a catalog) puts it
 * where it was instead of at the top. Going forward to a page always starts at the top.
 *
 * `key` names the page shown (the hash, the route's query); the shell calls `forward()` right before it
 * goes somewhere new, so that a change of key without it is taken as «back» (or «forward» in the history).
 * The page may still be loading when it comes back: the position is tried again as it grows, until it
 * is reached, a few seconds go by, or the reader scrolls on their own.
 */
export function useScrollMemory(el: Ref<HTMLElement | undefined>, key: Ref<string>) {
  const kept = new Map<string, number>()
  let current = key.value
  let goingForward = false
  let stop = () => {}

  const onScroll = () => { if (el.value) kept.set(current, el.value.scrollTop) }
  watch(el, (now, old) => {
    old?.removeEventListener('scroll', onScroll)
    now?.addEventListener('scroll', onScroll, { passive: true })
  }, { immediate: true })

  watch(key, (next) => {
    stop()
    current = next
    const top = goingForward ? 0 : kept.get(next) ?? 0
    goingForward = false
    void nextTick(() => restore(top))
  })

  // the page's element may not be there yet (back from a reader, which takes the whole screen, it is made
  // again): each try takes the one there is, until the place is reached or a few seconds go by
  function restore(top: number) {
    const EVENTS = ['touchstart', 'wheel', 'keydown', 'mousedown'] as const
    let done = false
    let bound: HTMLElement | undefined
    const started = performance.now()
    const unbind = () => { if (bound) for (const e of EVENTS) bound.removeEventListener(e, end); bound = undefined }
    // the reader takes over as soon as they touch it
    const bind = (node: HTMLElement) => { if (bound === node) return; unbind(); bound = node; for (const e of EVENTS) node.addEventListener(e, end, { passive: true }) }
    function end() { done = true; unbind() }
    stop = end
    const tick = () => {
      if (done) return
      const node = el.value
      if (node) {
        bind(node)
        node.scrollTop = Math.max(0, top)
        if (top <= 0 || Math.abs(node.scrollTop - top) < 2) { end(); return }
      }
      if (performance.now() - started > 4000) { end(); return }
      requestAnimationFrame(tick)
    }
    tick()
  }

  return {
    /** Call right before going to a new page: it starts at the top. */
    forward() { goingForward = true },
  }
}
