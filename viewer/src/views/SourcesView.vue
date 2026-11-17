<template>
  <section class="es-page">
    <header class="es-page-head">
      <h1 class="es-h1">{{ t('Bibliotecas') }}</h1>
      <span class="es-grow"></span>
      <button v-if="!adding && !joining && canJoin" class="es-btn" @click="startJoin"><i class="es-i es-i-share" aria-hidden="true"></i> {{ t('Unirse con una invitación') }}</button>
      <button v-if="!adding && !joining && (store.libraries || state.server)" class="es-btn es-primary" @click="startAdd"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Añadir biblioteca') }}</button>
    </header>
    <p v-if="store.libraries" class="es-muted">{{ t('Tus servidores (un servidor propio, Komga, Kavita…): conéctate con su dirección y tus credenciales y lo que tienen aparece en tu estantería. Puedes tener varios a la vez.') }}</p>
    <p v-else-if="state.server" class="es-muted">{{ t('{server} lee la carpeta «{folder}» de tu nube. Añade bibliotecas de otros (un Komga, un Kavita, un catálogo OPDS, una carpeta WebDAV) y sus cómics y libros aparecen junto a los tuyos, con el progreso guardado allí cuando el servidor lo permite.', { server: serverLabel(store), folder: store.readingRoot }) }}</p>

    <!-- an app: a friend's invitation to the catalog of their server -->
    <form v-if="joining" class="es-form" @submit.prevent="join">
      <p class="es-muted es-small">{{ t('Si alguien te ha invitado a su catálogo, pega aquí el enlace de la invitación. Lo que descargues se queda en este dispositivo.') }}</p>
      <label>{{ t('Enlace de la invitación') }} <input v-model="invitation" type="url" required autocomplete="off" autocapitalize="none" placeholder="https://…/invitacion/ABCD-EFGH-JKLM" /></label>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ t('Unirse') }}</button>
        <button class="es-btn" type="button" @click="joining = false">{{ t('Cancelar') }}</button>
      </div>
    </form>

    <!-- a link just made (another device of a guest, or a new guest): to copy or share -->
    <div v-if="link" class="es-form es-guest-link">
      <p>{{ link.text }}</p>
      <input :value="link.url" readonly @focus="($event.target as HTMLInputElement).select()" />
      <p class="es-muted es-small">{{ link.note }}</p>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="button" @click="copyLink"><i class="es-i es-i-share" aria-hidden="true"></i> {{ canShare ? t('Compartir') : t('Copiar') }}</button>
        <button class="es-btn" type="button" @click="link = null">{{ t('Hecho') }}</button>
      </div>
    </div>

    <!-- an app: a library it connects by itself -->
    <form v-if="adding && store.libraries" class="es-form" @submit.prevent="saveLibrary">
      <label>{{ t('Tipo') }}
        <Pick v-model="lib.type" field :disabled="!!lib.id" :options="libraryTypes.map((ty) => ({ value: ty, label: t(LIBRARY_TYPES[ty].label) }))" />
      </label>
      <template v-if="lib.type !== 'telegram'">
        <p class="es-muted es-small">{{ t(libInfo.hint) }}</p>
        <label>{{ t('Nombre') }} <input v-model="lib.name" type="text" maxlength="120" :placeholder="lib.url ? nameFromUrl(lib.url) : t('Cómo quieres llamarla')" /></label>
        <label>{{ t('Dirección') }} <input v-model="lib.url" type="url" required :placeholder="t(libInfo.example)" /></label>
        <label v-if="libInfo.username">{{ t('Usuario') }} <input v-model="lib.username" type="text" autocomplete="off" autocapitalize="none" /></label>
        <label>{{ t(libInfo.secretLabel) }} <input v-model="lib.secret" type="password" autocomplete="new-password" :placeholder="lib.id ? t('(sin cambios)') : ''" /></label>
        <div class="es-form-actions">
          <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ lib.id ? t('Guardar') : t('Conectar y añadir') }}</button>
          <button class="es-btn" type="button" @click="adding = false">Cancelar</button>
        </div>
      </template>
    </form>
    <!-- Telegram: one signs in with Telegram itself (a form of its own, outside the one above) -->
    <TelegramLogin v-if="adding && store.libraries && lib.type === 'telegram' && telegramNow" :key="telegramNow.id" :link="telegramNow"
                   :again="lib.id ? lib.name : ''" @done="telegramDone" @cancel="adding = false" />

    <!-- the web of a server: a library the server connects -->
    <form v-if="adding && !store.libraries && state.server" class="es-form" @submit.prevent="save">
      <label>{{ t('Tipo') }}
        <Pick v-model="form.kind" field :options="kinds.map((k) => ({ value: k.kind, label: k.label }))" />
      </label>
      <p v-if="hint" class="es-muted es-small">{{ hint }}</p>
      <label>{{ t('Nombre') }} <input v-model="form.name" type="text" required maxlength="120" :placeholder="t('Komga de Ana')" /></label>
      <label>{{ t('Dirección') }} <input v-model="form.url" type="url" required :placeholder="t('https://komga.ejemplo.com')" /></label>
      <label v-if="kindInfo?.fields.includes('username')">{{ t('Usuario') }} <input v-model="form.username" type="text" autocomplete="off" /></label>
      <label v-if="kindInfo?.fields.includes('secret')">{{ kindInfo?.secret_label || t('Contraseña') }} <input v-model="form.secret" type="password" autocomplete="new-password" :placeholder="editing ? t('(sin cambios)') : ''" /></label>
      <div class="es-form-actions">
        <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ editing ? t('Guardar') : t('Conectar y añadir') }}</button>
        <button class="es-btn" type="button" @click="adding = false">Cancelar</button>
      </div>
    </form>

    <!-- an app: the libraries it is connected to -->
    <ul v-if="store.libraries" class="es-sources">
      <li v-for="l in store.libraries.list.value" :key="l.id" class="es-source">
        <span class="es-source-icon"><i class="es-i" :class="l.type === 'server' ? 'es-i-cloud' : 'es-i-server'" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ l.name }} <small class="es-muted">{{ isGuestLibrary(l) ? t('Invitación') : t(LIBRARY_TYPES[l.type].label) }}</small></strong>
          <small v-if="l.type === 'telegram'" class="es-muted es-ellipsis">{{ l.username || t('Tu cuenta de Telegram') }}</small>
          <small v-else class="es-muted es-ellipsis">{{ isGuestLibrary(l) ? guestServer(l) : l.url }}<template v-if="l.username"> · {{ l.username }}</template></small>
          <small v-if="l.error" class="es-source-bad">{{ l.error }}</small>
          <small v-else-if="l.type === 'telegram' && !store.telegram" class="es-muted">{{ t('Esta versión de la app no puede conectar con Telegram.') }}</small>
          <small v-else-if="l.type === 'telegram' && telegramSignedIn[l.id] === false" class="es-muted">{{ t('Sin sesión en este dispositivo: entra para ver tus canales.') }}</small>
          <small v-else-if="l.type === 'server' && state.server && state.status" class="es-muted">{{ plural(state.status.archivador.total, '{n} elemento', '{n} elementos') }}<template v-if="state.status.archivador.pending"> · {{ t('{n} abriéndose', { n: state.status.archivador.pending }) }}</template></small>
        </span>
        <span class="es-source-actions">
          <a v-if="l.type === 'server' && state.server" href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: 'archivador' })">{{ t('Ver') }}</a>
          <button v-if="l.type === 'telegram' && store.telegram && telegramSignedIn[l.id] === false" class="es-btn es-small es-primary" @click="startTelegramLogin(l)">{{ t('Entrar') }}</button>
          <a v-else-if="CATALOG_LIBRARY_TYPES.includes(l.type)" href="#" class="es-btn es-small" @click.prevent="go({ v: 'catalog', kind: `lib:${l.id}` })">{{ t('Ver') }}</a>
          <a v-if="l.type === 'suwayomi'" href="#" class="es-btn es-small" @click.prevent="go({ v: 'extensions', library: l.id })">{{ t('Extensiones') }}</a>
          <button v-if="isGuestLibrary(l)" class="es-btn es-small" :disabled="saving" :title="t('Usar esta invitación también en otro dispositivo tuyo')" @click="pair(l)"><i class="es-i es-i-computer" aria-hidden="true"></i> {{ t('Otro dispositivo') }}</button>
          <template v-if="!l.fixed">
            <button v-if="!isGuestLibrary(l) && l.type !== 'telegram'" class="es-btn es-small" :title="t('Cambiar')" @click="startEditLibrary(l)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
            <button class="es-btn es-small" :title="t('Quitar')" :disabled="saving" @click="removeLibrary(l)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
          </template>
        </span>
      </li>
      <li v-if="!store.libraries.list.value.length" class="es-source es-muted">{{ t('Ninguna todavía: añade una con «Añadir biblioteca».') }}</li>
    </ul>

    <!-- the outside libraries a server connects by itself (the web; in an app, when it has a server) -->
    <header v-if="store.libraries && state.server && sources.length" class="es-page-head es-subhead">
      <h2 class="es-h2">{{ t('Las de {server}', { server: serverLabel(store) }) }}</h2>
    </header>
    <ul v-if="state.server && (!store.libraries || sources.length)" class="es-sources">
      <li v-if="!store.libraries" class="es-source">
        <span class="es-source-icon"><i class="es-i es-i-cloud" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ serverLabel(store) }}</strong>
          <small class="es-muted">
            <template v-if="state.status">{{ plural(state.status.archivador.total, '{n} elemento', '{n} elementos') }}<template v-if="state.status.archivador.pending"> · {{ t('{n} abriéndose', { n: state.status.archivador.pending }) }}</template><template v-if="state.status.archivador.errors"> · {{ t('{n} con error', { n: state.status.archivador.errors }) }}</template></template>
            <template v-else>{{ t('Conectando…') }}</template>
          </small>
        </span>
        <span class="es-source-actions"><a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: 'archivador' })">{{ t('Ver') }}</a></span>
      </li>
      <li v-for="s in sources" :key="s.id" class="es-source" :class="{ 'es-source-off': !s.enabled }">
        <span class="es-source-icon"><i class="es-i es-i-server" aria-hidden="true"></i></span>
        <span class="es-source-text">
          <strong>{{ s.name }} <small class="es-muted">{{ s.label }}</small></strong>
          <small class="es-muted es-ellipsis">{{ s.url }}</small>
          <small :class="s.scan_error ? 'es-source-bad' : 'es-muted'">
            <template v-if="s.scan_error">{{ s.scan_error }}</template>
            <template v-else-if="!s.enabled">{{ t('Desactivada') }}</template>
            <template v-else-if="s.scanned">{{ plural(s.items, '{n} elemento · revisada {ago}', '{n} elementos · revisada {ago}', { ago: ago(s.scanned) }) }}<template v-if="s.supports_progress"> · {{ t('progreso sincronizado') }}</template></template>
            <template v-else>{{ t('Revisando por primera vez…') }}</template>
          </small>
        </span>
        <span class="es-source-actions">
          <a href="#" class="es-btn es-small" @click.prevent="go({ v: 'library', source: String(s.id) })">{{ t('Ver') }}</a>
          <button class="es-btn es-small" :disabled="busy === s.id" :title="t('Mirar ya qué hay nuevo')" @click="scan(s)"><span v-if="busy === s.id" class="es-spin"></span><i v-else class="es-i es-i-refresh" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="t('Cambiar')" @click="startEdit(s)"><i class="es-i es-i-edit" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="s.enabled ? t('Desactivar') : t('Activar')" @click="toggle(s)"><i class="es-i" :class="s.enabled ? 'es-i-pause' : 'es-i-play'" aria-hidden="true"></i></button>
          <button class="es-btn es-small" :title="t('Quitar')" @click="remove(s)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
        </span>
      </li>
    </ul>

    <!-- who administers the server: friends invited to its catalog -->
    <template v-if="guestsInfo?.admin && guestsInfo.enabled">
      <header class="es-page-head es-subhead">
        <h2 class="es-h2">{{ t('Invitados') }}</h2>
        <span class="es-grow"></span>
        <button v-if="!inviting" class="es-btn es-small" @click="inviting = true"><i class="es-i es-i-add" aria-hidden="true"></i> {{ t('Invitar') }}</button>
      </header>
      <p class="es-muted">{{ t('Tus amigos leen el catálogo de tu Suwayomi desde su app: cada uno instala sus propias extensiones (no ven las tuyas) y lo que descargan se queda en su dispositivo, nunca en tu servidor.') }}</p>
      <form v-if="inviting" class="es-form" @submit.prevent="invite">
        <label>{{ t('¿A quién invitas?') }} <input v-model="guestName" type="text" required maxlength="80" :placeholder="t('Su nombre, para reconocerlo')" /></label>
        <div class="es-form-actions">
          <button class="es-btn es-primary" type="submit" :disabled="saving"><span v-if="saving" class="es-spin"></span> {{ t('Crear invitación') }}</button>
          <button class="es-btn" type="button" @click="inviting = false">{{ t('Cancelar') }}</button>
        </div>
      </form>
      <ul class="es-sources">
        <li v-for="g in guestsInfo.guests" :key="g.id" class="es-source">
          <span class="es-source-icon"><i class="es-i es-i-server" aria-hidden="true"></i></span>
          <span class="es-source-text">
            <strong>{{ g.name }}</strong>
            <small class="es-muted">{{ plural(g.devices, '{n} dispositivo', '{n} dispositivos') }} · {{ plural(g.extensions, '{n} extensión', '{n} extensiones') }}<template v-if="g.bytes"> · {{ size(g.bytes) }}</template></small>
            <small class="es-muted">{{ g.last_seen ? t('Último uso {ago}', { ago: ago(g.last_seen) }) : t('Aún no lo ha usado') }}</small>
          </span>
          <span class="es-source-actions">
            <button class="es-btn es-small" :disabled="saving" :title="t('Un enlace para otro dispositivo suyo (con sus extensiones)')" @click="inviteDevice(g.id, g.name)"><i class="es-i es-i-computer" aria-hidden="true"></i></button>
            <button class="es-btn es-small" :disabled="saving" :title="t('Quitarle el acceso')" @click="dropGuest(g.id, g.name)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
          </span>
        </li>
        <li v-for="i in guestsInfo.invites" :key="`i${i.id}`" class="es-source es-source-off">
          <span class="es-source-icon"><i class="es-i es-i-share" aria-hidden="true"></i></span>
          <span class="es-source-text">
            <strong>{{ i.name }} <small class="es-muted">{{ i.guest_id ? t('otro dispositivo') : t('invitación sin usar') }}</small></strong>
            <small class="es-muted">{{ t('Caduca {when}', { when: until(i.expires) }) }}</small>
          </span>
          <span class="es-source-actions">
            <button class="es-btn es-small" :disabled="saving" :title="t('Anular la invitación')" @click="dropInvite(i.id)"><i class="es-i es-i-delete" aria-hidden="true"></i></button>
          </span>
        </li>
        <li v-if="!guestsInfo.guests.length && !guestsInfo.invites.length" class="es-source es-muted">{{ t('Nadie todavía: crea una invitación con «Invitar».') }}</li>
      </ul>
    </template>

  </section>
</template>

<script setup lang="ts">
import Pick from './Pick.vue'
import { useSync } from '../lib/favorites'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { Source, SourceKind, SourceKindInfo } from '../lib/api'
import { plural, t } from '../lib/i18n'
import { LIBRARY_TYPES, nameFromUrl, type Library, type LibraryType } from '../lib/libraries'
import { deviceName, serverLabel, useStore } from '../lib/store'
import { CATALOG_LIBRARY_TYPES, suwayomiServer } from '../lib/devicelibraries'
import { guestServer, isGuestLibrary, joinWithInvitation, leaveGuest, pairDevice, parseInvitation, type GuestsStatus } from '../lib/guests'
import { browserNet } from '../lib/net'
import { checkTelegramSession, dropTelegramLink, moveTelegramSession, telegramLink, telegramSignedIn, type TelegramAccount } from '../lib/telegram'
import TelegramLogin from './TelegramLogin.vue'

/** The libraries: in an app, the servers it connects by itself (a server of its own, Komga, Kavita…); on
 * the web of a server, the outside libraries that server connects (add one, see how each is doing, scan,
 * edit, pause or remove it). This device's own folders are in «Estantería». */
/** `add`: open with the form to add a library (the «+» menu) */
const props = defineProps<{ add?: boolean }>()
const store = useStore()
// what is shared with the other devices, kept in step from the first page (see sync.ts)
useSync(store)
const { state, go } = store
const kinds = ref<SourceKindInfo[]>([])
const sources = ref<Source[]>([])
const adding = ref(false)
const editing = ref<Source | null>(null)
const saving = ref(false)
const busy = ref<number | null>(null)

const form = reactive({ kind: 'komga' as SourceKind, name: '', url: '', username: '', secret: '' })

const kindInfo = computed(() => kinds.value.find((k) => k.kind === form.kind))
const HINTS: Record<string, string> = {
  komga: 'Un servidor Komga: entra con tu usuario y contraseña de Komga (o deja el usuario vacío y pon una clave de API). El progreso de lectura se guarda en Komga.',
  kavita: 'Un servidor Kavita: hace falta tu clave de API (en Kavita: tu usuario › Ajustes › API). El progreso de lectura se guarda en Kavita.',
  opds: 'Cualquier catálogo OPDS (Calibre-Web, Ubooquity, el servidor de Calibre…): la dirección del catálogo y, si lo pide, usuario y contraseña. El progreso se guarda aquí.',
  opds2: 'Un catálogo OPDS 2.0 (JSON), como el de Komga en /opds/v2/catalog: los cómics con manifiesto se leen página a página. El progreso se guarda aquí.',
  audiobookshelf: 'Un servidor Audiobookshelf: sus libros electrónicos (epub, pdf, cbz…; los audiolibros no). Tu usuario y contraseña, o el usuario vacío y una clave de API. El progreso se guarda también en Audiobookshelf.',
  suwayomi: 'Un servidor Suwayomi (el de Tachiyomi/Mihon): los manga de su biblioteca, un elemento por capítulo. Usuario y contraseña solo si los tiene activados. Lo leído se guarda también en Suwayomi.',
  webdav: 'Una carpeta WebDAV (otro Nextcloud u OpenCloud, un NAS): la dirección de la carpeta con los archivos. El progreso se guarda aquí.'
}
const hint = computed(() => (HINTS[form.kind] ? t(HINTS[form.kind]) : ''))

function ago(epoch: number): string {
  const min = Math.round((Date.now() / 1000 - epoch) / 60)
  if (min < 2) return t('ahora mismo')
  if (min < 60) return t('hace {n} min', { n: min })
  const h = Math.round(min / 60)
  if (h < 48) return t('hace {n} h', { n: h })
  return t('hace {n} días', { n: Math.round(h / 24) })
}

// ---- an app's own libraries ----
const lib = reactive({ id: '' as string, type: 'server' as LibraryType, name: '', url: '', username: '', secret: '' })
const libInfo = computed(() => LIBRARY_TYPES[lib.type])
/** the kinds offered: Telegram only when this app has its credentials (see Store.telegram) */
const libraryTypes = computed(() => (store.libraries?.types || []).filter((ty) => ty !== 'telegram' || !!store.telegram))

// ---- Telegram: signing in makes the library (its session stays on this device) ----
/** the id a new Telegram library gets (its session is kept under it while signing in) */
const newTelegramId = ref(`telegram-${Date.now().toString(36)}`)
const telegramNow = computed(() => telegramLink(store, lib.id || newTelegramId.value))
function startTelegramLogin(l: Library) {
  joining.value = false
  link.value = null
  Object.assign(lib, { id: l.id, type: 'telegram', name: l.name, url: l.url, username: l.username, secret: '' })
  adding.value = true
}
async function telegramDone(account: TelegramAccount) {
  try {
    let id = lib.id || newTelegramId.value
    // that account has its library already (made on another device, say): that one, with this session
    const url = `tg:${account.id}`
    const same = store.libraries!.list.value.find((l) => l.type === 'telegram' && l.url === url && l.id !== id)
    if (same) {
      await moveTelegramSession(store, id, same.id)
      id = same.id
    }
    const saved = await store.libraries!.save({ id, type: 'telegram', name: account.name, url, username: account.username ? `@${account.username}` : '' })
    newTelegramId.value = `telegram-${Date.now().toString(36)}`
    adding.value = false
    store.notify(t('«{name}» conectada: tus canales están en Catálogos.', { name: saved.name }))
    go({ v: 'catalog', kind: `lib:${saved.id}` })
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function checkTelegramSessions() {
  for (const l of store.libraries?.list.value || []) if (l.type === 'telegram') void checkTelegramSession(store, l.id)
}
function startEditLibrary(l: Library) {
  Object.assign(lib, { id: l.id, type: l.type, name: l.name, url: l.url, username: l.username, secret: '' })
  adding.value = true
}
async function saveLibrary() {
  saving.value = true
  try {
    const name = lib.name.trim() || nameFromUrl(lib.url.trim())
    const saved = await store.libraries!.save({ id: lib.id || undefined, type: lib.type, name, url: ['opds', 'webdav'].includes(lib.type) ? lib.url.trim() : lib.url.trim().replace(/\/+$/, ''), username: lib.username.trim(), secret: lib.secret || undefined })
    store.notify(lib.id ? t('«{name}» guardada.', { name: saved.name }) : t('«{name}» conectada.', { name: saved.name }))
    adding.value = false
    lib.secret = ''
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function removeLibrary(l: Library) {
  const guest = isGuestLibrary(l)
  const question = guest
    ? t('¿Salir de «{name}»? Este dispositivo deja de tener acceso a ese catálogo (lo descargado se queda aquí). Para volver hará falta otra invitación.', { name: l.name })
    : l.type === 'telegram'
      ? t('¿Quitar «{name}»? Se cierra la sesión de Telegram de este dispositivo y deja de salir en tus otros dispositivos (lo descargado se queda donde esté).', { name: l.name })
      : t('¿Quitar «{name}»? Se olvida su contraseña y sus elementos dejan de estar en tu estantería (lo descargado y lo leído se quedan en este dispositivo).', { name: l.name })
  if (!window.confirm(question)) return
  saving.value = true
  try {
    const server = guest ? suwayomiServer(l.id) : null
    if (server) await leaveGuest(net, l, server.auth)
    if (l.type === 'telegram') await dropTelegramLink(store, l.id)
    await store.libraries!.remove(l.id)
    store.notify(t('«{name}» quitada.', { name: l.name }))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}

// ---- invitations: joining a friend's catalog, another device of one's own, and (who administers the server) guests ----
const net = store.net || browserNet
const joining = ref(false)
const invitation = ref('')
const canJoin = computed(() => !!store.libraries?.types.includes('suwayomi'))
const link = ref<{ url: string; text: string; note: string } | null>(null)
const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'
const guestsInfo = ref<GuestsStatus | null>(null)
const inviting = ref(false)
const guestName = ref('')

function startJoin() {
  adding.value = false
  link.value = null
  invitation.value = ''
  joining.value = true
}
async function join() {
  const found = parseInvitation(invitation.value)
  if (!found) { store.notify(t('Eso no parece el enlace de una invitación (…/invitacion/ABCD-EFGH-JKLM).'), true); return }
  saving.value = true
  try {
    const got = await joinWithInvitation(net, found, deviceName(store))
    const host = (() => { try { return new URL(found.server).hostname } catch (_) { return found.server } })()
    const saved = await store.libraries!.save({ type: 'suwayomi', name: t('Catálogo de {host}', { host }), url: got.url, username: got.name, secret: got.key })
    store.notify(t('Ya estás dentro de «{name}». Instala las extensiones que quieras y sus fuentes saldrán en Catálogos.', { name: saved.name }))
    joining.value = false
    go({ v: 'extensions', library: saved.id })
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function pair(l: Library) {
  const server = suwayomiServer(l.id)
  if (!server) return
  saving.value = true
  try {
    const got = await pairDevice(net, l, server.auth)
    showLink(got.link, t('Abre La Estantería en tu otro dispositivo, ve a Bibliotecas › Unirse con una invitación y pega este enlace:'),
             t('Sirve una sola vez, durante 15 minutos. Tendrás las mismas extensiones.'))
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
function showLink(url: string, text: string, note: string) {
  link.value = { url, text, note }
  joining.value = false
  inviting.value = false
}
async function copyLink() {
  if (!link.value) return
  try {
    if (canShare) await navigator.share({ title: t('Invitación a La Estantería'), text: link.value.url })
    else { await navigator.clipboard.writeText(link.value.url); store.notify(t('Enlace copiado.')) }
  } catch (err: any) {
    if (err?.name !== 'AbortError') store.notify(t('No se pudo copiar: selecciónalo y cópialo a mano.'), true)
  }
}

async function loadGuests() {
  if (!state.connected || !state.server) { guestsInfo.value = null; return }
  try { guestsInfo.value = await store.api.guests() } catch (_) { guestsInfo.value = null }   // an older server: no guests
}
async function invite() {
  saving.value = true
  try {
    const got = await store.api.inviteGuest(guestName.value.trim())
    showLink(got.link, t('Envía este enlace a {name}:', { name: got.name }),
             t('Sirve una sola vez y caduca en 7 días. Con él instala La Estantería y va a Bibliotecas › Unirse con una invitación.'))
    guestName.value = ''
    await loadGuests()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function inviteDevice(id: number, name: string) {
  saving.value = true
  try {
    const got = await store.api.inviteGuestDevice(id)
    showLink(got.link, t('Un enlace para otro dispositivo de {name}:', { name }), t('Sirve una sola vez y caduca en 7 días. Tendrá sus mismas extensiones.'))
    await loadGuests()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function dropGuest(id: number, name: string) {
  if (!window.confirm(t('¿Quitarle el acceso a {name}? Todos sus dispositivos dejan de poder entrar al momento (lo que haya descargado se queda en ellos).', { name }))) return
  saving.value = true
  try { await store.api.dropGuest(id); store.notify(t('{name} ya no tiene acceso.', { name })); await loadGuests() } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function dropInvite(id: number) {
  saving.value = true
  try { await store.api.dropGuestInvite(id); await loadGuests() } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
function size(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} kB`
  if (bytes < 1e9) return `${Math.round(bytes / 1e6)} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}
function until(epoch: number): string {
  const min = Math.round((epoch - Date.now() / 1000) / 60)
  if (min < 60) return t('en {n} min', { n: Math.max(1, min) })
  const h = Math.round(min / 60)
  if (h < 48) return t('en {n} h', { n: h })
  return t('en {n} días', { n: Math.round(h / 24) })
}

async function load() {
  loadGuests()
  if (!state.connected || !state.server) return
  try {
    if (!kinds.value.length) kinds.value = await store.api.sourceKinds()
    sources.value = await store.api.sources()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
function startAdd() {
  joining.value = false
  link.value = null
  if (store.libraries) {
    Object.assign(lib, { id: '', type: store.libraries.types[0], name: '', url: '', username: '', secret: '' })
    adding.value = true
    return
  }
  editing.value = null
  Object.assign(form, { kind: 'komga', name: '', url: '', username: '', secret: '' })
  adding.value = true
}
function startEdit(s: Source) {
  editing.value = s
  Object.assign(form, { kind: s.kind, name: s.name, url: s.url, username: s.username, secret: '' })
  adding.value = true
}
async function save() {
  saving.value = true
  try {
    if (editing.value) {
      await store.api.changeSource(editing.value.id, { name: form.name.trim(), url: form.url.trim(), username: form.username.trim(), secret: form.secret || undefined })
      store.notify(t('Biblioteca guardada.'))
    } else {
      await store.api.addSource({ kind: form.kind, name: form.name.trim(), url: form.url.trim(), username: form.username.trim(), secret: form.secret })
      store.notify(t('Biblioteca añadida; se está revisando.'))
    }
    adding.value = false
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  saving.value = false
}
async function scan(s: Source) {
  busy.value = s.id
  try {
    const r = await store.api.scanSource(s.id)
    store.notify(t('{name}: {files} elementos, {new} nuevos.', { name: s.name, files: r.files, new: r.new }))
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
  busy.value = null
}
async function toggle(s: Source) {
  try { await store.api.changeSource(s.id, { enabled: !s.enabled }); await load() } catch (err: any) { store.notify(err?.message || String(err), true) }
}
async function remove(s: Source) {
  if (!window.confirm(t('¿Quitar «{name}»? Sus elementos desaparecen de la biblioteca (el progreso guardado en ese servidor se queda allí).', { name: s.name }))) return
  try {
    await store.api.deleteSource(s.id)
    store.notify(t('Biblioteca quitada.'))
    await load()
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
onMounted(() => { load(); checkTelegramSessions(); if (props.add) startAdd() })
watch(() => store.libraries?.list.value.filter((l) => l.type === 'telegram').map((l) => l.id).join(','), checkTelegramSessions)
watch(() => props.add, (now) => { if (now) startAdd() })
watch(() => state.connected, load)
watch(() => state.status?.sources?.map((s) => `${s.id}:${s.scanned}:${s.items}`).join(','), load)
</script>
