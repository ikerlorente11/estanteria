import type { Feed } from './opds'

/**
 * What the catalogs answered, kept on this device: a source behind a server (Suwayomi) takes seconds to
 * answer each page, so a page already seen shows at once — as it was — while it is asked again behind
 * (`onFresh` gets the new one), and the next page is asked before it is wanted (`prefetchFeed`).
 * Kept in localStorage (the newest ones only), so it also holds across restarts.
 */
const STORE_KEY = 'estanteria.feeds'
/** a page younger than this is not asked again */
const FRESH = 15 * 60_000
/** an older one is still shown (and asked again) up to this age */
const STALE = 7 * 24 * 3600_000
const MAX_KEPT = 60

interface Kept { at: number; feed: Feed }
let kept: Map<string, Kept> | null = null
const asking = new Map<string, Promise<Feed>>()

function all(): Map<string, Kept> {
  if (kept) return kept
  kept = new Map()
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as [string, Kept][]
    for (const [k, v] of saved) if (Date.now() - v.at < STALE) kept.set(k, v)
  } catch (_) { /* nothing kept, or storage off */ }
  return kept
}

function save() {
  const map = all()
  // the newest ones only
  const newest = [...map.entries()].sort((a, b) => b[1].at - a[1].at).slice(0, MAX_KEPT)
  kept = new Map(newest)
  try { localStorage.setItem(STORE_KEY, JSON.stringify(newest)) } catch (_) { /* full or off: memory only */ }
}

/** Asks for it once, even if asked again meanwhile (a prefetch and a tap share the answer). */
function ask(key: string, fetch: () => Promise<Feed>): Promise<Feed> {
  const going = asking.get(key)
  if (going) return going
  const p = fetch()
    .then((feed) => { all().set(key, { at: Date.now(), feed }); save(); return feed })
    .finally(() => asking.delete(key))
  asking.set(key, p)
  return p
}

/**
 * The feed at `key`. A fresh one kept is answered as it is; an older one too, but asked again, and
 * `onFresh` gets the new one when it comes (an error then is ignored: what was shown stays).
 * Nothing kept: asked now.
 */
export async function cachedFeed(key: string, fetch: () => Promise<Feed>, onFresh?: (feed: Feed) => void): Promise<{ feed: Feed; stale: boolean }> {
  const have = all().get(key)
  if (have && Date.now() - have.at < FRESH) return { feed: have.feed, stale: false }
  if (have) {
    ask(key, fetch).then((feed) => onFresh?.(feed), () => {})
    return { feed: have.feed, stale: true }
  }
  return { feed: await ask(key, fetch), stale: false }
}

/** Asks for it now, quietly, so it is there when wanted; the feed when it comes (null if it failed). */
export function prefetchFeed(key: string, fetch: () => Promise<Feed>): Promise<Feed | null> {
  const have = all().get(key)
  if (have && Date.now() - have.at < FRESH) return Promise.resolve(have.feed)
  return ask(key, fetch).catch(() => null)
}

/** Forgets what was kept (all of it, or what starts with `prefix`). */
export function forgetFeeds(prefix = ''): void {
  for (const k of [...all().keys()]) if (k.startsWith(prefix)) all().delete(k)
  save()
}
