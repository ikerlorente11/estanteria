// The tests check the texts in Spanish, the viewer's own: whatever language the machine running them is in (the
// CI's is English, and Node has navigator.language), the system says Spanish here (the app's settings follow it).
const node = (globalThis as any).navigator
const read = (k: string) => { try { return node?.[k] } catch (_) { return undefined } }
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'es-ES', languages: ['es-ES', 'es'], userAgent: read('userAgent'), platform: read('platform'),
           hardwareConcurrency: read('hardwareConcurrency') },
})
