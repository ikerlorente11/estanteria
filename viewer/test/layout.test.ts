import assert from 'node:assert/strict'
import { spreadOf, spreads, toPrefetch } from '../src/lib/layout.ts'

const portrait: [number, number] = [800, 1200]
const wide: [number, number] = [1600, 1200]

// single: one page per spread
assert.deepEqual(spreads(3, [], 'single').map((s) => s.pages), [[0], [1], [2]])
assert.deepEqual(spreads(3, [], 'strip').map((s) => s.pages), [[0], [1], [2]])

// double: the cover alone, then pairs; a wide page alone, and the one after starts a new pair
assert.deepEqual(spreads(6, [portrait, portrait, portrait, wide, portrait, portrait], 'double').map((s) => s.pages), [[0], [1, 2], [3], [4, 5]])
assert.deepEqual(spreads(5, [], 'double').map((s) => s.pages), [[0], [1, 2], [3, 4]])
assert.deepEqual(spreads(4, [], 'double', false).map((s) => s.pages), [[0, 1], [2, 3]])
assert.deepEqual(spreads(0, [], 'double'), [])

// the spread of a page, and what to fetch around it
const list = spreads(7, [], 'double')
assert.equal(spreadOf(list, 0), 0)
assert.equal(spreadOf(list, 2), 1)
assert.equal(spreadOf(list, 6), 3)
assert.equal(spreadOf(list, 99), 3)
assert.deepEqual(toPrefetch(list, 1), [3, 4, 5, 6, 0])
assert.deepEqual(toPrefetch(list, 3), [3, 4])

console.log('layout ok')
