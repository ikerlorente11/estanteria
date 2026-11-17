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
 * Addresses of the catalog: `tg:` the chats; `tg:<peer>` the documents of one (`?before=<message>` the next page,
 * `?q=<text>` a search). A file: `tg:<account>/<peer>/<message>`, which is also its key as kept (the account in
 * it, since a message number of a group is the account's own).
 */
import { reactive } from 'vue'
import { cancelled } from './catalogdownloads.ts'
import { t } from './i18n.ts'
import type { NativeFeatures } from './native.ts'
import type { StreamSource } from './net.ts'
import type { Feed, FeedEntry } from './opds.ts'
import { DEVICE_SECRET_PREFIX, onPrefsReplaced, prefs } from './prefs.ts'
import type { TelegramApp } from './store.ts'
import { formatOfName, sizeText } from './webdav.ts'

/** documents asked for each time (Telegram gives up to 100) */
export const PAGE = 100
/** a download goes in segments of this many bytes, a few at once (each a run of 1 MB requests, Telegram's most) */
export const SEGMENT = 8 * 2 ** 20
export const AT_ONCE = 3
const REQUEST = 2 ** 20

// ---- addresses (pure) ----
export const ROOT = 'tg:'

export interface ChatAddress { peer: string; before: number | null; q: string }

/** The chat an address of the catalog is about (null: the list of chats). */
export function parseAddress(address: string): ChatAddress | null {
  const m = address.match(/^tg:(-?\d+)(?:\?(.*))?$/)
  if (!m) return null
  const query = new URLSearchParams(m[2] || '')
  const before = Number(query.get('before'))
  return { peer: m[1], before: before > 0 ? before : null, q: query.get('q') || '' }
}

export function chatAddress(peer: string, opts: { before?: number | null; q?: string } = {}): string {
  const query = new URLSearchParams()
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

export interface TgPage {
  docs: TgDocument[]
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

export function documentsFeed(account: string, chat: { peer: string; title: string }, page: TgPage, at: ChatAddress): Feed {
  const entries: FeedEntry[] = []
  for (const d of page.docs) {
    const format = formatOfName(d.name)
    if (!format) continue
    const href = fileHref({ account, peer: chat.peer, message: d.message })
    const when = d.date ? new Date(d.date * 1000).toLocaleDateString() : ''
    entries.push({
      id: href, title: titleOfName(d.name), author: null, summary: d.caption || null, cover: null, language: null,
      offers: [{ href, type: d.mime || 'application/octet-stream', format }], href: null,
      detail: [sizeText(d.size), when].filter(Boolean).join(' · '),
    })
  }
  return {
    url: chatAddress(chat.peer, at),
    title: chat.title,
    subtitle: page.total !== null ? t('{n} documentos', { n: page.total }) : null,
    navigation: [],
    entries,
    next: page.next ? chatAddress(chat.peer, { before: page.next, q: at.q }) : null,
    search: `tg:${chat.peer}?q={searchTerms}`,
  }
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

// ---- the chats one does not want to see (by library; with the person's settings, so on every device) ----
const HIDDEN_KEY = 'estanteria.telegram.hidden'
function loadHidden(): Record<string, string[]> { try { return JSON.parse(prefs.get(HIDDEN_KEY) || '{}') || {} } catch (_) { return {} } }
const hidden = reactive<Record<string, string[]>>(loadHidden())
onPrefsReplaced(() => {
  for (const k of Object.keys(hidden)) delete hidden[k]
  Object.assign(hidden, loadHidden())
})

/** the chats of a library hidden from its list */
export function telegramHidden(libraryId: string): string[] { return hidden[libraryId] || [] }
export function setTelegramHidden(libraryId: string, peers: string[], hide: boolean): void {
  const now = new Set(hidden[libraryId] || [])
  for (const p of peers) hide ? now.add(p) : now.delete(p)
  hidden[libraryId] = [...now]
  prefs.set(HIDDEN_KEY, JSON.stringify(hidden))
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

  /** A chat's picture (small), as a blob URL; null when it has none. Three at a time, kept while the app runs. */
  chatPhoto(peer: string): Promise<string | null> {
    let going = this.photos.get(peer)
    if (!going) {
      going = (async () => {
        if (this.photosGoing >= 3) await new Promise<void>((r) => this.photosWaiting.push(r))
        this.photosGoing++
        try {
          const client = await this.connected()
          const chat = await this.chat(peer)
          const bytes: Uint8Array | undefined = await client.downloadProfilePhoto(chat.full, { isBig: false })
          return bytes?.length ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })) : null
        } finally {
          this.photosGoing--
          this.photosWaiting.shift()?.()
        }
      })().catch(() => null)
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

  /** A page of the documents of a chat, newest first (or those whose name or text has `q`). */
  async documents(at: ChatAddress): Promise<{ title: string; page: TgPage }> {
    const client = await this.connected()
    const { Api } = await teleproto()
    const chat = await this.chat(at.peer)
    const messages = await client.getMessages(chat.entity, {
      limit: PAGE, filter: new Api.InputMessagesFilterDocument(), offsetId: at.before || 0, search: at.q || undefined,
    })
    const docs: TgDocument[] = []
    for (const m of messages) {
      const doc = m.document
      const name = doc?.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName
      if (name) docs.push({ message: m.id, name, size: Number(doc.size), mime: doc.mimeType || '', date: m.date || 0, caption: m.message || '' })
    }
    const last = messages.length ? messages[messages.length - 1].id : null
    return { title: chat.title, page: { docs, total: typeof messages.total === 'number' ? messages.total : null, next: messages.length === PAGE ? last : null } }
  }

  /** A document to download, a piece at a time. */
  async file(peer: string, message: number): Promise<StreamSource & { name: string }> {
    const client = await this.connected()
    const chat = await this.chat(peer)
    const [m] = await client.getMessages(chat.entity, { ids: [message] })
    const doc = m?.document
    if (!doc) throw new Error(t('Ese archivo ya no está en Telegram'))
    const name = doc.attributes?.find((a: any) => a.className === 'DocumentAttributeFilename')?.fileName || `${message}`
    const size = Number(doc.size)
    const range: RangeReader = (offset, limit, signal) => client.iterDownload(m, { offset, limit, requestSize: REQUEST, signal })
    return { name, size, read: (signal) => readInOrder(range, size, signal) }
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
  const { title, page } = await link.documents(at)
  return documentsFeed(link.account!.id, { peer: at.peer, title }, page, at)
}

/** The file of an entry of the catalog (its href), to download a piece at a time. */
export async function telegramFile(link: TelegramLink, href: string): Promise<StreamSource & { name: string }> {
  const ref = parseFileHref(href)
  if (!ref) throw new Error(t('Esa dirección no es de un archivo de Telegram'))
  if (!(await link.resume())) throw new Error(t('La sesión de Telegram se cerró: vuelve a entrar'))
  if (link.account?.id !== ref.account) throw new Error(t('Ese archivo es de otra cuenta de Telegram'))
  return link.file(ref.peer, ref.message)
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

/** Forgets a library's link (it was removed): the session is closed in Telegram and deleted here. */
export async function dropTelegramLink(host: TelegramHost, libraryId: string): Promise<void> {
  const link = telegramLink(host, libraryId)
  links.delete(libraryId)
  await link?.logout()
}
