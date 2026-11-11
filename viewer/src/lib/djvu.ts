/** DjVu, read on this device: the file comes whole (from the service, another library, the shelf of
 * this device or a download) and djvu-rs (WebAssembly, src/vendor/djvu-rs) draws its pages, at the
 * width each one fills on screen, as images for the comic reader. The same everywhere: no host has
 * to understand DjVu, only hand the file over. */
import init, { WasmDocument } from '../vendor/djvu-rs/djvu_rs.js'
import wasmUrl from '../vendor/djvu-rs/djvu_rs_bg.wasm?url'
import { t } from './i18n.ts'

let loading: Promise<unknown> | null = null
function ready(): Promise<unknown> {
  loading ||= init({ module_or_path: wasmUrl }).catch((err) => { loading = null; throw err })
  return loading
}

/** pages drawn and kept (object URLs), the least recently used released first */
const KEEP = 48
/** never draw a page wider than this times its own resolution (a small scan zoomed in only gets blurrier) */
const MAX_UPSCALE = 1.5

export class DjvuBook {
  readonly pages: number
  /** each page's size at its own resolution, in pixels */
  readonly sizes: [number, number][]
  private doc: WasmDocument
  private drawn = new Map<string, string>()
  private queue: Promise<unknown> = Promise.resolve()

  private constructor(doc: WasmDocument) {
    this.doc = doc
    this.pages = doc.page_count()
    this.sizes = Array.from({ length: this.pages }, (_, i) => {
      const page = doc.page(i)
      try {
        const dpi = page.dpi()
        return [page.width_at(dpi), page.height_at(dpi)] as [number, number]
      } finally { page.free() }
    })
  }

  static async open(file: Blob): Promise<DjvuBook> {
    await ready()
    const doc = WasmDocument.from_bytes(new Uint8Array(await file.arrayBuffer()))
    if (!doc.page_count()) { doc.free(); throw new Error(t('el DjVu no tiene páginas')) }
    return new DjvuBook(doc)
  }

  /** Page `n` (from 0) about `width` pixels wide, as an object URL. One page is drawn at a time (they
   * come in order: the one shown, then the next ones). */
  image(n: number, width: number): Promise<string> {
    const [w] = this.sizes[n] || [0, 0]
    const target = Math.max(1, Math.round(Math.min(width, w * MAX_UPSCALE)))
    const key = `${n}@${target}`
    const hit = this.drawn.get(key)
    if (hit) {
      this.drawn.delete(key)
      this.drawn.set(key, hit)
      return Promise.resolve(hit)
    }
    const job = this.queue.then(() => this.draw(n, target, key))
    this.queue = job.catch(() => {})
    return job
  }

  private async draw(n: number, width: number, key: string): Promise<string> {
    const again = this.drawn.get(key)
    if (again) return again
    if (n < 0 || n >= this.pages) throw new Error(t('esa página no existe'))
    const page = this.doc.page(n)
    let data: ImageData
    try {
      const dpi = Math.max(1, Math.round(page.dpi() * width / Math.max(1, this.sizes[n][0])))
      const w = page.width_at(dpi)
      const h = page.height_at(dpi)
      data = new ImageData(new Uint8ClampedArray(page.render(dpi)), w, h)
    } finally { page.free() }
    const canvas = document.createElement('canvas')
    canvas.width = data.width
    canvas.height = data.height
    canvas.getContext('2d')!.putImageData(data, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
    if (!blob) throw new Error(t('no se pudo dibujar la página'))
    const url = URL.createObjectURL(blob)
    this.drawn.set(key, url)
    while (this.drawn.size > KEEP) {
      const oldest = this.drawn.keys().next().value as string
      URL.revokeObjectURL(this.drawn.get(oldest)!)
      this.drawn.delete(oldest)
    }
    return url
  }

  close(): void {
    for (const url of this.drawn.values()) URL.revokeObjectURL(url)
    this.drawn.clear()
    try { this.doc.free() } catch (_) { /* freed already */ }
  }
}
