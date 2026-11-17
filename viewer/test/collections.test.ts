import assert from 'node:assert/strict'
import {
  collection, collections, collectionsOf, createCollection, deleteCollection, isInCollection, membersOf, renameCollection, setInCollection,
} from '../src/lib/collections.ts'
import { syncRecords } from '../src/lib/sync.ts'
import { viewFromQuery, queryFromView } from '../src/lib/views.ts'

const series = (name: string) => ({ key: `series:${name}`, value: { type: 'series' as const, title: name, series: name, added: 1 } })
const file = (path: string) => ({ key: `item:${path}`, value: { type: 'item' as const, title: path.split('/').pop()!, id: 7, path, added: 1 } })
const here = { key: 'local:1125899906842630', value: { type: 'item' as const, title: 'De aquí', id: 1125899906842630, added: 1 }, onlyHere: true }

// ---- making them: by name (the same name again is the same collection) ----
const flash = createCollection('  The   Flash ')
const dc = createCollection('DC')
assert.equal(createCollection('the flash'), flash)
assert.deepEqual(collections().map((c) => c.name), ['DC', 'The Flash'])
assert.throws(() => createCollection('   '))

// ---- the same thing in several ----
const tomo = file('/Lectura/Cómics/The Flash/The Flash 001.cbz')
setInCollection(flash, tomo, true)
setInCollection(dc, tomo, true)
setInCollection(flash, series('The Flash'), true)
assert.ok(isInCollection(flash, tomo.key) && isInCollection(dc, tomo.key))
assert.deepEqual(collectionsOf(tomo.key).sort(), [dc, flash].sort())
assert.deepEqual(membersOf(flash).map((m) => m.key).sort(), ['item:/Lectura/Cómics/The Flash/The Flash 001.cbz', 'series:The Flash'])
assert.equal(collections().find((c) => c.id === flash)!.count, 2)
// what is in it keeps what shows it, and when it was put
const member = membersOf(dc)[0]
assert.equal(member.value.path, '/Lectura/Cómics/The Flash/The Flash 001.cbz')
assert.ok(member.value.added > 1)

// ---- a file of this device alone: in it here only (its record is never sent to a server) ----
setInCollection(flash, here, true)
assert.ok(isInCollection(flash, here.key))
const rec = syncRecords('collection').find((r) => r.key.endsWith(here.key))!
assert.equal(rec.key, `local:in:${flash}:local:1125899906842630`)
assert.equal(membersOf(flash).find((m) => m.key === here.key)!.onlyHere, true)

// ---- taken out, renamed, deleted ----
setInCollection(dc, tomo, false)
assert.ok(!isInCollection(dc, tomo.key) && isInCollection(flash, tomo.key))
assert.deepEqual(membersOf(dc), [])
renameCollection(flash, 'Flash')
assert.equal(collection(flash)!.name, 'Flash')
deleteCollection(flash)
assert.equal(collection(flash), null)
assert.deepEqual(membersOf(flash), [])
assert.deepEqual(collectionsOf(tomo.key), [])
assert.deepEqual(collections().map((c) => c.name), ['DC'])

// ---- their pages ----
assert.deepEqual(viewFromQuery({ v: 'collections' }), { v: 'collections' })
assert.deepEqual(viewFromQuery({ v: 'collection', id: 'abc12' }), { v: 'collection', id: 'abc12' })
assert.deepEqual(queryFromView({ v: 'collection', id: 'abc12' }), { v: 'collection', id: 'abc12' })
assert.deepEqual(viewFromQuery({ v: 'collection' }), { v: 'home' })

console.log('collections ok')
