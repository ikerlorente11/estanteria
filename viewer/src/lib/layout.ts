/** How the pages of a comic are put on screen (pure, tested): one per spread, or two side by side
 * with the cover alone and wide pages (a double-page spread scanned as one image) alone too. */

export type Mode = 'single' | 'double' | 'strip'

export interface Spread {
  /** page indexes (from 0) in reading order */
  pages: number[]
}

/** `sizes`: [width, height] of each page when known (an empty list means nothing is known). */
export function spreads(count: number, sizes: [number, number][], mode: Mode, coverAlone = true): Spread[] {
  if (mode !== 'double') return Array.from({ length: count }, (_, i) => ({ pages: [i] }))
  const wide = (i: number) => sizes[i] !== undefined && sizes[i][0] > 0 && sizes[i][0] > sizes[i][1]
  const out: Spread[] = []
  let i = 0
  while (i < count) {
    if ((i === 0 && coverAlone) || wide(i)) {
      out.push({ pages: [i] })
      i += 1
      continue
    }
    if (i + 1 < count && !wide(i + 1)) {
      out.push({ pages: [i, i + 1] })
      i += 2
    } else {
      out.push({ pages: [i] })
      i += 1
    }
  }
  return out
}

/** The spread a page is in. */
export function spreadOf(list: Spread[], page: number): number {
  const at = list.findIndex((s) => s.pages.includes(page))
  return at < 0 ? Math.max(0, Math.min(list.length - 1, page)) : at
}

/** The pages worth having ready around a spread: the next few first, then the one before. */
export function toPrefetch(list: Spread[], at: number, ahead = 3, behind = 1): number[] {
  const out: number[] = []
  for (let k = 1; k <= ahead; k++) if (list[at + k]) out.push(...list[at + k].pages)
  for (let k = 1; k <= behind; k++) if (list[at - k]) out.push(...list[at - k].pages)
  return out
}
