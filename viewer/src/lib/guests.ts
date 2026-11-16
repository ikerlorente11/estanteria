/** Guests: a friend's invitation to the catalog of their Suwayomi (see the service's guest.py). The link
 * (`https://<server>/invitacion/ABCD-EFGH-JKLM`) is used up once: the server gives this device a key, and the
 * catalog is then a Suwayomi library like any other (at `<server>/guest`, the key as its password). What is
 * downloaded from it stays on this device; nothing of it is kept on that server. */
import { t } from './i18n.ts'
import type { Library } from './libraries.ts'
import type { NetBackend } from './net.ts'

export interface Invitation { server: string; code: string }

/** The server and the code of an invitation link (or of `<server> <code>`, typed by hand); null if it is not one. */
export function parseInvitation(text: string): Invitation | null {
  const s = text.trim()
  const m = s.match(/^(https?:\/\/[^\s/]+(?:\/[^\s]*?)?)\/invitacion\/([A-Za-z0-9-]{8,40})\/?$/)
  if (m) return { server: m[1], code: m[2].toUpperCase() }
  return null
}

/** A guest library: a Suwayomi reached through a server's guest door. */
export function isGuestLibrary(lib: Pick<Library, 'type' | 'url'> | undefined | null): boolean {
  return !!lib && lib.type === 'suwayomi' && /\/guest\/?$/.test(lib.url)
}
/** the server a guest library belongs to */
export function guestServer(lib: Pick<Library, 'url'>): string { return lib.url.replace(/\/guest\/?$/, '') }

async function answer<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = body?.detail
    throw new Error(typeof detail === 'string' && detail ? detail : t('El servidor respondió {status}', { status: res.status }))
  }
  return body as T
}

/** Uses up an invitation: the name the guest was given, the key of this device and where the catalog is. */
export async function joinWithInvitation(net: NetBackend, invitation: Invitation, device: string): Promise<{ name: string; key: string; url: string }> {
  const res = await net.fetch(`${invitation.server}/guest/join`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ code: invitation.code, device }),
  })
  return answer(res)
}

/** A link to add another device of the guest (good for 15 minutes). */
export async function pairDevice(net: NetBackend, lib: Pick<Library, 'url'>, auth: string): Promise<{ link: string; code: string; expires: number }> {
  const res = await net.fetch(`${guestServer(lib)}/guest/pair`, { method: 'POST', headers: { Authorization: auth, Accept: 'application/json' } })
  return answer(res)
}

/** This device out of the guest's (their key stops working; the other devices stay). Never fails: the
 * library goes anyway. */
export async function leaveGuest(net: NetBackend, lib: Pick<Library, 'url'>, auth: string): Promise<void> {
  try { await net.fetch(`${guestServer(lib)}/guest/me`, { method: 'DELETE', headers: { Authorization: auth } }) } catch (_) { /* offline: the key just stays unused */ }
}

/** What the owner of a server sees of its guests (`/api/guests`). */
export interface GuestInfo {
  id: number
  name: string
  created: number
  last_seen: number | null
  requests: number
  bytes: number
  devices: number
  extensions: number
}
export interface GuestInvite { id: number; name: string; guest_id: number | null; created: number; expires: number }
export interface GuestsStatus { enabled: boolean; admin: boolean; guests: GuestInfo[]; invites: GuestInvite[] }
export interface NewInvite extends GuestInvite { code: string; link: string }
