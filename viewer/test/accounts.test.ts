import assert from 'node:assert/strict'

// a browser's storage, before the modules read it
const store = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, String(v)) },
  removeItem: (k: string) => { store.delete(k) },
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() { return store.size },
}
const LOCAL = 2 ** 50 + 5
const progress = (page: number) => ({ page, location: null, percent: 0.5, finished: false, device: 'móvil', updated: 100 + page })
// what was kept before accounts: a progress to send of the server's item 7, and the progress of a file of this device
store.set('estanteria.offline.pending', JSON.stringify({ 7: { body: { page: 3 }, at: 1 } }))
store.set('estanteria.offline.progress', JSON.stringify({ 7: progress(3), [LOCAL]: progress(9) }))

const { Offline } = await import('../src/lib/offline.ts')
const { syncPut, syncRecordsLike } = await import('../src/lib/sync.ts')

const backend: any = { list: async () => [], start: async () => {}, remove: async () => {}, url: () => '', onProgress: () => {} }
const api = (name: string): any => ({ name })
const off: any = new Offline(backend)

// ---- what waits to be sent is of one account ----
off.attach(api('a'), 'iker@a')
assert.deepEqual(Object.keys(off.pending), ['7'], 'the first account takes what was kept before')
assert.equal(off.known[LOCAL].page, 9, 'the files of this device stay')
assert.equal(store.get('estanteria.offline.pending'), undefined, 'the old keys are gone')
off.attach(api('b'), 'ana@b')
assert.deepEqual(off.pending, {}, 'another account: nothing of the first one to send')
assert.equal(off.known[7], undefined)
assert.equal(off.known[LOCAL].page, 9, 'a file of this device, whatever the account')
off.attach(api('a2'), 'iker@a')
assert.deepEqual(Object.keys(off.pending), ['7'], 'back to the first: its own again')

// ---- bookmarks of a file of this device travel with the file (its name and size) ----
off.shelf = { has: () => true, item: () => ({ id: LOCAL, name: 'Uno.cbz', size: 1234 }),
              detail: async () => ({ id: LOCAL, name: 'Uno.cbz', size: 1234, progress: null, page_sizes: [] }) }
const made = off.own('POST', `/api/items/${LOCAL}/bookmarks`, { kind: 'note', page: 2, note: 'aquí' })
assert.ok(made.uid, 'a bookmark of a file of this device gets an id for every device')
const prefix = 'file:1234:uno.cbz|'
assert.equal(syncRecordsLike('mark', prefix).length, 1, 'and goes to the others')
// another device made one, and changed ours
syncPut('mark', `${prefix}otra`, { kind: 'bookmark', page: 5, location: null, excerpt: '', note: '', created: 50, updated: null })
syncPut('mark', `${prefix}${made.uid}`, { ...made, note: 'cambiada', updated: Date.now() / 1000 + 5 })
let detail = await off.own('GET', `/api/items/${LOCAL}`, null)
assert.deepEqual(detail.bookmarks.map((b: any) => [b.page, b.note]), [[2, 'cambiada'], [5, '']])
// deleted on the other: gone here too
syncPut('mark', `${prefix}otra`, null)
detail = await off.own('GET', `/api/items/${LOCAL}`, null)
assert.deepEqual(detail.bookmarks.map((b: any) => b.page), [2])
// deleted here: the others are told
const id = detail.bookmarks[0].id
off.own('DELETE', `/api/bookmarks/${id}`, null)
assert.equal(syncRecordsLike('mark', prefix).find((r) => r.key.endsWith(made.uid))!.deleted, true)
console.log('accounts ok')
process.exit(0)
