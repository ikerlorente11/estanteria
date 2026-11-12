/** The libraries the page itself keeps (a Suwayomi, Komga, Kavita, an OPDS catalog, a WebDAV folder), next to the ones
 * the app keeps (a server of one's own): several at once, each with its address, name and credential. They
 * are kept in this device; their passwords apart, under keys the backup leaves out. */
import { computed, reactive, type Ref } from 'vue'
import { Api } from './api.ts'
import { t } from './i18n.ts'
import { LIBRARY_TYPES, nameFromUrl, type LibrariesBackend, type Library, type LibraryInput, type LibraryType } from './libraries.ts'
import type { NetBackend } from './net.ts'
import { setImageAuth, setOriginHeaders } from './netimages.ts'
import { readFeed } from './opds.ts'
import { davList } from './webdav.ts'
import { suwayomiCheck, suwayomiSources, type SuwayomiServer, type SuwayomiSource } from './suwayomi.ts'
import { registerCatalogResolver, type CatalogDef } from './catalogs.ts'
import { onPrefsReplaced, prefs, SECRET_PREFIX } from './prefs.ts'

/** the kinds the page connects by itself */
export const DEVICE_LIBRARY_TYPES: LibraryType[] = ['suwayomi', 'komga', 'kavita', 'opds', 'webdav']
/** the kinds read as a catalog (browsed, downloaded and read on this device) */
export const CATALOG_LIBRARY_TYPES: LibraryType[] = ['komga', 'kavita', 'opds', 'webdav']

/** kept with the person's settings (prefs.ts: this device, or the server for its web); each password apart,
 * under `SECRET_PREFIX` + its id, which a backup leaves out (see appsettings.ts) */
const KEY = 'estanteria.libraries'

interface Saved { id: string; type: LibraryType; name: string; url: string; username: string }

const state = reactive<{ list: Saved[]; errors: Record<string, string> }>({
  list: loadList(),
  errors: {},
})
function loadList(): Saved[] { try { return JSON.parse(prefs.get(KEY) || '[]') } catch (_) { return [] } }
function keep() { prefs.set(KEY, JSON.stringify(state.list)) }
function secretOf(id: string): string { return prefs.get(SECRET_PREFIX + id) || '' }

/** A Suwayomi library as the API calls want it (its address and credential); its images get the credential too. */
export function suwayomiServer(id: string): SuwayomiServer | null {
  const lib = state.list.find((l) => l.id === id && l.type === 'suwayomi')
  if (!lib) return null
  const secret = secretOf(id)
  const auth = lib.username || secret ? Api.basic(lib.username, secret) : ''
  setImageAuth(lib.url, auth)
  return { url: lib.url, auth }
}

/** A Suwayomi library's address and credential as they are (to hand them to the server, which follows a series of it). */
export function suwayomiCredentials(id: string): { url: string; username: string; secret: string } | null {
  const lib = state.list.find((l) => l.id === id && l.type === 'suwayomi')
  return lib ? { url: lib.url, username: lib.username, secret: secretOf(id) } : null
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
      // an OPDS or WebDAV address is kept as given (some answer only with their final slash)
      const url = ['opds', 'webdav'].includes(input.type) ? input.url.trim() : input.url.replace(/\/+$/, '')
      const saved: Saved = { id, type: input.type, name: input.name || nameFromUrl(url), url, username: input.username }
      if (input.type === 'suwayomi') {
        const server = { url, auth: input.username || secret ? Api.basic(input.username, secret) : '' }
        await suwayomiCheck(net, server)            // it answers and lets us in, or the reason why not
        setImageAuth(url, server.auth)
      } else {
        if (input.type === 'kavita' && !secret) throw new Error(t('Kavita necesita tu clave de API.'))
        const root = rootOf(saved, secret)
        setOriginHeaders(root, headersOf(saved, secret))
        try {
          if (input.type === 'webdav') await davList(net, root)
          else {
            const feed = await readFeed(net, root)
            if (!feed.navigation.length && !feed.entries.length && !feed.search) throw new Error(t('No parece un catálogo OPDS.'))
          }
        } catch (err: any) {
          const known = state.list.find((l) => l.id === id)
          setOriginHeaders(root, known ? headersOf(known, secretOf(id)) : {})
          throw new Error(t('No se pudo conectar con {name}: {error}', { name: saved.name, error: err?.message || String(err) }))
        }
      }
      if (input.secret) prefs.set(SECRET_PREFIX + id, input.secret)
      state.list = [...state.list.filter((l) => l.id !== id), saved]
      delete state.errors[id]
      keep()
      return { ...saved, hasSecret: !!secret }
    },
    async remove(id: string) {
      if (!state.list.some((l) => l.id === id)) return app?.remove(id)
      state.list = state.list.filter((l) => l.id !== id)
      prefs.remove(SECRET_PREFIX + id)
      keep()
    },
  }
}

// ---- Komga, Kavita, OPDS and WebDAV libraries: each one a catalog of its own ----
/** where its catalog starts: Komga's OPDS, Kavita's (with the API key in the address), the address as given */
function rootOf(lib: Saved, secret: string): string {
  const url = lib.url.replace(/\/+$/, '')
  if (lib.type === 'komga') return /\/opds\//.test(url) ? url : `${url}/opds/v1.2/catalog`
  if (lib.type === 'kavita') return /\/api\/opds\//.test(url) ? url : `${url}/api/opds/${encodeURIComponent(secret)}`
  return lib.url
}
/** what its requests carry: basic auth, or Komga's API key (no user), or nothing (Kavita: the key is in the address) */
function headersOf(lib: Saved, secret: string): Record<string, string> {
  if (lib.type === 'kavita' || (!lib.username && !secret)) return {}
  if (lib.type === 'komga' && !lib.username) return { 'X-API-Key': secret }
  return { Authorization: Api.basic(lib.username, secret) }
}
/** The Komga, Kavita, OPDS and WebDAV libraries connected (what «Catálogos» shows as «Tus bibliotecas»). */
export function catalogLibraries(): Saved[] {
  return state.list.filter((l) => CATALOG_LIBRARY_TYPES.includes(l.type))
}
/** A library as a catalog: its id is `lib:<library>`. Its requests get its credential from here on. */
export function libraryCatalog(id: string): CatalogDef | undefined {
  const lib = state.list.find((l) => l.id === id && CATALOG_LIBRARY_TYPES.includes(l.type))
  if (!lib) return undefined
  const secret = secretOf(id)
  const url = rootOf(lib, secret)
  setOriginHeaders(url, headersOf(lib, secret))
  return { id: `lib:${id}`, name: lib.name, protocol: lib.type === 'webdav' ? 'webdav' : 'opds', url, library: id,
           languages: ['multi'], content: lib.type === 'webdav' || lib.type === 'opds' ? ['books', 'comics'] : ['comics', 'manga'],
           description: t(LIBRARY_TYPES[lib.type].label) }
}
registerCatalogResolver((id) => (id.startsWith('lib:') ? libraryCatalog(id.slice(4)) : undefined))
// their credentials, ready for covers and downloads as soon as the app starts
for (const l of state.list) if (CATALOG_LIBRARY_TYPES.includes(l.type)) libraryCatalog(l.id)

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

// ---- the sources one does not want in Catálogos (a language of no interest, say), by library: on this device ----
const HIDDEN_KEY = 'estanteria.suwayomi.hidden'
function loadHidden(): Record<string, string[]> { try { return JSON.parse(prefs.get(HIDDEN_KEY) || '{}') } catch (_) { return {} } }
const hidden = reactive<Record<string, string[]>>(loadHidden())
function keepHidden() { prefs.set(HIDDEN_KEY, JSON.stringify(hidden)) }

// the settings moved (the web of a server: they come from it): what was read from them, read again
onPrefsReplaced(() => {
  state.list = loadList()
  state.errors = {}
  for (const l of state.list) if (CATALOG_LIBRARY_TYPES.includes(l.type)) libraryCatalog(l.id)
  for (const k of Object.keys(hidden)) delete hidden[k]
  Object.assign(hidden, loadHidden())
})

export function suwayomiHidden(library: string, source: string): boolean { return !!hidden[library]?.includes(source) }
export function setSuwayomiHidden(library: string, sources: string[], hide: boolean): void {
  const now = new Set(hidden[library] || [])
  for (const s of sources) hide ? now.add(s) : now.delete(s)
  hidden[library] = [...now]
  keepHidden()
}
/** the sources that show in Catálogos */
export function suwayomiVisibleSources(id: string): SuwayomiSource[] { return suwayomiSourcesNow(id).filter((s) => !suwayomiHidden(id, s.id)) }
export function suwayomiHiddenCount(id: string): number { return suwayomiSourcesNow(id).length - suwayomiVisibleSources(id).length }

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
