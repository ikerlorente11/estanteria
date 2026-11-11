import assert from 'node:assert/strict'
import { Api } from '../src/lib/api.ts'
import { LOCAL_BASE, LocalShelf, guess, type ShelfBackend } from '../src/lib/local.ts'
import { Offline, type OfflineBackend, type OfflineProgress } from '../src/lib/offline.ts'

const comic = { id: 7, source_id: null, path: '/Lectura/A/A 1.cbz', folder: 'A', name: 'A 1.cbz', format: 'cbz', kind: 'comic', size: 10, modified: 1, title: 'Uno',
                series: 'A', number: 1, author: null, year: null, summary: null, pages: 3, direction: 'ltr', cover: true, state: 'ready', error: null,
                added: 5, updated: 5, meta: {}, progress: null, page_sizes: [],
                bookmarks: [{ id: 50, kind: 'note', page: 0, location: null, excerpt: '', note: 'vieja', created: 1, updated: null },
                            { id: 51, kind: 'bookmark', page: 2, location: null, excerpt: '', note: '', created: 2, updated: null }] }
const book = { ...comic, bookmarks: [], id: 8, path: '/Lectura/L.epub', folder: '', name: 'L.epub', format: 'epub', kind: 'book', title: 'Libro', series: null, number: null, pages: 0, added: 9 }

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
  if (init.method === 'POST' && url.endsWith('/bookmarks')) return new Response(JSON.stringify({ ...JSON.parse(init.body), id: 77, created: 3, updated: null }), { status: 200 })
  if (url.endsWith('/api/items/9')) return new Response(JSON.stringify({ ...comic, id: 9, title: 'Nueve', pages: 2 }), { status: 200 })
  const route = url.replace('https://svc', '').split('?')[0]
  if (!init.method && ['/api/items', '/api/series', '/api/continue', '/api/recent'].includes(route)) return new Response('[]', { status: 200 })
  if (!init.method && route === '/api/library') return new Response(JSON.stringify({ connected: true, total: 0, folders: [], sources: [] }), { status: 200 })
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

// notes and bookmarks offline: made with a temporary id, changed and deleted here, shown in the item
const made = await api.addBookmark(7, { kind: 'note', page: 1, note: 'primera' })
assert.ok(made.id < 0)
assert.equal((await api.changeBookmark(7, made.id, { note: 'corregida' })).note, 'corregida')
const gone = await api.addBookmark(7, { kind: 'bookmark', page: 2 })
await api.deleteBookmark(gone.id)
assert.equal((await api.changeBookmark(7, 50, { note: 'nueva' })).note, 'nueva')
await api.deleteBookmark(51)
assert.deepEqual((await api.item(7)).bookmarks.map((b) => [b.id, b.note]), [[50, 'nueva'], [made.id, 'corregida']])
assert.deepEqual((await api.item(8)).bookmarks, [])

// back online: what was read is sent once
up = true
await api.library()
await new Promise((r) => setTimeout(r, 10))
assert.equal(offline.state.online, true)
assert.deepEqual(sent.filter((s) => !s.startsWith('GET')),
                 ['POST /api/items/7/bookmarks', 'PUT /api/items/7/bookmarks/50', 'DELETE /api/bookmarks/51', 'PUT /api/items/7/progress'])
await api.library()
await new Promise((r) => setTimeout(r, 10))
assert.equal(sent.filter((s) => !s.startsWith('GET')).length, 4)
// a view still holding the temporary id reaches the bookmark the service made
await api.deleteBookmark(made.id)
assert.equal(sent[sent.length - 1], 'DELETE /api/bookmarks/77')

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
// the shelf of this computer: its libraries join the library, answered here even with the service there
const L1 = LOCAL_BASE + 5, L2 = LOCAL_BASE + 6, L3 = LOCAL_BASE + 7
const prepared: number[] = []
const shelfBackend: ShelfBackend = {
  config: async () => ({ roots: [{ id: 2, path: 'D:\Cómics', name: 'Cómics' }], files: 1, cache_limit: 2 ** 31, cache_bytes: 0 }),
  scan: async () => [
    { id: L1, root: 2, path: 'D:\Cómics\Saga\Saga 01.cbz', folder: 'Saga', name: 'Saga 01.cbz', format: 'cbz', size: 10, modified: 50 },
    { id: L2, root: 2, path: 'D:\Cómics\Saga\Extra\Saga 02.pdf', folder: 'Saga/Extra', name: 'Saga 02.pdf', format: 'pdf', size: 10, modified: 60 },
    { id: L3, root: 1, path: 'C:\Bajadas\Libro.epub', folder: '', name: 'Libro.epub', format: 'epub', size: 10, modified: 70 },
  ],
  pickFolders: async () => [], pickFiles: async () => [],
  addRoot: async () => ({ id: 3, path: '', name: '' }), removeRoot: async () => {}, renameRoot: async () => {},
  addFile: async (path) => ({ id: LOCAL_BASE + 9, root: 1, path, folder: '', name: 'Otro.cbz', format: 'cbz', size: 1, modified: 80 }),
  removeFile: async () => {},
  prepare: async (id) => { prepared.push(id); return { pages: 4, page_sizes: [[800, 1200], [800, 1200], [800, 1200], [800, 1200]] } },
  url: (id, part) => `http://shelf.localhost/${part.replace('/', `/${id}/`).replace(/^([cf])$/, `$1/${id}`)}`,
  setCacheLimit: async () => {}, clearCache: async () => {}, reveal: async () => {},
  upload: async () => ({ path: '/Lectura/x', item: null }),
}
const shelf = new LocalShelf(shelfBackend)
await shelf.load()
offline.shelf = shelf
assert.deepEqual(guess({ folder: 'Saga', name: 'Saga 01.cbz' }), { title: 'Saga 01', series: 'Saga', number: 1 })
assert.deepEqual(guess({ folder: '', name: 'Libro_de  prueba.epub' }), { title: 'Libro de prueba', series: null, number: null })
const before = sent.length
const status = await api.library()
assert.deepEqual(status.sources.filter((s) => s.id < 0).map((s) => [s.id, s.name, s.items]), [[-2, 'Cómics', 2], [-1, 'Archivos sueltos', 1]])
assert.deepEqual(status.local_folders?.['-2'].sort(), ['Saga', 'Saga/Extra'])
assert.deepEqual((await api.items({ source: '-2', folder: 'Saga', direct: true })).map((i) => i.id), [L1])
assert.deepEqual((await api.items({ source: '-2', folder: 'Saga' })).map((i) => i.id), [L2, L1])   // series «Extra» (its folder), then «Saga»
assert.deepEqual((await api.items({ q: 'libro' })).map((i) => i.id), [L3])                // a search finds them too
assert.deepEqual((await api.items({ source: 'archivador', folder: '', direct: true })).map((i) => i.id), [])   // not among the Archivador's
assert.deepEqual((await api.series()).map((s) => [s.series, s.items]), [['Extra', 1], ['Saga', 1]])
// reading one: its pages counted once, served by the host, progress and notes here
const detail = await api.item(L1)
assert.equal(detail.pages, 4)
await api.item(L1)
assert.deepEqual(prepared, [L1])
assert.equal((await api.item(L3)).kind, 'book')
assert.deepEqual(prepared, [L1])                                                           // a book has no pages to count
assert.equal(offline.local(`/api/items/${L1}/pages/2?w=1600`), `http://shelf.localhost/p/${L1}/2?w=1600`)
assert.equal(offline.local(`/api/items/${L1}/cover`), `http://shelf.localhost/c/${L1}`)
assert.equal(offline.local(`/api/items/${L3}/file`), `http://shelf.localhost/f/${L3}`)
assert.equal((await api.setProgress(L1, { page: 2, percent: 0.75, finished: false })).page, 2)
assert.deepEqual((await api.continueReading()).map((i) => i.id).includes(L1), true)
const localNote = await api.addBookmark(L1, { kind: 'note', page: 0, note: 'mía' })
assert.equal((await api.changeBookmark(L1, localNote.id, { note: 'mía, cambiada' })).note, 'mía, cambiada')
assert.deepEqual((await api.item(L1)).bookmarks.map((b) => b.note), ['mía, cambiada'])
await api.deleteBookmark(localNote.id)
assert.deepEqual((await api.item(L1)).bookmarks, [])
await assert.rejects(api.convertToEpub(L1), (err: any) => err.status === 409)
await assert.rejects(api.item(LOCAL_BASE + 99), (err: any) => err.status === 404)
assert.ok(!sent.slice(before).some((s) => s.includes(String(LOCAL_BASE).slice(0, 6))))      // nothing of them went to the service
// opened from outside: on the shelf from then on
const [added] = await shelf.addFiles(['E:\Otro.cbz'])
assert.equal(added.source_id, -1)
assert.ok((await api.items({ source: '-1' })).some((i) => i.id === added.id))
// uploaded where the rest is: by what it is (its folders say it: «Cómics»), its series folders, the file
assert.equal(shelf.uploadPath(L2), 'Comics/Saga/Extra/Saga 02.pdf')
assert.equal(shelf.uploadPath(L2, ['Cómics/Avatar', 'Libros']), 'Cómics/Saga/Extra/Saga 02.pdf')    // the server's spelling
assert.equal(shelf.uploadPath(L3), 'Libros/Libro.epub')
console.log('offline ok')
