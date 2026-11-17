// What an app keeps from a catalog goes up to its server; when it cannot (offline, the server down, or one that does
// not take that kind yet) it stays pending in this device and goes up again, quietly, once the server answers.
import assert from 'node:assert/strict'

const storage = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null,
  setItem: (k: string, v: string) => { storage.set(k, String(v)) },
  removeItem: (k: string) => { storage.delete(k) },
}
const { catalogGot, catalogMeta } = await import('../src/lib/catalogdownloads.ts')
const { keeperOf, resumeUploads } = await import('../src/lib/keeper.ts')

const LOCAL = 2 ** 50
const items = new Map<number, any>()
const uploads: { id: number; dest: string; key?: string }[] = []
let failWith: Error | null = new Error('HTTP 502')
let got: Record<string, number> = {}
const told: string[] = []
const shelf = {
  has: (id: number) => items.has(id),
  item: (id: number) => items.get(id) || null,
  async addFiles(uris: string[]) {
    return uris.map((uri, i) => {
      const it = { id: LOCAL + items.size + 1 + i, name: uri.split('/').pop(), title: uri }
      items.set(it.id, it)
      return it
    })
  },
  backend: {
    async upload(id: number, dest: string, _progress: unknown, key?: string) {
      if (failWith) throw failWith
      uploads.push({ id, dest, key })
      return { path: `/Lectura/${dest}`, item: { id: 900 + uploads.length } }
    },
  },
}
const store: any = {
  state: { server: true, connected: true, status: { folders: [] } },
  api: { standalone: false, keptFromCatalogs: async () => got },
  platform: 'desktop',
  serverName: 'El Archivador',
  shelf,
  net: { download: async (_url: string, name: string) => `/descargas/${name}` },
  notify: (text: string) => { told.push(text) },
}
const pending = () => Object.keys(JSON.parse(storage.get('estanteria.uploads.pending') || '{}')).map(Number)
const settle = () => new Promise((r) => setTimeout(r, 20))

// ---- kept here, the server down: it says so once, and it stays pending ----
const keeper = keeperOf(store)!
const meta = { series: 'Korra', kind: 'comic' as const, title: 'Korra 01' }
const id = await keeper.file('cat:korra/1', 'https://x/korra01.cbz', 'Korra 01.cbz', meta, () => {}, new AbortController().signal)
catalogGot['cat:korra/1'] = id
catalogMeta[id] = meta
assert.equal(await keeper.uploaded!(id), null)
assert.equal(told.length, 1)
assert.match(told[0], /No se pudo subir «Korra 01» a El Archivador/)
assert.deepEqual(pending(), [id])

// ---- a video kept before there was the list of pending ones (the server did not take videos yet) ----
const video = { id: LOCAL + 50, name: '7 10 2026.mp4', title: '7 10 2026' }
const onServer = { id: LOCAL + 51, name: '11 9 2026.mp4', title: '11 9 2026' }
items.set(video.id, video)
items.set(onServer.id, onServer)
catalogGot['tg:iker/atenea/7'] = video.id
catalogGot['tg:iker/atenea/8'] = onServer.id
catalogMeta[video.id] = { series: 'Rincón de Atenea', kind: 'video', title: '7 10 2026' }
catalogMeta[onServer.id] = { series: 'Rincón de Atenea', kind: 'video', title: '11 9 2026' }
got = { 'tg:iker/atenea/8': 77 }          // this one did get there (with its key, the server knows it)

// ---- without the server, nothing is tried ----
store.state.server = false
resumeUploads(store)
await settle()
assert.equal(uploads.length, 0)

// ---- the server answers again: what is pending goes up, quietly; what it has already is not sent again ----
store.state.server = true
failWith = null
resumeUploads(store)
await settle()
assert.deepEqual(uploads.map((u) => [u.id, u.dest, u.key]).sort(), [
  [id, 'Comics/Korra/Korra 01.cbz', undefined],
  [video.id, 'Vídeos/Rincón de Atenea/7 10 2026.mp4', 'tg:iker/atenea/7'],
].sort())
assert.deepEqual(pending(), [])
assert.equal(told.length, 1)

// ---- the old videos are looked at once: nothing goes up twice ----
resumeUploads(store)
await settle()
assert.equal(uploads.length, 2)

// ---- «it is there already» is no failure: it stops being pending ----
failWith = Object.assign(new Error('Ya hay un archivo en /Lectura/Cómics/Korra/Korra 02.cbz'), { status: 409 })
const id2 = await keeper.file('cat:korra/2', 'https://x/korra02.cbz', 'Korra 02.cbz', { ...meta, title: 'Korra 02' }, () => {}, new AbortController().signal)
await keeper.uploaded!(id2)
assert.deepEqual(pending(), [])

console.log('uploads ok')
