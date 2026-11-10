import assert from 'node:assert/strict'
import { queryFromView, viewFromQuery } from '../src/lib/views.ts'

assert.deepEqual(viewFromQuery({}), { v: 'home' })
assert.deepEqual(viewFromQuery({ v: 'nope' }), { v: 'home' })
assert.deepEqual(viewFromQuery({ v: 'read', id: '12', page: '3' }), { v: 'read', id: 12, page: 3 })
assert.deepEqual(viewFromQuery({ v: 'read', id: '12' }), { v: 'read', id: 12 })
assert.deepEqual(viewFromQuery({ v: 'read', id: 'x' }), { v: 'home' })
assert.deepEqual(viewFromQuery({ v: 'series', name: 'Aang' }), { v: 'series', name: 'Aang' })
assert.deepEqual(viewFromQuery({ v: 'library', q: 'korra', kind: 'pdf' }), { v: 'library', q: 'korra', kind: 'pdf' })
assert.deepEqual(viewFromQuery({ v: 'library', folder: '' }), { v: 'library', folder: '' })

assert.deepEqual(viewFromQuery({ v: 'catalog' }), { v: 'home' })
assert.deepEqual(viewFromQuery({ v: 'catalog', kind: 'mangadex', path: 'manga=1&offset=0' }), { v: 'catalog', kind: 'mangadex', path: 'manga=1&offset=0' })

for (const view of [{ v: 'home' }, { v: 'read', id: 3, page: 0 }, { v: 'read', id: 3 }, { v: 'series', name: 'A/B' }, { v: 'library', q: 'x', sort: 'added' }, { v: 'item', id: 9 }, { v: 'sources' },
                    { v: 'catalogs' }, { v: 'downloads' }, { v: 'catalog', kind: 'gutenberg' }, { v: 'catalog', kind: 'archive', q: 'quijote', path: 'q=x&page=2' }] as const) {
  assert.deepEqual(viewFromQuery(queryFromView(view)), view)
}
console.log('views ok')
