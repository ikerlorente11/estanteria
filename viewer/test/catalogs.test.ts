import assert from 'node:assert/strict'
import { bestFormat, fileName, formatOfMime, INCLUDED_CATALOGS } from '../src/lib/catalogs.ts'
import { parseOpds2, searchUrl } from '../src/lib/opds.ts'

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
console.log('catalogs ok')
