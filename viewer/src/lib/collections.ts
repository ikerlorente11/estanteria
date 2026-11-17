/**
 * Collections: groups the person makes («Mafalda», «The Flash») of anything of the library — series of the shelf,
 * single files, series of a catalog —, the same thing in as many as wanted (a comic in «The Flash» and in «DC»).
 * They are records of sync.ts (kind `collection`), so with a server of one's own every device has them:
 *  - a collection: `col:<id>` → its name;
 *  - what is in it: `in:<id>:<what>` → what shows it, `<what>` keyed as a favourite (`series:…`, `item:<path>`,
 *    `catalog:…`; see favorites.ts), so the server moves it along with its file. A file of this device alone
 *    (`local:<id here>`) is in it on this device only: `local:in:<id>:local:<id here>`.
 */
import type { Favorite } from './favorites.ts'
import { syncGet, syncPut, syncRecords } from './sync.ts'

export interface Collection {
  name: string
  /** seconds since 1970 */
  created: number
}

export interface CollectionInfo extends Collection {
  id: string
  /** how many things are in it */
  count: number
}

/** something to put in a collection: as a favourite of it is made (seriesFavorite, itemFavorite, catalogFavorite) */
export interface Member { key: string; value: Favorite; onlyHere?: boolean }

const colKey = (id: string) => `col:${id}`
const memberKey = (id: string, what: string) => (what.startsWith('local:') ? `local:in:${id}:${what}` : `in:${id}:${what}`)
/** what a member's record is about: `in:<id>:<what>` or `local:in:<id>:<what>` */
function parseMember(key: string): { id: string; what: string } | null {
  const m = key.match(/^(?:local:)?in:([^:]+):(.+)$/)
  return m ? { id: m[1], what: m[2] } : null
}

/** A new id: short, and unlikely to meet another device's. */
function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

/** Every collection, by name, with how many things each has. */
export function collections(): CollectionInfo[] {
  const records = syncRecords<Collection | Favorite>('collection')
  const counts = new Map<string, number>()
  for (const r of records) {
    const m = parseMember(r.key)
    if (m) counts.set(m.id, (counts.get(m.id) || 0) + 1)
  }
  return records.filter((r) => r.key.startsWith('col:') && r.value)
    .map((r) => ({ id: r.key.slice(4), ...(r.value as Collection), count: counts.get(r.key.slice(4)) || 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))
}

export function collection(id: string): Collection | null {
  return syncGet<Collection>('collection', colKey(id))
}

/** Makes one (or answers the one with that name already); its id. */
export function createCollection(name: string): string {
  const clean = name.replace(/\s+/g, ' ').trim()
  if (!clean) throw new Error('empty name')
  const same = collections().find((c) => c.name.toLowerCase() === clean.toLowerCase())
  if (same) return same.id
  const id = newId()
  syncPut('collection', colKey(id), { name: clean, created: Date.now() / 1000 } as Collection)
  return id
}

export function renameCollection(id: string, name: string): void {
  const now = collection(id)
  const clean = name.replace(/\s+/g, ' ').trim()
  if (now && clean) syncPut('collection', colKey(id), { ...now, name: clean })
}

/** Deletes it, and what was in it is in it no more (the things themselves stay where they are). */
export function deleteCollection(id: string): void {
  for (const r of syncRecords('collection')) {
    if (parseMember(r.key)?.id === id) syncPut('collection', r.key, null, r.key.startsWith('local:'))
  }
  syncPut('collection', colKey(id), null)
}

/** What is in a collection, the last put first. */
export function membersOf(id: string): Member[] {
  return syncRecords<Favorite>('collection')
    .map((r) => ({ r, m: parseMember(r.key) }))
    .filter(({ r, m }) => m?.id === id && r.value)
    .map(({ r, m }) => ({ key: m!.what, value: r.value!, onlyHere: r.key.startsWith('local:') }))
    .sort((a, b) => (b.value.added || 0) - (a.value.added || 0))
}

export function isInCollection(id: string, what: string): boolean {
  return !!syncGet('collection', memberKey(id, what))
}

/** Puts it in the collection, or takes it out. */
export function setInCollection(id: string, member: Member, on: boolean): void {
  const value = on ? { ...member.value, added: Date.now() / 1000 } : null
  syncPut('collection', memberKey(id, member.key), value, member.key.startsWith('local:') || !!member.onlyHere)
}

/** The collections something is in. */
export function collectionsOf(what: string): string[] {
  return collections().filter((c) => isInCollection(c.id, what)).map((c) => c.id)
}
