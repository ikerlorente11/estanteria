/** The libraries an app connects to by itself (the desktop, Android): which kinds there are, what each
 * asks for, and what the app does with them. The app keeps them (and their passwords, in its own
 * secure store); the pages only list, add, change and remove them. The web of a server has none: its
 * outside libraries are the server's own (see SourcesView). */
import type { Ref } from 'vue'

/** `server`: a server with the full reading API (its library, progress, notes and highlights kept for
 * every device); the others are the usual library servers. */
export type LibraryType = 'server' | 'suwayomi' | 'opds' | 'komga' | 'kavita' | 'webdav'

export interface LibraryTypeInfo {
  label: string
  hint: string
  /** placeholder of the address */
  example: string
  username: boolean
  secretLabel: string
}

export const LIBRARY_TYPES: Record<LibraryType, LibraryTypeInfo> = {
  server: {
    label: 'Servidor propio',
    hint: 'Un servidor con la API de lectura completa: su biblioteca y el progreso, las notas y los subrayados sincronizados entre tus dispositivos. Tu usuario y una contraseña de aplicación.',
    example: 'https://lectura.ejemplo.com', username: true, secretLabel: 'Contraseña de aplicación',
  },
  suwayomi: {
    label: 'Suwayomi',
    hint: 'Un servidor Suwayomi: ejecuta las extensiones de Mihon/Tachiyomi y sus fuentes salen en Catálogos. Su dirección y, si tiene acceso con contraseña, tu usuario y contraseña.',
    example: 'https://suwayomi.ejemplo.com', username: true, secretLabel: 'Contraseña',
  },
  opds: {
    label: 'Catálogo OPDS',
    hint: 'Cualquier catálogo OPDS 1.2 o 2.0 (Calibre-Web, COPS, el servidor de Calibre, Kavita, Komga…): la dirección del catálogo y, si lo pide, usuario y contraseña. Se navega en Catálogos; el progreso se guarda en este dispositivo.',
    example: 'https://libros.ejemplo.com/opds', username: true, secretLabel: 'Contraseña',
  },
  komga: {
    label: 'Komga',
    hint: 'Un servidor Komga: tu usuario y contraseña (o el usuario vacío y una clave de API). Se navega en Catálogos (por su OPDS) y lo que abras se descarga a este dispositivo; el progreso se guarda aquí.',
    example: 'https://komga.ejemplo.com', username: true, secretLabel: 'Contraseña o clave de API',
  },
  kavita: {
    label: 'Kavita',
    hint: 'Un servidor Kavita: tu clave de API (en Kavita: tu usuario › Ajustes › API). Se navega en Catálogos (por su OPDS) y lo que abras se descarga a este dispositivo; el progreso se guarda aquí.',
    example: 'https://kavita.ejemplo.com', username: false, secretLabel: 'Clave de API',
  },
  webdav: {
    label: 'Carpeta WebDAV',
    hint: 'Una carpeta compartida por WebDAV (Nextcloud, OpenCloud, un NAS…): sus cómics y libros, con sus subcarpetas, se navegan en Catálogos. El progreso se guarda en este dispositivo.',
    example: 'https://nube.ejemplo.com/remote.php/dav/files/usuario/Lectura', username: true, secretLabel: 'Contraseña',
  },
}

/** A library the app is connected to (never its password). */
export interface Library {
  id: string
  type: LibraryType
  name: string
  url: string
  username: string
  hasSecret: boolean
  /** why it does not work now, if it does not */
  error?: string
  /** it comes with the app and stays (the web of a server: the server itself): it cannot be changed or removed here */
  fixed?: boolean
}

export interface LibraryInput {
  id?: string
  type: LibraryType
  name: string
  url: string
  username: string
  /** empty: keep the one saved */
  secret?: string
}

/** What the app does with its libraries. */
export interface LibrariesBackend {
  /** the kinds this app can connect now */
  types: LibraryType[]
  list: Ref<Library[]>
  /** adds or changes one and connects it; rejects with the reason when it cannot connect */
  save(input: LibraryInput): Promise<Library>
  /** disconnects it and forgets its password (what was read is kept on this device) */
  remove(id: string): Promise<void>
}

/** A name for a library from its address, when none is given. */
export function nameFromUrl(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch (_) { return url }
}
