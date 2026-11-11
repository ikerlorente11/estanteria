/** Opening a book for the book reader: EPUB (reflowable or fixed layout), MOBI, AZW/AZW3, FB2 and FBZ
 * are read as they are by foliate-js (src/vendor/foliate-js); a TXT is laid out as a FictionBook in
 * memory (paragraphs and chapters found in the text) and read the same way. Nothing is converted on
 * disk: the file stays what it is, and the same file always gives the same book, so positions,
 * highlights and notes (EPUB CFIs over what foliate-js reads) keep pointing at the same text. */
import type { Format } from './api.ts'

/** the formats the book reader opens */
export const BOOK_FORMATS: Format[] = ['epub', 'mobi', 'fb2', 'fbz', 'txt']

const TYPES: Partial<Record<Format, string>> = {
  epub: 'application/epub+zip',
  mobi: 'application/x-mobipocket-ebook',
  fb2: 'application/x-fictionbook+xml',
  fbz: 'application/x-zip-compressed-fb2',
}

/** A book as foliate-js reads it (its `view.open` takes it). */
export type FoliateBook = any

export async function openBook(blob: Blob, format: Format, title = ''): Promise<FoliateBook> {
  if (format === 'txt') {
    const { makeFB2 } = await import('../vendor/foliate-js/fb2.js')
    const xml = txtToFB2(decodeText(new Uint8Array(await blob.arrayBuffer())), title)
    const book = await makeFB2(new Blob([xml], { type: 'application/x-fictionbook+xml' }))
    // without chapters the parts have no titles: foliate-js would list their first lines as the index
    if (!xml.includes('<title><p>')) book.toc = []
    return book
  }
  const { makeBook } = await import('../vendor/foliate-js/view.js')
  // makeBook tells the kind by the first bytes (zip, MOBI) and, for an FB2 or an FBZ, by the name
  const file = new File([blob], `libro.${format === 'fbz' ? 'fbz' : format}`, { type: TYPES[format] || '' })
  return makeBook(file)
}

// ---- TXT ----

/** The text of a TXT: UTF-8 or UTF-16 when it says so (a BOM) or when it is valid UTF-8, else
 * Windows-1252 (old Spanish texts). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3))
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2))
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2))
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (_) {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

const HEADING = /^(cap[ií]tulo|chapter|parte|part|libro|book|pr[oó]logo|prologue|ep[ií]logo|epilogue|introducci[oó]n|introduction|pref[aá]cio|preface|ap[eé]ndice|appendix)\b/i
const NUMBERED = /^((\d{1,3}|[IVXLCDM]{1,7})[.)]?|[*#=~-]{3,})$/
/** paragraphs per untitled part when the text has no chapters (long sections lay out slowly) */
const CHUNK = 120

/** Paragraphs of a text: blank lines separate them when the text has them (hard-wrapped lines are
 * joined), else every line is one. */
export function paragraphs(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').replace(/\f/g, '\n').split('\n')
  const blank = lines.filter((l) => !l.trim()).length
  if (blank >= Math.max(3, lines.length * 0.05)) {
    return text.replace(/\r\n?/g, '\n').split(/\n\s*\n/)
      .map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean).join(' '))
      .filter(Boolean)
  }
  return lines.map((l) => l.trim()).filter(Boolean)
}

export function isHeading(p: string): boolean {
  return p.length <= 80 && (HEADING.test(p) || NUMBERED.test(p))
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A FictionBook with the text's paragraphs, a section per chapter (a short line that looks like a
 * heading) or, without chapters, per CHUNK paragraphs. */
export function txtToFB2(text: string, title: string): string {
  const paras = paragraphs(text)
  const sections: { title: string | null; paras: string[] }[] = []
  let current: { title: string | null; paras: string[] } = { title: null, paras: [] }
  const chaptered = paras.filter(isHeading).length >= 2
  for (const p of paras) {
    if (chaptered && isHeading(p)) {
      if (current.title !== null || current.paras.length) sections.push(current)
      current = { title: p, paras: [] }
    } else {
      current.paras.push(p)
      if (!chaptered && current.paras.length >= CHUNK) { sections.push(current); current = { title: null, paras: [] } }
    }
  }
  if (current.title !== null || current.paras.length) sections.push(current)
  const body = sections.map((s) => `<section>${s.title !== null ? `<title><p>${esc(s.title)}</p></title>` : ''}${s.paras.map((p) => `<p>${esc(p)}</p>`).join('')}${s.paras.length ? '' : '<empty-line/>'}</section>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
<description><title-info><book-title>${esc(title)}</book-title></title-info></description>
<body>
${body || '<section><empty-line/></section>'}
</body>
</FictionBook>`
}
