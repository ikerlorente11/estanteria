import assert from 'node:assert/strict'
import { inPieces, writeStream, type FileSink, type NetBackend } from '../src/lib/net.ts'
import { searchUrl } from '../src/lib/opds.ts'
import { DEVICE_SECRET_PREFIX } from '../src/lib/prefs.ts'
import { makeBackup } from '../src/lib/appsettings.ts'
import {
  chatAddress, chatsFeed, documentsFeed, fileHref, isTelegramHref, parseAddress, parseFileHref, readInOrder, sessionStore, titleOfName,
  type RangeReader,
} from '../src/lib/telegram.ts'

// ---- addresses of the catalog and of a file (also its key as kept) ----
assert.equal(parseAddress('tg:'), null)
assert.deepEqual(parseAddress('tg:-1001234'), { peer: '-1001234', before: null, q: '' })
assert.deepEqual(parseAddress('tg:-1001234?before=567&q=one%20piece'), { peer: '-1001234', before: 567, q: 'one piece' })
assert.equal(chatAddress('-1001234', { before: 567, q: 'one piece' }), 'tg:-1001234?before=567&q=one+piece')
assert.deepEqual(parseAddress(chatAddress('-1001234', { before: 567, q: 'one piece' })), { peer: '-1001234', before: 567, q: 'one piece' })
// a search as the catalog makes it, from the feed's template
assert.deepEqual(parseAddress(searchUrl('tg:-1001234?q={searchTerms}', 'el quijote')), { peer: '-1001234', before: null, q: 'el quijote' })
const ref = { account: '42', peer: '-1001234', message: 567 }
assert.equal(fileHref(ref), 'tg:42/-1001234/567')
assert.deepEqual(parseFileHref(fileHref(ref)), ref)
assert.equal(parseFileHref('tg:-1001234'), null)
assert.ok(isTelegramHref('tg:42/-1001234/567') && !isTelegramHref('https://x.org/a.cbz') && !isTelegramHref(null))

// ---- what Telegram answers, as the catalog shows it ----
const chats = chatsFeed([{ id: '-1001', title: 'Cómics', kind: 'channel', photo: true }, { id: '-2002', title: 'Club', kind: 'group', photo: false }], 'Iker')
assert.deepEqual(chats.navigation, [{ title: 'Cómics', href: 'tg:-1001', subtitle: 'Canal', icon: 'tgphoto:-1001' },
                                    { title: 'Club', href: 'tg:-2002', subtitle: 'Grupo', icon: null }])
assert.equal(chats.entries.length, 0)

assert.equal(titleOfName('One_Piece_Tomo_01.cbz'), 'One Piece Tomo 01')
assert.equal(titleOfName('El Quijote.epub'), 'El Quijote')

const page = {
  docs: [
    { message: 300, name: 'Saga 01.cbz', size: 40 * 2 ** 20, mime: 'application/x-cbz', date: 1700000000, caption: 'El primero' },
    { message: 299, name: 'notas.docx', size: 1000, mime: 'application/msword', date: 1700000000, caption: '' },
    { message: 298, name: 'Libro.epub', size: 2 ** 20, mime: '', date: 0, caption: '' },
  ],
  total: 250,
  next: 201,
}
const docs = documentsFeed('42', { peer: '-1001', title: 'Cómics' }, page, { peer: '-1001', before: null, q: 'saga' })
assert.equal(docs.title, 'Cómics')
assert.equal(docs.subtitle, '250 documentos')
assert.deepEqual(docs.entries.map((e) => e.title), ['Saga 01', 'Libro'])          // what the app does not read is left out
assert.deepEqual(docs.entries[0].offers, [{ href: 'tg:42/-1001/300', type: 'application/x-cbz', format: 'cbz' }])
assert.equal(docs.entries[0].id, 'tg:42/-1001/300')
assert.equal(docs.entries[0].summary, 'El primero')
assert.match(docs.entries[0].detail!, /^40\.0 MB · /)
assert.equal(docs.entries[1].detail, '1.0 MB')
assert.equal(docs.entries[0].href, null)
// the next page starts after the last message of this one (readable or not), the search goes on
assert.deepEqual(parseAddress(docs.next!), { peer: '-1001', before: 201, q: 'saga' })
assert.equal(documentsFeed('42', { peer: '-1001', title: 'X' }, { ...page, next: null }, { peer: '-1001', before: null, q: '' }).next, null)
assert.equal(docs.search, 'tg:-1001?q={searchTerms}')

// ---- a download: segments fetched a few at once, handed on in order ----
const file = new Uint8Array(1000).map((_, i) => i % 251)
let going = 0
let most = 0
const asked: [number, number][] = []
const reader: RangeReader = async function* (offset, limit) {
  asked.push([offset, limit])
  going++
  most = Math.max(most, going)
  try {
    // the later segments answer first: the order out must not change
    await new Promise((r) => setTimeout(r, 30 - offset / 50))
    for (let at = offset; at < offset + limit; at += 64) yield file.slice(at, Math.min(at + 64, offset + limit, file.length))
  } finally {
    going--                                // also when it is left once it gave what was asked
  }
}
const out: number[] = []
for await (const bytes of readInOrder(reader, file.length, new AbortController().signal, 300, 2)) out.push(...bytes)
assert.deepEqual(out, [...file])
assert.deepEqual(asked, [[0, 300], [300, 300], [600, 300], [900, 100]])
assert.equal(most, 2)

// a source that gives more than asked is cut at the segment; one that gives less is an error
const generous: RangeReader = async function* (offset) { yield file.slice(offset, offset + 512) }
const cut: number[] = []
for await (const bytes of readInOrder(generous, 700, new AbortController().signal, 300, 3)) cut.push(...bytes)
assert.deepEqual(cut, [...file.slice(0, 700)])
const short: RangeReader = async function* (offset) { yield file.slice(offset, offset + 10) }
await assert.rejects(async () => { for await (const _ of readInOrder(short, 700, new AbortController().signal, 300, 3)) { /* */ } }, /Telegram cortó la descarga/)

// cancelled: it stops with the cancelled error, and the segments going are told to stop
const stopper = new AbortController()
let told = 0
const slow: RangeReader = async function* (offset, limit, signal) {
  signal.addEventListener('abort', () => told++)
  yield file.slice(offset, offset + 10)
  await new Promise((r) => setTimeout(r, 50))
  yield file.slice(offset + 10, offset + limit)
}
setTimeout(() => stopper.abort(), 10)
await assert.rejects(async () => { for await (const _ of readInOrder(slow, 900, stopper.signal, 300, 3)) { /* */ } }, (err: any) => err.cancelled === true)
assert.ok(told >= 1)

// ---- pieces for the server, and a file written a piece at a time ----
async function* chunks(...sizes: number[]) { let n = 0; for (const s of sizes) { yield new Uint8Array(s).fill(n++) } }
const pieces: Uint8Array[] = []
for await (const p of inPieces(chunks(5, 3, 9, 1), 6)) pieces.push(p)
assert.deepEqual(pieces.map((p) => p.length), [6, 6, 6])
assert.deepEqual([...pieces[0]], [0, 0, 0, 0, 0, 1])
assert.deepEqual([...pieces[2]], [2, 2, 2, 2, 2, 3])
const odd: number[] = []
for await (const p of inPieces(chunks(4, 4), 3)) odd.push(p.length)
assert.deepEqual(odd, [3, 3, 2])

const source = { size: 18, read: () => chunks(5, 3, 9, 1) }
const steps: number[] = []
const written: number[] = []
let closed = false
const streaming: NetBackend = {
  fetch: async () => new Response(), download: async () => '', save: async () => { throw new Error('not whole') },
  async saveStream(name, folder) {
    assert.equal(name, 'a.cbz'); assert.equal(folder, 'Saga')
    const sink: FileSink = { write: async (p) => { written.push(p.length) }, close: async () => { closed = true; return 'file:///a.cbz' }, abort: async () => {} }
    return sink
  },
}
assert.equal(await writeStream(streaming, 'a.cbz', 'Saga', source, (done) => steps.push(done), new AbortController().signal), 'file:///a.cbz')
assert.deepEqual(written, [5, 3, 9, 1])
assert.deepEqual(steps, [0, 5, 8, 17, 18])
assert.ok(closed)
// an older host: gathered here and saved whole
let whole = 0
const older: NetBackend = { fetch: async () => new Response(), download: async () => '', save: async (_n, data) => { whole = data.size; return 'file:///b.cbz' } }
assert.equal(await writeStream(older, 'b.cbz', undefined, source, () => {}, new AbortController().signal), 'file:///b.cbz')
assert.equal(whole, 18)
// a failure on the way: what was written is deleted
let aborted = false
const failing = { size: 10, read: async function* () { yield new Uint8Array(4); throw new Error('cut') } }
const sinkNet: NetBackend = { ...streaming, saveStream: async () => ({ write: async () => {}, close: async () => '', abort: async () => { aborted = true } }) }
await assert.rejects(writeStream(sinkNet, 'c.cbz', undefined, failing, () => {}, new AbortController().signal), /cut/)
assert.ok(aborted)

// ---- the session stays on this device: the secure store when there is one, else storage never synced nor backed up ----
const kept = new Map<string, string>()
const secure = sessionStore({ secrets: { get: async (k) => kept.get(k) ?? null, set: async (k, v) => { if (v === null) kept.delete(k); else kept.set(k, v) } } })
await secure.set('lib1', 'SESSION')
assert.deepEqual([...kept.keys()], [`${DEVICE_SECRET_PREFIX}telegram.lib1`])
assert.equal(await secure.get('lib1'), 'SESSION')
await secure.set('lib1', null)
assert.equal(kept.size, 0)

const storage = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v) }, removeItem: (k: string) => { storage.delete(k) },
  key: (i: number) => [...storage.keys()][i] ?? null, get length() { return storage.size },
}
const web = sessionStore(undefined)
await web.set('lib2', 'WEBSESSION')
assert.equal(await web.get('lib2'), 'WEBSESSION')
storage.set('estanteria.catalogs', '[]')
assert.deepEqual(Object.keys(makeBackup().data), ['estanteria.catalogs'])        // the session is not in a backup

// ---- the chats one does not want to see: by library, with the person's settings ----
const { setTelegramHidden, telegramHidden } = await import('../src/lib/telegram.ts')
setTelegramHidden('lib1', ['-1001', '-2002'], true)
setTelegramHidden('lib1', ['-2002'], false)
assert.deepEqual(telegramHidden('lib1'), ['-1001'])
assert.deepEqual(telegramHidden('otra'), [])
assert.deepEqual(JSON.parse(storage.get('estanteria.telegram.hidden')!), { lib1: ['-1001'] })

console.log('telegram ok')
