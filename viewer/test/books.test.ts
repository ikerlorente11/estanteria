import assert from 'node:assert/strict'
import { decodeText, isHeading, paragraphs, txtToFB2 } from '../src/lib/books.ts'

// encodings: BOM, valid UTF-8, else Windows-1252
const enc = new TextEncoder()
assert.equal(decodeText(enc.encode('añoñó')), 'añoñó')
assert.equal(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, ...enc.encode('hola')])), 'hola')
assert.equal(decodeText(new Uint8Array([0x61, 0xf1, 0x6f])), 'año')                 // ñ in Windows-1252
assert.equal(decodeText(new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0xf1, 0x00])), 'añ')  // UTF-16 LE

// paragraphs: blank lines separate them (hard-wrapped lines joined), else every line is one
const wrapped = 'Era una vez\nun libro largo.\n\nY otro párrafo\npartido.\n\nTercero.\n\nCuarto.'
assert.deepEqual(paragraphs(wrapped), ['Era una vez un libro largo.', 'Y otro párrafo partido.', 'Tercero.', 'Cuarto.'])
assert.deepEqual(paragraphs('Uno.\r\nDos.\r\nTres.'), ['Uno.', 'Dos.', 'Tres.'])

assert.ok(isHeading('Capítulo 1'))
assert.ok(isHeading('CHAPTER XII'))
assert.ok(isHeading('IV'))
assert.ok(isHeading('* * *'.replace(/ /g, '')))
assert.ok(!isHeading('Capítulo aparte, el narrador se detuvo a pensar en todo lo que había ocurrido aquella noche tan larga.'))
assert.ok(!isHeading('Era una vez un libro.'))

// chapters become sections with titles; text before the first one is kept
const chaptered = txtToFB2('Prefacio suelto.\n\nCapítulo 1\n\nUno <a> & b.\n\nCapítulo 2\n\nDos.', 'Mi libro')
assert.match(chaptered, /<book-title>Mi libro<\/book-title>/)
assert.equal((chaptered.match(/<section>/g) || []).length, 3)
assert.match(chaptered, /<section><title><p>Capítulo 1<\/p><\/title><p>Uno &lt;a&gt; &amp; b\.<\/p><\/section>/)

// without chapters: untitled parts of a fixed number of paragraphs
const long = Array.from({ length: 250 }, (_, i) => `Párrafo ${i}.`).join('\n\n')
const parts = txtToFB2(long, 'Largo')
assert.equal((parts.match(/<section>/g) || []).length, 3)
assert.ok(!parts.includes('<title><p>'))

// the same text always gives the same book (positions and highlights depend on it)
assert.equal(txtToFB2(wrapped, 'x'), txtToFB2(wrapped, 'x'))
console.log('books ok')
