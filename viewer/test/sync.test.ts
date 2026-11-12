import assert from 'node:assert/strict'
import { attachSync, detachSync, syncGet, syncNow, syncPut, syncRecords, type SyncRecord } from '../src/lib/sync.ts'

// a server like the service's: per record, the newest change wins; changes in order of `seq`
type Row = SyncRecord & { seq: number }
const rows = new Map<string, Row>()
let seq = 0
const apply = (c: SyncRecord) => {
  const k = `${c.kind}|${c.key}`
  const there = rows.get(k)
  if (there && there.updated >= c.updated) return
  rows.set(k, { ...c, value: c.deleted ? null : c.value, seq: ++seq })
}
const server: any = {
  async sync(since: number) {
    const changes = [...rows.values()].filter((r) => r.seq > since).sort((a, b) => a.seq - b.seq)
    return { user: 'u-iker', seq: changes.length ? changes[changes.length - 1].seq : seq, more: false, changes }
  },
  async syncPush(changes: SyncRecord[]) { changes.forEach(apply); return { kept: changes.length, seq } },
}

// without a server: this device's own book
syncPut('favorite', 'series:Sin servidor', { type: 'series', title: 'Sin servidor' })
syncPut('favorite', 'local:123', { type: 'item', title: 'Un archivo de aquí' }, true)
assert.equal(syncRecords('favorite').length, 2)

// another device made one before (on the server)
apply({ kind: 'favorite', key: 'series:Del otro', value: { type: 'series', title: 'Del otro' }, deleted: false, updated: Date.now() / 1000 - 100, device: 'web' })

await attachSync(server, false)
// ours went up (not the one of this device alone), theirs came down
assert.ok(rows.has('favorite|series:Sin servidor'))
assert.ok(!rows.has('favorite|local:123'))
assert.ok(syncGet('favorite', 'series:Del otro'))
assert.ok(syncGet('favorite', 'local:123'))
assert.equal(syncRecords('favorite').length, 3)

// removed here: the deletion travels
syncPut('favorite', 'series:Del otro', null)
await new Promise((r) => setTimeout(r, 1700))
await syncNow()
assert.equal(rows.get('favorite|series:Del otro')!.deleted, true)
assert.equal(syncGet('favorite', 'series:Del otro'), null)

// a newer change made elsewhere wins over what this device had
apply({ kind: 'favorite', key: 'series:Sin servidor', value: null, deleted: true, updated: Date.now() / 1000 + 1, device: 'móvil' })
await syncNow()
assert.equal(syncGet('favorite', 'series:Sin servidor'), null)

// without the server again: only what is of this device alone
detachSync()
assert.deepEqual(syncRecords('favorite').map((r) => r.key), ['local:123'])
console.log('sync ok')
process.exit(0)
