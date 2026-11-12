/**
 * The series of catalogs a person follows: the server looks at them now and then and fetches each new chapter
 * into the reading folder by itself (the service's follow.py), so they are there though the catalog take them
 * down. Only with a server of one's own; what is followed is the person's (every device sees the same list).
 */
import { reactive } from 'vue'
import type { Api, Follow, FollowRequest } from './api.ts'
import { t } from './i18n.ts'

export const followState = reactive<{ list: Follow[]; loaded: boolean; error: string }>({ list: [], loaded: false, error: '' })
let loading: Promise<void> | null = null
let poll: ReturnType<typeof setTimeout> | null = null
let loadedFrom: Api | null = null

/** The list from the server (again while one is fetching, so its count moves). */
export function loadFollows(api: Api): Promise<void> {
  if (loadedFrom !== api) { followState.list = []; followState.loaded = false; loadedFrom = api }   // another server: not its list
  if (!loading) {
    loading = api.follows().then((list) => {
      followState.list = list
      followState.loaded = true
      followState.error = ''
      if (poll) clearTimeout(poll)
      poll = list.some((f) => f.going || (f.enabled && !f.checked)) ? setTimeout(() => { poll = null; loadFollows(api) }, 3000) : null
    }, (err) => {
      followState.error = err?.message || String(err)
      // a moment without the server: asked again in a while (still with this server)
      if (poll) clearTimeout(poll)
      poll = setTimeout(() => { poll = null; if (loadedFrom === api) loadFollows(api) }, 15000)
    }).finally(() => { loading = null })
  }
  return loading
}

export function followOf(catalog: string, seriesId: string): Follow | undefined {
  return followState.list.find((f) => f.catalog === catalog && f.series_id === seriesId)
}

function put(f: Follow) {
  const i = followState.list.findIndex((x) => x.id === f.id)
  if (i >= 0) followState.list[i] = f
  else followState.list = [...followState.list, f].sort((a, b) => a.title.localeCompare(b.title))
}

export async function followSeries(api: Api, req: FollowRequest): Promise<Follow> {
  const f = await api.follow(req)
  put(f)
  setTimeout(() => loadFollows(api), 1500)      // it starts at once: its count starts moving
  return f
}
export async function setFollowEnabled(api: Api, f: Follow, enabled: boolean) { put(await api.changeFollow(f.id, { enabled })) }
export async function checkFollowNow(api: Api, f: Follow) { put(await api.checkFollow(f.id)); setTimeout(() => loadFollows(api), 1500) }
export async function markFollowsSeen(api: Api) {
  for (const f of followState.list.filter((x) => x.new > 0)) put(await api.changeFollow(f.id, { seen: true }))
}
export async function unfollow(api: Api, f: Follow) {
  await api.unfollow(f.id)
  followState.list = followState.list.filter((x) => x.id !== f.id)
}

/** The id of a series from its address in a catalog (`mangadex:manga/<id>`, `suwayomi:manga/<id>`), or null. */
export function seriesIdOf(address: string | undefined): string | null {
  const m = (address || '').match(/^(?:mangadex|suwayomi):manga\/([\w-]+)/)
  return m ? m[1] : null
}

/** «hace 3 h» */
export function timeAgo(epoch: number): string {
  const min = Math.round((Date.now() / 1000 - epoch) / 60)
  if (min < 2) return t('ahora mismo')
  if (min < 60) return t('hace {n} min', { n: min })
  const h = Math.round(min / 60)
  if (h < 48) return t('hace {n} h', { n: h })
  return t('hace {n} días', { n: Math.round(h / 24) })
}

/** How a followed series is now, in a line. */
export function followStatus(f: Follow): string {
  if (f.going) return t('Descargando: {percent} % ({done} de {total} capítulos)', { percent: f.going.percent, done: f.going.done, total: f.going.total })
  if (!f.enabled) return t('En pausa')
  if (!f.checked) return t('Empezando…')
  const parts = [t('{kept} de {chapters} capítulos', { kept: f.kept, chapters: f.chapters }), t('revisada {ago}', { ago: timeAgo(f.checked) })]
  return parts.join(' · ')
}
