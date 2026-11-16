import assert from 'node:assert/strict'
import { guestServer, isGuestLibrary, joinWithInvitation, parseInvitation } from '../src/lib/guests.ts'
import type { NetBackend } from '../src/lib/net.ts'

// an invitation link: its server (with a path before it, if the server lives under one) and its code
assert.deepEqual(parseInvitation(' https://estanteria.pistation.dev/invitacion/abcd-efgh-jkmn '), { server: 'https://estanteria.pistation.dev', code: 'ABCD-EFGH-JKMN' })
assert.deepEqual(parseInvitation('http://192.168.1.20:8043/lectura/invitacion/ABCD-EFGH-JKMN/'), { server: 'http://192.168.1.20:8043/lectura', code: 'ABCD-EFGH-JKMN' })
assert.equal(parseInvitation('ABCD-EFGH-JKMN'), null)
assert.equal(parseInvitation('https://ejemplo.com/otra/cosa'), null)
assert.equal(parseInvitation('https://ejemplo.com/invitacion/x'), null)

// a guest library is a Suwayomi at <server>/guest
assert.equal(isGuestLibrary({ type: 'suwayomi', url: 'https://estanteria.pistation.dev/guest' }), true)
assert.equal(isGuestLibrary({ type: 'suwayomi', url: 'https://suwayomi.pistation.dev' }), false)
assert.equal(isGuestLibrary({ type: 'opds', url: 'https://x.org/guest' }), false)
assert.equal(guestServer({ url: 'https://estanteria.pistation.dev/guest' }), 'https://estanteria.pistation.dev')

// joining: the code goes to <server>/guest/join; a refusal comes back with the server's reason
const sent: { url: string; body?: string }[] = []
const net = (status: number, body: unknown): NetBackend => ({
  fetch: async (url, init) => { sent.push({ url, body: init?.body }); return new Response(JSON.stringify(body), { status }) },
  download: () => Promise.reject(new Error('no')),
  save: () => Promise.reject(new Error('no')),
})
const got = await joinWithInvitation(net(200, { name: 'Juan', key: 'esg_x', url: 'https://e.test/guest' }), { server: 'https://e.test', code: 'ABCD-EFGH-JKMN' }, 'Móvil')
assert.deepEqual(got, { name: 'Juan', key: 'esg_x', url: 'https://e.test/guest' })
assert.equal(sent[0].url, 'https://e.test/guest/join')
assert.deepEqual(JSON.parse(sent[0].body!), { code: 'ABCD-EFGH-JKMN', device: 'Móvil' })
await assert.rejects(joinWithInvitation(net(404, { detail: 'Esa invitación no vale' }), { server: 'https://e.test', code: 'X' }, ''), /Esa invitación no vale/)

console.log('guests ok')
