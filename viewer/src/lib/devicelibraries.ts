/** The libraries the page itself keeps (a Suwayomi server, and the next kinds that come), next to the ones
 * the app keeps (a server of one's own): several at once, each with its address, name and credential. They
 * are kept in this device; their passwords apart, under keys the backup leaves out. */
import { computed, reactive, type Ref } from 'vue'
import { Api } from './api.ts'
import { t } from './i18n.ts'
import { nameFromUrl, type LibrariesBackend, type Library, type LibraryInput, type LibraryType } from './libraries.ts'
import type { NetBackend } from './net.ts'
import { setImageAuth } from './netimages.ts'
import { suwayomiCheck, suwayomiSources, type SuwayomiServer, type SuwayomiSource } from './suwayomi.ts'
import { registerCatalogResolver, type CatalogDef } from './catalogs.ts'

/** the kinds the page connects by itself */
export const DEVICE_LIBRARY_TYPES: LibraryType[] = ['suwayomi']

const KEY = 'estanteria.libraries'
/** where a library's password is kept: never in a backup (see appsettings.ts) */
export const SECRET_PREFIX = 'estanteria.secret.'

interface Saved { id: string; type: LibraryType; name: string; url: string; username: string }

const state = reactive<{ list: Saved[]; errors: Record<string, string> }>({
  list: (() => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (_) { return [] } })(),
  errors: {},
})
function keep() { try { localStorage.setItem(KEY, JSON.stringify(state.list)) } catch (_) { /* private mode */ } }
function secretOf(id: string): string { try { return localStorage.getItem(SECRET_PREFIX + id) || '' } catch (_) { return '' } }

/** A Suwayomi library as the API calls want it (its address and credential); its images get the credential too. */
export function suwayomiServer(id: string): SuwayomiServer | null {
  const lib = state.list.find((l) => l.id === id && l.type === 'suwayomi')
  if (!lib) return null
  const secret = secretOf(id)
  const auth = lib.username || secret ? Api.basic(lib.username, secret) : ''
  setImageAuth(lib.url, auth)
  return { url: lib.url, auth }
}

/** The Suwayomi libraries connected (what «Catálogos» shows the sources of). */
export function suwayomiLibraries(): Saved[] {
  return state.list.filter((l) => l.type === 'suwayomi')
}

/** The app's libraries plus the page's own: one list, each kind saved where it belongs. */
export function withDeviceLibraries(app: LibrariesBackend | undefined, net: NetBackend): LibrariesBackend {
  const mine = computed<Library[]>(() => state.list.map((l) => ({ ...l, hasSecret: !!secretOf(l.id), error: state.errors[l.id] })))
  const list = computed<Library[]>(() => [...(app?.list.value || []), ...mine.value])
  return {
    types: [...(app?.types || []), ...DEVICE_LIBRARY_TYPES],
    list: list as unknown as Ref<Library[]>,
    async save(input: LibraryInput) {
      if (!DEVICE_LIBRARY_TYPES.includes(input.type)) {
        if (!app) throw new Error(t('Este tipo de biblioteca aún no se puede conectar desde aquí.'))
        return app.save(input)
      }
      const id = input.id || `${input.type}-${Date.now().toString(36)}`
      const secret = input.secret ?? secretOf(id)
      const url = input.url.replace(/\/+$/, '')
      const server = { url, auth: input.username || secret ? Api.basic(input.username, secret) : '' }
      await suwayomiCheck(net, server)            // it answers and lets us in, or the reason why not
      try { if (input.secret) localStorage.setItem(SECRET_PREFIX + id, input.secret) } catch (_) { /* private mode */ }
      const saved: Saved = { id, type: input.type, name: input.name || nameFromUrl(url), url, username: input.username }
      state.list = [...state.list.filter((l) => l.id !== id), saved]
      delete state.errors[id]
      keep()
      setImageAuth(url, server.auth)
      return { ...saved, hasSecret: !!secret }
    },
    async remove(id: string) {
      if (!state.list.some((l) => l.id === id)) return app?.remove(id)
      state.list = state.list.filter((l) => l.id !== id)
      try { localStorage.removeItem(SECRET_PREFIX + id) } catch (_) { /* nothing kept */ }
      keep()
    },
  }
}

// ---- the sources of each Suwayomi, as catalogs (kept, so a catalog opens at once and offline lists show) ----
const SOURCES_KEY = 'estanteria.suwayomi.sources'
const sources = reactive<Record<string, SuwayomiSource[]>>((() => { try { return JSON.parse(localStorage.getItem(SOURCES_KEY) || '{}') } catch (_) { return {} } })())

/** The sources of a Suwayomi library as last seen (`refresh` asks the server again). */
export async function suwayomiSourcesOf(net: NetBackend, id: string, refresh = false): Promise<SuwayomiSource[]> {
  if (!refresh && sources[id]) return sources[id]
  const server = suwayomiServer(id)
  if (!server) return []
  try {
    sources[id] = await suwayomiSources(net, server)
    delete state.errors[id]
  } catch (err: any) {
    state.errors[id] = String(err?.message || err)
    throw err
  } finally {
    try { localStorage.setItem(SOURCES_KEY, JSON.stringify(sources)) } catch (_) { /* private mode */ }
  }
  return sources[id] || []
}
export function suwayomiSourcesNow(id: string): SuwayomiSource[] { return sources[id] || [] }

/** A source of a Suwayomi as a catalog: its id is `suwayomi:<library>:<source>`. */
export function suwayomiCatalog(library: string, source: SuwayomiSource): CatalogDef {
  const lib = state.list.find((l) => l.id === library)
  return { id: `suwayomi:${library}:${source.id}`, name: source.displayName || source.name, protocol: 'suwayomi', url: lib?.url || '',
           languages: [source.lang === 'all' ? 'multi' : source.lang], content: ['manga'], nsfw: source.isNsfw,
           library, source: source.id, supportsLatest: source.supportsLatest, icon: source.iconUrl, description: lib?.name }
}
registerCatalogResolver((id) => {
  const m = id.match(/^suwayomi:([^:]+):(.+)$/)
  if (!m) return undefined
  const source = (sources[m[1]] || []).find((s) => s.id === m[2])
  return source ? suwayomiCatalog(m[1], source) : undefined
})
