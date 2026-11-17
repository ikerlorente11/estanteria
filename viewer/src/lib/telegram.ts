/**
 * A Telegram account read as a library: its channels and groups to go into, the comics and books sent to each
 * (documents whose name the app reads) to download, a piece at a time, into the Keeper of always (keeper.ts:
 * this device, and the Archivador when one is connected).
 *
 * The device itself talks to Telegram (MTProto over WebSocket, `src/vendor/teleproto`), signed in as the
 * person; no server is in between. The session stays on this device: in its secure store when the app has one
 * (NativeFeatures.secrets), else in this browser's storage under DEVICE_SECRET_PREFIX (never synced, never in a
 * backup). The app's own credentials (TelegramApp) come from each host's configuration.
 *
 * Addresses of the catalog: `tg:` the chats; `tg:<peer>` what was sent to one: its documents, or with
 * `?media=photos|videos` its images or videos (`?before=<message>` the next page, `?q=<text>` a search). A file:
 * `tg:<account>/<peer>/<message>`, which is also its key as kept (the account in it, since a message number of a
 * group is the account's own). Images are seen as a «chapter» of the catalog (ChapterReader): `<peer>:<messages>@<start>`.
 */
import { reactive } from 'vue'
import { cancelled } from './catalogdownloads.ts'
import { t } from './i18n.ts'
import type { NativeFeatures } from './native.ts'
import type { StreamSource } from './net.ts'
import type { Feed, FeedEntry } from './opds.ts'
import { DEVICE_SECRET_PREFIX } from './prefs.ts'
import type { TelegramApp } from './store.ts'
import { formatOfName, sizeText } from './webdav.ts'
import { storeZip } from './zipstore.ts'

/** documents asked for each time (Telegram gives up to 100) */
export const PAGE = 100
/** a download goes in segments of this many bytes, a few at once (each a run of 1 MB requests, Telegram's most) */
export const SEGMENT = 8 * 2 ** 20
export const AT_ONCE = 3
const REQUEST = 2 ** 20
/** images at full size kept in memory (the reader asks for a few around the page shown) */
const FULL_KEPT = 12

// ---- addresses (pure) ----
export const ROOT = 'tg:'

/** what of a chat is shown: its documents (files the app reads), its images or its videos */
export type ChatMedia = 'docs' | 'photos' | 'videos'
export const CHAT_MEDIA: ChatMedia[] = ['docs', 'photos', 'videos']

/** `media` null: not chosen (the first that has something, see telegramFeed) */
export interface ChatAddress { peer: string; before: number | null; q: string; media: ChatMedia | null }

/** The chat an address of the catalog is about (null: the list of chats). */
export function parseAddress(address: string): ChatAddress | null {
  const m = address.match(/^tg:(-?\d+)(?:\?(.*))?$/)
  if (!m) return null
  const query = new URLSearchParams(m[2] || '')
  const before = Number(query.get('before'))
  const media = query.get('media') as ChatMedia | null
  return { peer: m[1], before: before > 0 ? before : null, q: query.get('q') || '', media: media && CHAT_MEDIA.includes(media) ? media : null }
}

export function chatAddress(peer: string, opts: { before?: number | null; q?: string; media?: ChatMedia | null } = {}): string {
  const query = new URLSearchParams()
  if (opts.media) query.set('media', opts.media)
  if (opts.before) query.set('before', String(opts.before))
  if (opts.q) query.set('q', opts.q)
  const s = query.toString()
  return `tg:${peer}${s ? `?${s}` : ''}`
}

export interface FileRef { account: string; peer: string; message: number }

/** A file's address in the catalog, also its key as kept. */
export function fileHref(ref: FileRef): string {
  return `tg:${ref.account}/${ref.peer}/${ref.message}`
}

export function parseFileHref(href: string): FileRef | null {
  const m = href.match(/^tg:(\d+)\/(-?\d+)\/(\d+)$/)
  return m ? { account: m[1], peer: m[2], message: Number(m[3]) } : null
}

export const isTelegramHref = (href: string | null | undefined) => !!href && href.startsWith('tg:')

// ---- what Telegram answers, as the catalog shows it (pure) ----
export interface TgChat { id: string; title: string; kind: 'channel' | 'group'; photo: boolean }

export interface TgDocument {
  message: number
  name: string
  size: number
  mime: string
  /** seconds */
  date: number
  caption: string
}

/** an image or a video sent to a chat */
export interface TgMedia {
  message: number
  kind: 'photo' | 'video'
  /** the album it was sent in (several at once), if any */
  album: string | null
  /** seconds */
  date: number
  caption: string
  /** bytes (a video's; 0 for an image) */
  size: number
  /** seconds (a video's) */
  duration: number
}

/** how many documents, images and videos a chat has (or match the search) */
export type MediaCounts = Record<ChatMedia, number>

export interface TgPage {
  docs: TgDocument[]
  media: TgMedia[]
  /** how many documents the chat has (or match the search) */
  total: number | null
  /** the last message of the page (readable or not), where the next one starts; null when there is no more */
  next: number | null
}

export function chatsFeed(chats: TgChat[], account: string): Feed {
  return {
    url: ROOT,
    title: account,
    subtitle: t('Tus canales y grupos de Telegram'),
    navigation: chats.map((c) => ({ title: c.title || '?', href: chatAddress(c.id), subtitle: c.kind === 'channel' ? t('Canal') : t('Grupo'),
                                    icon: c.photo ? `tgphoto:${c.id}` : null })),
    entries: [],
    next: null,
    search: null,
  }
}

/** The title a file is shown with: its name without the extension. */
export function titleOfName(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim() || name
}

/** The tabs of a chat (Archivos, Imágenes, Vídeos) with how many each has; the one shown, marked. */
export function chatTabs(peer: string, counts: MediaCounts | null, at: ChatAddress): NonNullable<Feed['tabs']> {
  const labels: Record<ChatMedia, string> = { docs: t('Archivos'), photos: t('Imágenes'), videos: t('Vídeos') }
  return CHAT_MEDIA.map((media) => ({ label: labels[media], href: chatAddress(peer, { media, q: at.q }), count: counts ? counts[media] : null,
                                      active: (at.media || 'docs') === media }))
}

/** «1:05», «1:02:09» */
export function durationText(s: number): string {
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(Math.floor(s % 60)).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

export function chatFeed(account: string, chat: { peer: string; title: string }, page: TgPage, at: ChatAddress, counts: MediaCounts | null): Feed {
  const media = at.media || 'docs'
  const entries: FeedEntry[] = media === 'docs' ? documentEntries(account, chat.peer, page.docs) : page.media.map((m) => {
    const href = fileHref({ account, peer: chat.peer, message: m.message })
    const when = m.date ? new Date(m.date * 1000).toLocaleDateString() : ''
    return {
      id: href, title: m.caption.split('\n')[0].slice(0, 120) || when, author: null, summary: m.caption || null, cover: null, language: null,
      offers: [], href: null, detail: [m.kind === 'video' ? durationText(m.duration) : '', m.size ? sizeText(m.size) : '', when].filter(Boolean).join(' · '),
      media: { kind: m.kind, album: m.album, duration: m.duration, size: m.size, date: m.date },
    }
  })
  const total = counts ? counts[media] : page.total
  const what = media === 'docs' ? '{n} documentos' : media === 'photos' ? '{n} imágenes' : '{n} vídeos'
  const here = chatAddress(chat.peer, { media: at.media })
  return {
    url: chatAddress(chat.peer, at),
    title: chat.title,
    subtitle: total !== null ? t(what, { n: total }) : null,
    navigation: [],
    entries,
    next: page.next ? chatAddress(chat.peer, { before: page.next, q: at.q, media: at.media }) : null,
    search: `${here}${here.includes('?') ? '&' : '?'}q={searchTerms}`,
    tabs: chatTabs(chat.peer, counts, at),
  }
}

/** The images of a chat as a «chapter» to read: their messages (in the order read) and where to start. */
export function photosChapter(peer: string, messages: number[], start: number): string {
  return `${peer}:${messages.join(',')}@${Math.max(0, start)}`
}
export function parsePhotosChapter(chapter: string): { peer: string; messages: number[]; start: number } | null {
  const m = chapter.match(/^(-?\d+):([\d,]+)@(\d+)$/)
  if (!m) return null
  const messages = m[2].split(',').filter(Boolean).map(Number)
  return messages.length ? { peer: m[1], messages, start: Math.min(Number(m[3]), messages.length - 1) } : null
}

function documentEntries(account: string, peer: string, docs: TgDocument[]): FeedEntry[] {
  const entries: FeedEntry[] = []
  for (const d of docs) {
    const format = formatOfName(d.name)
    if (!format) continue
    const href = fileHref({ account, peer, message: d.message })
    const when = d.date ? new Date(d.date * 1000).toLocaleDateString() : ''
    entries.push({
      id: href, title: titleOfName(d.name), author: null, summary: d.caption || null, cover: null, language: null,
      offers: [{ href, type: d.mime || 'application/octet-stream', format }], href: null,
      detail: [sizeText(d.size), when].filter(Boolean).join(' · '),
    })
  }
  return entries
}

// ---- a download: segments fetched a few at once, handed on in order (pure) ----
export type RangeReader = (offset: number, limit: number, signal: AbortSignal) => AsyncIterable<Uint8Array>

/** The `size` bytes `read` gives, in order, fetched `atOnce` segments at a time (each kept here until its turn:
 * at most atOnce × segment bytes in memory). */
export async function* readInOrder(read: RangeReader, size: number, signal: AbortSignal,
                                   segment = SEGMENT, atOnce = AT_ONCE): AsyncGenerator<Uint8Array> {
  const count = Math.ceil(size / segment)
  const stop = new AbortController()
  const onAbort = () => stop.abort()
  signal.addEventListener('abort', onAbort, { once: true })
  const fetchSegment = async (i: number): Promise<Uint8Array[]> => {
    const want = Math.min(segment, size - i * segment)
    const out: Uint8Array[] = []
    let got = 0
    for await (const bytes of read(i * segment, want, stop.signal)) {
      const take = bytes.length > want - got ? bytes.subarray(0, want - got) : bytes
      out.push(take)
      got += take.length
      if (got >= want) break
    }
    if (got < want) throw new Error(t('Telegram cortó la descarga ({got} de {want} bytes)', { got: i * segment + got, want: size }))
    return out
  }
  const going: (Promise<Uint8Array[]> | undefined)[] = []
  let started = 0
  try {
    for (let i = 0; i < count; i++) {
      while (started < count && started < i + atOnce) {
        const p = fetchSegment(started)
        p.catch(() => {})                  // a later one failing while an earlier one is awaited
        going[started++] = p
      }
      if (signal.aborted) throw cancelled()
      const pieces = await going[i]!
      going[i] = undefined
      for (const bytes of pieces) yield bytes
    }
  } catch (err) {
    throw signal.aborted ? cancelled() : err
  } finally {
    stop.abort()
    signal.removeEventListener('abort', onAbort)
  }
}

// ---- where the session stays ----
export interface SessionStore {
  get(id: string): Promise<string | null>
  set(id: string, value: string | null): Promise<void>
}

/** The device's secure store when the app has one; else this browser's storage (the web). */
export function sessionStore(native?: NativeFeatures): SessionStore {
  const secrets = native?.secrets
  const key = (id: string) => `${DEVICE_SECRET_PREFIX}telegram.${id}`
  if (secrets) return { get: (id) => secrets.get(key(id)), set: (id, value) => secrets.set(key(id), value) }
  return {
    async get(id) { try { return localStorage.getItem(key(id)) } catch (_) { return null } },
    async set(id, value) {
      try { if (value === null) localStorage.removeItem(key(id)); else localStorage.setItem(key(id), value) } catch (_) { /* storage off */ }
    },
  }
}

// ---- the chats one does not want to see (by library, on this device, as its session: a server keeps only the
// settings it knows, see prefs.ts PREF_KEYS, and one it refuses would hold back the others with it) ----
const HIDDEN_KEY = 'estanteria.telegram.hidden'
function loadHidden(): Record<string, string[]> { try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') || {} } catch (_) { return {} } }
const hidden = reactive<Record<string, string[]>>(loadHidden())

/** the chats of a library hidden from its list */
export function telegramHidden(libraryId: string): string[] { return hidden[libraryId] || [] }
export function setTelegramHidden(libraryId: string, peers: string[], hide: boolean): void {
  const now = new Set(hidden[libraryId] || [])
  for (const p of peers) hide ? now.add(p) : now.delete(p)
  hidden[libraryId] = [...now]
  try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden)) } catch (_) { /* storage off: this session only */ }
}

/** which Telegram libraries have a session on this device (what Bibliotecas shows: «Ver», or «Entrar») */
export const telegramSignedIn = reactive<Record<string, boolean>>({})

/** Looks whether a library has a session kept here (without connecting). */
export async function checkTelegramSession(host: TelegramHost, libraryId: string): Promise<boolean> {
  const there = !!(await sessionStore(host.native).get(libraryId).catch(() => null))
  telegramSignedIn[libraryId] = there
  return there
}

// ---- the account ----
type Teleproto = typeof import('../vendor/teleproto/teleproto.js')
let loading: Promise<Teleproto> | null = null
/** ~1.5 MB: only when a Telegram library is used */
const teleproto = () => (loading ||= import('../vendor/teleproto/teleproto.js'))

/** How the person signs in, step by step (the page asks; each answer comes back here). */
export interface LoginSteps {
  /** a QR (`tg://login?token=…`) to scan with Telegram on the phone; called again each time it is renewed */
  qr?(link: string): void
  phone?(): Promise<string>
  /** the code Telegram sent (`inApp`: to Telegram on another device, else by SMS) */
  code?(inApp: boolean): Promise<string>
  /** the two-step verification password, when the account has one */
  password(hint: string | undefined): Promise<string>
  /** a step went wrong (a wrong code); it is asked again */
  error(message: string): void
  signal: AbortSignal
}

/** What the person's Telegram shows of this session in its list of devices. */
export interface TelegramDevice { model: string; system: string; version: string }

export interface TelegramAccount { id: string; name: string; username: string | null }

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A Telegram error as a sentence (FLOOD_WAIT, a wrong code…). */
export function telegramError(err: any): string {
  const code = String(err?.errorMessage || err?.message || err || '')
  if (/^FLOOD_WAIT/.test(code) || err?.seconds) return t('Telegram pide esperar {s} s antes de seguir', { s: err?.seconds ?? '?' })
  if (code === 'PHONE_CODE_INVALID') return t('Ese código no es el que mandó Telegram')
  if (code === 'PHONE_CODE_EXPIRED') return t('El código caducó: pide otro')
  if (code === 'PASSWORD_HASH_INVALID') return t('La contraseña no es esa')
  if (code === 'PHONE_NUMBER_INVALID') return t('Ese número de teléfono no vale')
  if (code === 'API_ID_INVALID') return t('Telegram no reconoce las credenciales de la app')
  if (code === 'AUTH_KEY_UNREGISTERED' || code === 'SESSION_REVOKED') return t('La sesión de Telegram se cerró: vuelve a entrar')
  return code || t('Telegram no respondió')
}

export class TelegramLink {
  private client: any = null
  private chats = new Map<string, { entity: any; full: any; title: string }>()
  /** each chat's picture, as a blob URL (kept while the app runs) */
  private photos = new Map<string, Promise<string | null>>()
  private photosGoing = 0
  private photosWaiting: (() => void)[] = []
  /** the messages seen (by `peer/message`), to fetch their media without asking for them again */
  private seen = new Map<string, any>()
  /** each image's or video's thumbnail as a blob URL (small; kept while the app runs) */
  private thumbs = new Map<string, Promise<string | null>>()
  /** images at full size as blob URLs, the newest few only (they are big) */
  private full = new Map<string, Promise<string>>()
  /** how many documents, images and videos each chat has (asked once per chat and search) */
  private counted = new Map<string, MediaCounts>()
  account: TelegramAccount | null = null
  readonly id: string
  private app: TelegramApp
  private sessions: SessionStore
  private device: TelegramDevice

  constructor(id: string, app: TelegramApp, sessions: SessionStore, device: TelegramDevice) {
    this.id = id
    this.app = app
    this.sessions = sessions
    this.device = device
  }

  private async open(session: string): Promise<any> {
    const { TelegramClient, sessions } = await teleproto()
    const client = new TelegramClient(new sessions.StringSession(session), this.app.apiId, this.app.apiHash, {
      connectionRetries: 5, deviceModel: this.device.model, systemVersion: this.device.system, appVersion: this.device.version,
      langCode: 'es', systemLangCode: 'es',
    })
    client.setLogLevel?.('error')
    await client.connect()
    return client
  }

  private async whoAmI(): Promise<void> {
    const me = await this.client.getMe()
    const name = [me.firstName, me.lastName].filter(Boolean).join(' ') || me.username || String(me.id)
    this.account = { id: String(me.id), name, username: me.username || null }
  }

  /** Connected with the session kept on this device; false when there is none or Telegram no longer takes it. */
  async resume(): Promise<boolean> {
    if (this.client && this.account) return true
    const saved = await this.sessions.get(this.id)
    if (!saved) { telegramSignedIn[this.id] = false; return false }
    const client = await this.open(saved)
    if (!(await client.checkAuthorization().catch(() => false))) {
      // closed from Telegram (its list of devices) or expired: forgotten here too
      await client.destroy().catch(() => {})
      await this.sessions.set(this.id, null)
      telegramSignedIn[this.id] = false
      return false
    }
    this.client = client
    await this.whoAmI()
    telegramSignedIn[this.id] = true
    return true
  }

  /** Signs in (with a QR, or the phone and the code Telegram sends) and keeps the session on this device. */
  async login(how: 'qr' | 'phone', steps: LoginSteps): Promise<TelegramAccount> {
    const client = await this.open('')
    const credentials = { apiId: this.app.apiId, apiHash: this.app.apiHash }
    const onError = async (err: any) => {
      if (steps.signal.aborted) return true
      steps.error(telegramError(err))
      return false
    }
    const password = (hint?: string) => steps.password(hint)
    try {
      if (how === 'qr') {
        await client.signInUserWithQrCode(credentials, {
          qrCode: async ({ token }: { token: Uint8Array }) => steps.qr?.(`tg://login?token=${base64url(token)}`),
          password, onError, abortSignal: steps.signal,
        })
      } else {
        await client.signInUser(credentials, {
          phoneNumber: () => steps.phone!(), phoneCode: (inApp?: boolean) => steps.code!(!!inApp), password, onError,
        })
      }
      if (steps.signal.aborted) throw cancelled()
    } catch (err) {
      await client.destroy().catch(() => {})
      throw steps.signal.aborted ? cancelled() : err
    }
    this.client = client
    await this.sessions.set(this.id, client.session.save())
    await this.whoAmI()
    telegramSignedIn[this.id] = true
    return this.account!
  }

  /** Closes the session in Telegram (it leaves the person's list of devices) and forgets it here. */
  async logout(): Promise<void> {
    if (!this.client) await this.resume().catch(() => false)
    if (this.client) {
      const { Api } = await teleproto()
      await this.client.invoke(new Api.auth.LogOut()).catch(() => {})
      await this.client.destroy().catch(() => {})
    }
    this.client = null
    this.account = null
    this.chats.clear()
    await this.sessions.set(this.id, null)
    telegramSignedIn[this.id] = false
  }

  private async connected(): Promise<any> {
    if (!(await this.resume())) throw new Error(t('La sesión de Telegram se cerró: vuelve a entrar'))
    return this.client
  }

  /** The channels and groups of the account (where documents can be). */
  async listChats(): Promise<TgChat[]> {
    const client = await this.connected()
    const dialogs = await client.getDialogs({})
    const out: TgChat[] = []
    for (const d of dialogs) {
      if (!d.isChannel && !d.isGroup) continue
      const id = String(d.id)
      const title = d.title || d.name || '?'
      const photo = !!d.entity?.photo && d.entity.photo.className !== 'ChatPhotoEmpty'
      this.chats.set(id, { entity: d.inputEntity || d.entity, full: d.entity, title })
      out.push({ id, title, kind: d.isChannel && !d.isGroup ? 'channel' : 'group', photo })
    }
    return out
  }

  /** A chat's picture (small), as a blob URL; null when it has none. A few at a time, kept while the app runs. */
  chatPhoto(peer: string): Promise<string | null> {
    let going = this.photos.get(peer)
    if (!going) {
      going = this.inTurn(async () => {
        const client = await this.connected()
        const chat = await this.chat(peer)
        const bytes: Uint8Array | undefined = await client.downloadProfilePhoto(chat.full, { isBig: false })
        return bytes?.length ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null
      }).catch(() => null)
      this.photos.set(peer, going)
    }
    return going
  }

  private async chat(peer: string): Promise<{ entity: any; full: any; title: string }> {
    if (!this.chats.has(peer)) await this.listChats()
    const found = this.chats.get(peer)
    if (!found) throw new Error(t('Ese chat ya no está en tu Telegram'))
    return found
  }

  private async filterOf(media: ChatMedia): Promise<any> {
    const { Api } = await teleproto()
    return media === 'photos' ? new Api.InputMessagesFilterPhotos() : media === 'videos' ? new Api.InputMessagesFilterVideo() : new Api.InputMessagesFilterDocument()
  }

  /** How many documents, images and videos a chat has (or match `q`), in one question to Telegram. */
  async counts(peer: string, q = ''): Promise<MediaCounts> {
    const key = `${peer}?${q}`
    const known = this.counted.get(key)
    if (known) return known
    const client = await this.connected()
    const chat = await this.chat(peer)
    let counts: MediaCounts
    if (q) {
      // the counters do not search: one message of each tells the total
      const totals = await Promise.all(CHAT_MEDIA.map(async (media) => {
        const got = await client.getMessages(chat.entity, { limit: 1, filter: await this.filterOf(media), search: q })
        return typeof got.total === 'number' ? got.total : got.length
      }))
      counts = { docs: totals[0], photos: totals[1], videos: totals[2] }
    } else {
      const { Api } = await teleproto()
      const answer = await client.invoke(new Api.messages.GetSearchCounters({
        peer: chat.entity, filters: await Promise.all(CHAT_MEDIA.map((media) => this.filterOf(media))),
      }))
      counts = { docs: answer[0]?.count ?? 0, photos: answer[1]?.count ?? 0, videos: answer[2]?.count ?? 0 }
    }
    this.counted.set(key, counts)
    return counts
  }

  /** A page of what was sent to a chat, newest first: its documents, images or videos (or those whose text has `q`). */
  async messages(at: ChatAddress): Promise<{ title: string; page: TgPage }> {
    const client = await this.connected()
    const chat = await this.chat(at.peer)
    const media = at.media || 'docs'
    const messages = await client.getMessages(chat.entity, {
      limit: PAGE, filter: await this.filterOf(media), offsetId: at.before || 0, search: at.q || undefined,
    })
    const docs: TgDocument[] = []
    const shown: TgMedia[] = []
    for (const m of messages) {
      this.seen.set(`${at.peer}/${m.id}`, m)
      const caption = m.message || ''
      const album = m.groupedId ? String(m.groupedId) : null
      if (media === 'photos' && m.photo) {
        shown.push({ message: m.id, kind: 'photo', album, date: m.date || 0, caption, size: 0, duration: 0 })
      } else if (media === 'videos' && m.document) {
        const video = m.document.attributes?.find((a: any) => a.className === 'DocumentAttributeVideo')
        shown.push({ message: m.id, kind: 'video', album, date: m.date || 0, caption, size: Number(m.document.size), duration: Number(video?.duration || 0) })
      } else if (media === 'docs' && m.document) {
        const name = m.document.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName
        if (name) docs.push({ message: m.id, name, size: Number(m.document.size), mime: m.document.mimeType || '', date: m.date || 0, caption })
      }
    }
    const last = messages.length ? messages[messages.length - 1].id : null
    return { title: chat.title, page: { docs, media: shown, total: typeof messages.total === 'number' ? messages.total : null,
                                        next: messages.length === PAGE ? last : null } }
  }

  /** A message of a chat (the one seen, else asked for). */
  private async message(peer: string, id: number): Promise<any> {
    const known = this.seen.get(`${peer}/${id}`)
    if (known) return known
    const client = await this.connected()
    const chat = await this.chat(peer)
    const [m] = await client.getMessages(chat.entity, { ids: [id] })
    if (m) this.seen.set(`${peer}/${id}`, m)
    return m
  }

  /** Runs `work` when one of three turns is free (pictures are many small requests: a few at a time). */
  private async inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (this.photosGoing >= 3) await new Promise<void>((r) => this.photosWaiting.push(r))
    this.photosGoing++
    try { return await work() } finally {
      this.photosGoing--
      this.photosWaiting.shift()?.()
    }
  }

  /** An image's or a video's thumbnail (about 320 px), as a blob URL; null when it has none. */
  thumb(peer: string, id: number): Promise<string | null> {
    const key = `${peer}/${id}`
    let going = this.thumbs.get(key)
    if (!going) {
      going = this.inTurn(async () => {
        const client = await this.connected()
        const m = await this.message(peer, id)
        const sizes: any[] = (m?.photo?.sizes || m?.document?.thumbs || []).filter((z: any) => z.className === 'PhotoSize' || z.className === 'PhotoSizeProgressive')
        const size = sizes.find((z) => z.type === 'm') || sizes.find((z) => z.type === 'x') || sizes[sizes.length - 1]
        if (!size) return null
        const bytes: Uint8Array | undefined = await client.downloadMedia(m, { thumb: size })
        return bytes?.length ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null
      }).catch(() => null)
      this.thumbs.set(key, going)
    }
    return going
  }

  /** An image at full size, its bytes (to keep it: not kept here). */
  async photoBytes(peer: string, id: number, signal?: AbortSignal): Promise<Uint8Array> {
    const client = await this.connected()
    const m = await this.message(peer, id)
    if (!m?.photo) throw new Error(t('Esa imagen ya no está en Telegram'))
    const bytes: Uint8Array | undefined = await client.downloadMedia(m, { signal })
    if (!bytes?.length) throw new Error(t('Telegram no dio la imagen'))
    return bytes
  }

  /** An image at full size, as a blob URL (the last few are kept; older ones are let go). */
  photo(peer: string, id: number): Promise<string> {
    const key = `${peer}/${id}`
    let going = this.full.get(key)
    if (!going) {
      going = (async () => {
        const client = await this.connected()
        const m = await this.message(peer, id)
        if (!m?.photo) throw new Error(t('Esa imagen ya no está en Telegram'))
        const bytes: Uint8Array | undefined = await client.downloadMedia(m, {})
        if (!bytes?.length) throw new Error(t('Telegram no dio la imagen'))
        return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
      })()
      going.catch(() => this.full.delete(key))
      this.full.set(key, going)
      // the reader keeps a few pages around the one shown: the rest go
      while (this.full.size > FULL_KEPT) {
        const [oldKey, old] = this.full.entries().next().value!
        this.full.delete(oldKey)
        void old.then((url) => URL.revokeObjectURL(url), () => {})
      }
    }
    return going
  }

  /** A document (or a video) to download or see, a piece at a time. */
  async file(peer: string, message: number): Promise<StreamSource & { name: string; mime: string }> {
    const client = await this.connected()
    const m = await this.message(peer, message)
    const doc = m?.document
    if (!doc) throw new Error(t('Ese archivo ya no está en Telegram'))
    const name = doc.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName || `${message}`
    const size = Number(doc.size)
    const range: RangeReader = (offset, limit, signal) => client.iterDownload(m, { offset, limit, requestSize: REQUEST, signal })
    return { name, size, mime: doc.mimeType || 'application/octet-stream', read: (signal) => readInOrder(range, size, signal) }
  }

  /** Lets go of the connection (the session stays kept). */
  async close(): Promise<void> {
    const client = this.client
    this.client = null
    await client?.destroy().catch(() => {})
  }
}

// ---- the catalog of a Telegram library ----
/** A page of the catalog: the chats (`tg:`), or the documents of one. */
export async function telegramFeed(link: TelegramLink, address: string | undefined): Promise<Feed> {
  if (!(await link.resume())) throw new Error(t('Entra en tu Telegram desde Bibliotecas para ver tus canales en este dispositivo.'))
  const at = parseAddress(address || ROOT)
  if (!at) return chatsFeed(await link.listChats(), link.account!.name)
  const counts = await link.counts(at.peer, at.q).catch(() => null)
  // not chosen: its documents, or what it has when it has none (a channel of images)
  if (!at.media) at.media = !counts || counts.docs ? 'docs' : counts.photos ? 'photos' : counts.videos ? 'videos' : 'docs'
  const { title, page } = await link.messages(at)
  return chatFeed(link.account!.id, { peer: at.peer, title }, page, at, counts)
}

/** The images of a «chapter» (see photosChapter), to read in the comic reader: each page, fetched when asked. */
export function telegramChapter(link: TelegramLink, chapter: string): { count: number; start: number; page: (n: number) => Promise<string> } {
  const found = parsePhotosChapter(chapter)
  if (!found) throw new Error(t('Esas imágenes ya no se pueden abrir'))
  return { count: found.messages.length, start: found.start, page: (n) => link.photo(found.peer, found.messages[n]) }
}

/** The file of an entry of the catalog (its href), to download a piece at a time. */
export async function telegramFile(link: TelegramLink, href: string): Promise<StreamSource & { name: string }> {
  const ref = parseFileHref(href)
  if (!ref) throw new Error(t('Esa dirección no es de un archivo de Telegram'))
  if (!(await link.resume())) throw new Error(t('La sesión de Telegram se cerró: vuelve a entrar'))
  if (link.account?.id !== ref.account) throw new Error(t('Ese archivo es de otra cuenta de Telegram'))
  return link.file(ref.peer, ref.message)
}

// ---- images kept as a comic (CBZ), to read and to put in collections ----
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** The ComicInfo.xml of images kept from a chat: its name, its series (a collection, or the chat) and where they came from. */
export function photosComicInfo(info: { title: string; series: string; chat: string; pages: number; date?: number }): string {
  const day = info.date ? new Date(info.date * 1000) : null
  return '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>'
    + `<Title>${xml(info.title)}</Title><Series>${xml(info.series)}</Series><PageCount>${info.pages}</PageCount>`
    + (day ? `<Year>${day.getFullYear()}</Year><Month>${day.getMonth() + 1}</Month><Day>${day.getDate()}</Day>` : '')
    + `<Notes>${xml(t('Imágenes de «{chat}», en Telegram', { chat: info.chat }))}</Notes></ComicInfo>`
}

/** The images of a chat (`messages`, in the order to read) packed as a CBZ: each fetched at full size, telling how
 * many came; with its ComicInfo.xml. */
export async function telegramPhotosCbz(link: TelegramLink, peer: string, messages: number[], comicInfo: string,
                                        progress: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob> {
  const files: { name: string; data: Uint8Array }[] = [{ name: 'ComicInfo.xml', data: new TextEncoder().encode(comicInfo) }]
  const width = String(messages.length).length < 3 ? 3 : String(messages.length).length
  progress(0, messages.length)
  for (const [i, id] of messages.entries()) {
    if (signal.aborted) throw cancelled()
    files.push({ name: `${String(i + 1).padStart(width, '0')}.jpg`, data: await link.photoBytes(peer, id, signal) })
    progress(i + 1, messages.length)
  }
  if (signal.aborted) throw cancelled()
  return new Blob([storeZip(files) as BlobPart], { type: 'application/vnd.comicbook+zip' })
}

/** A blob as a file to keep (Keeper.stream), a piece at a time. */
export function blobSource(blob: Blob): StreamSource {
  return {
    size: blob.size,
    async *read(signal) {
      const PIECE = 4 * 2 ** 20
      for (let at = 0; at < blob.size; at += PIECE) {
        if (signal.aborted) throw cancelled()
        yield new Uint8Array(await blob.slice(at, at + PIECE).arrayBuffer())
      }
    },
  }
}

// ---- one link per library, for all the app ----
const links = new Map<string, TelegramLink>()

export interface TelegramHost {
  telegram?: TelegramApp
  native?: NativeFeatures
  platform?: 'android' | 'desktop' | 'web'
  version?: string
}

/** The link of a Telegram library of this app, or null when the app has no Telegram credentials. */
export function telegramLink(host: TelegramHost, libraryId: string): TelegramLink | null {
  if (!host.telegram) return null
  let link = links.get(libraryId)
  if (!link) {
    const system = host.platform === 'android' ? 'Android' : host.platform === 'desktop' ? 'Escritorio' : 'Navegador'
    link = new TelegramLink(libraryId, host.telegram, sessionStore(host.native),
                            { model: `La Estantería (${system})`, system, version: host.version || '1.0' })
    links.set(libraryId, link)
  }
  return link
}

/** Moves the session kept under one library to another (signed in to an account that already had its library, say
 * one made on another device): the new one is left without session, the old one gets it. */
export async function moveTelegramSession(host: TelegramHost, from: string, to: string): Promise<void> {
  const sessions = sessionStore(host.native)
  const session = await sessions.get(from)
  if (session) {
    await sessions.set(to, session)
    await sessions.set(from, null)
  }
  const link = links.get(from)
  links.delete(from)
  await link?.close()
  telegramSignedIn[from] = false
  telegramSignedIn[to] = !!session
}

/** Forgets a library's link (it was removed): the session is closed in Telegram and deleted here. */
export async function dropTelegramLink(host: TelegramHost, libraryId: string): Promise<void> {
  const link = telegramLink(host, libraryId)
  links.delete(libraryId)
  await link?.logout()
}
