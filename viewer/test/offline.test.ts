import assert from 'node:assert/strict'
import { Api } from '../src/lib/api.ts'
import { Offline, type OfflineBackend, type OfflineProgress } from '../src/lib/offline.ts'

const comic = { id: 7, source_id: null, path: '/Lectura/A/A 1.cbz', folder: 'A', name: 'A 1.cbz', format: 'cbz', kind: 'comic', size: 10, modified: 1, title: 'Uno',
                series: 'A', number: 1, author: null, year: null, summary: null, pages: 3, direction: 'ltr', cover: true, state: 'ready', error: null,
                added: 5, updated: 5, meta: {}, progress: null, page_sizes: [], bookmarks: [] }
const book = { ...comic, id: 8, path: '/Lectura/L.epub', folder: '', name: 'L.epub', format: 'epub', kind: 'book', title: 'Libro', series: null, number: null, pages: 0, added: 9 }

let handler: (p: OfflineProgress) => void = () => {}
const started: any[] = []
const backend: OfflineBackend = {
  list: async () => [{ item: comic as any, width: 1600, added: 100, bytes: 3000 }, { item: book as any, width: 1600, added: 200, bytes: 500 }],
  start: async (job) => { started.push(job) },
  remove: async () => {},
  url: (id, part) => `http://offline.localhost/acc/${id}/${part}`,
  onProgress: (h) => { handler = h },
}

// a service that is not there, then is
let up = false
const sent: string[] = []
;(globalThis as any).fetch = async (url: string, init: any = {}) => {
  if (url.startsWith('http://offline.localhost/')) return new Response(new Blob(['img']), { status: 200 })
  if (!up) throw new TypeError('Failed to fetch')
  sent.push(`${init.method || 'GET'} ${url.replace('https://svc', '')}`)
  if (url.endsWith('/api/items/9')) return new Response(JSON.stringify({ ...comic, id: 9, title: 'Nueve', pages: 2 }), { status: 200 })
  return new Response(JSON.stringify(init.body ? JSON.parse(init.body) : {}), { status: 200 })
}

const api = new Api('https://svc', () => 'Basic x')
const offline = new Offline(backend)
offline.attach(api)
await offline.load()
assert.equal(offline.count, 2)
assert.equal(offline.bytes, 3500)

// images and files of kept items come from the device, even before asking the service
assert.equal(offline.local('/api/items/7/pages/2?w=1200'), 'http://offline.localhost/acc/7/p/2')
assert.equal(offline.local('/api/items/7/cover'), 'http://offline.localhost/acc/7/cover')
assert.equal(offline.local('/api/items/7/file'), null)          // a comic is kept as pages
assert.equal(offline.local('/api/items/8/file'), 'http://offline.localhost/acc/8/file')
assert.equal(offline.local('/api/items/99/cover'), null)
assert.equal(await (await api.blob('/api/items/7/pages/0?w=800')).text(), 'img')

// without the service: what is kept answers
assert.deepEqual((await api.library()).total, 2)
assert.equal(offline.state.online, false)
assert.deepEqual((await api.items({ kind: 'book' })).map((i) => i.id), [8])
assert.deepEqual((await api.items({ source: 'external' })).map((i) => i.id), [])
assert.deepEqual((await api.items({ q: 'uno' })).map((i) => i.id), [7])
assert.deepEqual((await api.recent()).map((i) => i.id), [8, 7])
assert.deepEqual((await api.series()).map((s) => [s.series, s.items, s.cover_item]), [['A', 1, 7]])
assert.equal((await api.item(7)).title, 'Uno')
await assert.rejects(api.item(99), (err: any) => err.offline === true)
await assert.rejects(api.blob('/api/items/99/cover'), (err: any) => err.offline === true)

// reading offline: the progress is kept and shows where it was left
const p = await api.setProgress(7, { page: 1, percent: 0.66, finished: false, device: 'web' })
assert.equal(p.page, 1)
assert.equal((await api.item(7)).progress?.page, 1)
assert.deepEqual((await api.continueReading()).map((i) => i.id), [7])
await assert.rejects(api.addBookmark(7, { kind: 'bookmark', page: 1 }), (err: any) => err.offline === true)

// back online: what was read is sent once
up = true
await api.library()
await new Promise((r) => setTimeout(r, 10))
assert.equal(offline.state.online, true)
assert.deepEqual(sent.filter((s) => s.startsWith('PUT')), ['PUT /api/items/7/progress'])
await api.library()
await new Promise((r) => setTimeout(r, 10))
assert.equal(sent.filter((s) => s.startsWith('PUT')).length, 1)

// the queue: one item at a time, the backend reports, the next goes
assert.equal(offline.add([comic as any]), 0)                    // already kept
assert.equal(offline.add([{ ...comic, id: 9 } as any, { ...comic, id: 10, format: 'folder', pages: 0 } as any]), 1)
await new Promise((r) => setTimeout(r, 10))
assert.equal(offline.status(9), 'running')
assert.deepEqual([started[0].id, started[0].pages, started[0].file, started[0].width], [9, 2, false, 1600])
handler({ id: 9, done: 1, total: 2, bytes: 10, error: null, finished: false, cancelled: false })
assert.equal(offline.state.jobs[9].done, 1)
handler({ id: 9, done: 1, total: 2, bytes: 10, error: 'página 2: HTTP 422', finished: false, cancelled: false })
assert.equal(offline.status(9), 'error')
assert.equal(offline.state.jobs[9].error, 'página 2: HTTP 422')
console.log('offline ok')
