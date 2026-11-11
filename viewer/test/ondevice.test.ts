import assert from 'node:assert/strict'
import { Api } from '../src/lib/api.ts'

// an app with no library and nothing of its own yet: an empty shelf, never an error
const api = Api.onDevice()
const status = await api.library()
assert.equal(status.total, 0)
assert.deepEqual(status.sources, [])
assert.deepEqual(await api.series(), [])
assert.deepEqual(await api.continueReading(12), [])
assert.deepEqual(await api.recent(18), [])
assert.deepEqual(await api.items({ q: 'x' }), [])

// what only a server does says so (and asks nobody)
await assert.rejects(api.scan(), (err: any) => err.noServer === true)
await assert.rejects(api.blob('/api/items/1/file'), (err: any) => err.noServer === true)
console.log('ondevice ok')
