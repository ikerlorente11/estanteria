import assert from 'node:assert/strict'
import { bestFormat, fileName, formatOfMime, INCLUDED_CATALOGS } from '../src/lib/catalogs.ts'
import { parseOpds2, searchUrl } from '../src/lib/opds.ts'
import { archiveFeed } from '../src/lib/archive.ts'
import { formatOfName } from '../src/lib/webdav.ts'

// formats by MIME type, and the best of several offers
assert.equal(formatOfMime('application/epub+zip'), 'epub')
assert.equal(formatOfMime('application/x-mobipocket-ebook'), 'mobi')
assert.equal(formatOfMime('application/vnd.comicbook+zip'), 'cbz')
assert.equal(formatOfMime('text/plain; charset=utf-8'), 'txt')
assert.equal(formatOfMime('text/html'), null)
assert.equal(bestFormat([{ format: 'txt' as const }, { format: 'epub' as const }, { format: null }])?.format, 'epub')
assert.equal(bestFormat([{ format: null }]), null)
assert.equal(fileName('Don Quijote: parte 1/2', 'epub'), 'Don Quijote parte 1 2.epub')

// searching: OpenSearch and OPDS 2.0 (RFC 6570) templates
assert.equal(searchUrl('https://x.org/search?q={searchTerms}&p={startPage?}', 'el quijote'), 'https://x.org/search?q=el%20quijote&p=')
assert.equal(searchUrl('https://x.org/search{?query}', 'manga'), 'https://x.org/search?query=manga')

// OPDS 2.0: navigation, publications with their files, next page and search, relative addresses resolved
const feed = parseOpds2({
  metadata: { title: 'Catálogo' },
  links: [{ rel: 'next', href: 'page2.json' }, { rel: 'search', href: '/search{?query}', templated: true }],
  navigation: [{ title: 'Novedades', href: 'new.json' }],
  publications: [{
    metadata: { title: 'Libro', author: [{ name: 'Ana' }, 'Luis'], language: 'es', identifier: 'urn:1' },
    links: [{ rel: 'http://opds-spec.org/acquisition/open-access', href: '/files/1.epub', type: 'application/epub+zip' }],
    images: [{ href: 'covers/1.jpg' }],
  }],
}, 'https://cat.example.org/opds/root.json')
assert.equal(feed.title, 'Catálogo')
assert.deepEqual(feed.navigation, [{ title: 'Novedades', href: 'https://cat.example.org/opds/new.json', subtitle: null }])
assert.equal(feed.next, 'https://cat.example.org/opds/page2.json')
assert.equal(feed.search, 'https://cat.example.org/search{?query}')
assert.equal(feed.entries[0].author, 'Ana, Luis')
assert.equal(feed.entries[0].cover, 'https://cat.example.org/opds/covers/1.jpg')
assert.deepEqual(feed.entries[0].offers, [{ href: 'https://cat.example.org/files/1.epub', type: 'application/epub+zip', format: 'epub' }])

// the included catalogs are well formed and unique
assert.equal(new Set(INCLUDED_CATALOGS.map((c) => c.id)).size, INCLUDED_CATALOGS.length)
for (const c of INCLUDED_CATALOGS) assert.match(c.url, /^https:\/\//)

// WebDAV: what is read, by the end of the name
assert.equal(formatOfName('Astérix 01.CBR'), 'cbr')
assert.equal(formatOfName('novela.azw3'), 'mobi')
assert.equal(formatOfName('notas.docx'), null)

// the Internet Archive: shelves, a search (only what has a readable format), an item's files to download
const asked: string[] = []
const fakeNet = {
  async fetch(url: string) {
    asked.push(url)
    const body = url.includes('advancedsearch')
      ? { response: { numFound: 60, docs: [
          { identifier: 'cap-01', title: 'Captain &amp; Co', creator: ['A', 'B'], year: '1941', format: ['Comic Book ZIP', 'JPEG'] },
          { identifier: 'audio-1', title: 'Solo audio', format: ['MP3'] }] } }
      : { metadata: { title: 'Captain & Co', creator: 'A', language: 'eng' },
          files: [{ name: 'cap 01.cbz', format: 'Comic Book ZIP', size: '2097152' }, { name: 'cap_lcp.epub', format: 'EPUB' }, { name: 'x.jpg', format: 'JPEG' }] }
    return new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })
  },
  download: async () => '', save: async () => '',
}
const home = await archiveFeed(fakeNet, 'archive:home')
assert.ok(home.navigation.length >= 3 && home.navigation[0].href.startsWith('archive:list?'))
const list = await archiveFeed(fakeNet, home.navigation[0].href)
assert.equal(list.entries.length, 1)
assert.equal(list.entries[0].title, 'Captain & Co')
assert.equal(list.entries[0].href, 'archive:item/cap-01')
assert.equal(list.entries[0].detail, '1941 · CBZ')
assert.match(list.next!, /page=2/)
assert.match(asked[0], /access-restricted-item/)
const item = await archiveFeed(fakeNet, 'archive:item/cap-01')
assert.equal(item.entries.length, 1)
assert.deepEqual(item.entries[0].offers, [{ href: 'https://archive.org/download/cap-01/cap%2001.cbz', type: '', format: 'cbz' }])
const found = await archiveFeed(fakeNet, 'archive:search?q=captain')
assert.equal(found.title, '«captain»')
assert.match(decodeURIComponent(asked[asked.length - 1]), /title:\(captain\)/)
console.log('catalogs ok')
