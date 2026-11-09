/** Images fetched with the session's credential (an <img src> cannot carry it), kept as object URLs
 * in a bounded cache: the least recently used are released. One fetch per URL, however many ask. */
import type { Api } from './api.ts'

export class ImageCache {
  private ready = new Map<string, string>()
  private loading = new Map<string, Promise<string>>()

  constructor(private api: Api, private max: number) {}

  has(path: string): boolean {
    return this.ready.has(path)
  }

  /** The object URL of the image at `path` (fetched if it is not here yet). */
  get(path: string, signal?: AbortSignal): Promise<string> {
    const hit = this.ready.get(path)
    if (hit) {
      this.ready.delete(path)
      this.ready.set(path, hit)      // most recently used, last
      return Promise.resolve(hit)
    }
    const pending = this.loading.get(path)
    if (pending) return pending
    const promise = this.api.blob(path, signal).then((blob) => {
      const url = URL.createObjectURL(blob)
      this.ready.set(path, url)
      this.loading.delete(path)
      this.trim()
      return url
    }, (err) => {
      this.loading.delete(path)
      throw err
    })
    this.loading.set(path, promise)
    return promise
  }

  /** Fetches it so it is ready when asked for; errors are ignored (the real ask will tell). */
  warm(path: string): void {
    if (!this.ready.has(path) && !this.loading.has(path)) this.get(path).catch(() => {})
  }

  private trim(): void {
    while (this.ready.size > this.max) {
      const oldest = this.ready.keys().next().value as string
      URL.revokeObjectURL(this.ready.get(oldest)!)
      this.ready.delete(oldest)
    }
  }

  clear(): void {
    for (const url of this.ready.values()) URL.revokeObjectURL(url)
    this.ready.clear()
  }
}

/** The width to ask a page in: the space it will fill in device pixels, rounded up to a few sizes
 * so the service's cache (and the browser's) hits. */
export const WIDTHS = [600, 800, 1000, 1200, 1600, 2000, 2560]
export function widthFor(cssPixels: number, dpr = window.devicePixelRatio || 1): number {
  const wanted = Math.ceil(cssPixels * Math.min(dpr, 3))
  return WIDTHS.find((w) => w >= wanted) ?? WIDTHS[WIDTHS.length - 1]
}
