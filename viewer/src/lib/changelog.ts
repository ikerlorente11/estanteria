/**
 * What changed in each version of the apps, for «Ajustes → Acerca de» (the newest first). Kept by hand: every
 * version that goes out (a build for the stores or an update over the air) gets its entry here, in the same
 * commit that gets it ready, and its number where the app says it (Android: app/web/src/release.ts; the
 * desktop: its tauri.conf.json).
 */
export interface Release {
  version: string
  /** yyyy-mm-dd */
  date: string
  notes: { es: string; en: string }[]
}

export type ChangelogPlatform = 'android' | 'desktop'

export const CHANGELOG: Record<ChangelogPlatform, Release[]> = {
  android: [
    {
      version: '0.4.2',
      date: '2026-11-12',
      notes: [
        { es: 'Komga, Kavita, catálogos OPDS y carpetas WebDAV se vuelven a conectar en Bibliotecas, ahora sin servidor: se navegan en Catálogos («Tus bibliotecas») y lo que abres se descarga para leerlo.',
          en: 'Komga, Kavita, OPDS catalogs and WebDAV folders can be connected again in Libraries, now without a server: browse them in Catalogs («Your libraries») and what you open is downloaded to read.' },
        { es: 'Internet Archive vuelve como catálogo preparado: cómics clásicos y libros digitalizados de dominio público.',
          en: 'The Internet Archive is back as a ready-made catalog: classic comics and scanned public-domain books.' },
        { es: '«Mantenerme al día» también en una serie de un catálogo OPDS (un Komga, un Kavita…): tu servidor descarga cada libro nuevo.',
          en: '«Keep me up to date» also on a series of an OPDS catalog (a Komga, a Kavita…): your server downloads each new book.' },
        { es: 'Los desplegables (tipo de biblioteca, orden, idioma, letra…) se abren junto a su campo; en la tableta salían arriba de la pantalla, de lado a lado.',
          en: 'Drop-downs (library type, order, language, font…) open next to their field; on the tablet they came out at the top of the screen, edge to edge.' },
      ],
    },
    {
      version: '0.4.1',
      date: '2026-11-12',
      notes: [
        { es: 'Las marcas, notas y subrayados de tus archivos del dispositivo pasan también a tus otros dispositivos que tengan el mismo archivo.',
          en: 'The bookmarks, notes and highlights of your files on this device also reach your other devices that have the same file.' },
        { es: 'Si usas más de un servidor, lo que queda pendiente de enviar sin conexión ya no se mezcla entre cuentas.',
          en: 'If you use more than one server, what is left to send while offline no longer mixes between accounts.' },
      ],
    },
    {
      version: '0.4.0',
      date: '2026-11-12',
      notes: [
        { es: 'Favoritos: marca con la estrella series, archivos y series de los catálogos, y tenlos juntos en «Favoritos»; con tu servidor, en todos tus dispositivos.',
          en: 'Favourites: star series, files and catalog series and find them together in «Favoritos»; with your server, on all your devices.' },
        { es: '«Mantenerme al día» en una serie de MangaDex o Suwayomi: tu servidor descarga cada capítulo nuevo según sale, y lo que el catálogo retire se queda en tu nube.',
          en: '«Keep me up to date» on a MangaDex or Suwayomi series: your server downloads each new chapter as it comes out, and what the catalog takes down stays in your cloud.' },
        { es: 'Con tu servidor conectado, lo que descargas de un catálogo se queda en el dispositivo y además se guarda en tu nube; lo que bajó el servidor sale marcado.',
          en: 'With your server connected, what you download from a catalog stays on the device and is also saved to your cloud; what the server fetched shows as downloaded.' },
        { es: 'Sigue donde ibas en otro dispositivo: «Ibas por la página 45 en el móvil · Ir allí»; gana siempre lo último que leíste, aunque un dispositivo estuviera sin conexión.',
          en: 'Pick up where you were on another device: «You were on page 45 on the phone · Go there»; what you read last always wins, even if a device was offline.' },
        { es: 'Tus bibliotecas Suwayomi y catálogos son los mismos en todos tus dispositivos, y el progreso de archivos sueltos y capítulos leídos en línea también viaja.',
          en: 'Your Suwayomi libraries and catalogs are the same on all your devices, and the progress of loose files and chapters read online travels too.' },
      ],
    },
    {
      version: '0.3.0',
      date: '2026-11-12',
      notes: [
        { es: 'Descargas para leer sin conexión mucho más rápidas: el cómic (CBZ, CBR, CB7, CBT) o el PDF baja entero y el móvil saca las páginas; varias a la vez.',
          en: 'Much faster downloads for reading offline: the comic (CBZ, CBR, CB7, CBT) or the PDF comes whole and the phone takes its pages out; several at once.' },
        { es: 'Cancelar corta ya lo que va: la subida al servidor o la descarga de un catálogo en curso se paran al momento.',
          en: 'Cancelling now cuts what is going: an upload to the server or a catalog download in progress stops at once.' },
      ],
    },
    {
      version: '0.2.1',
      date: '2026-11-12',
      notes: [
        { es: 'Lector: las barras solo salen o se esconden al tocar el centro de la página; en los libros, los márgenes también pasan página.',
          en: 'Reader: the bars only show or hide with a tap in the middle of the page; in books, the margins turn the page too.' },
        { es: 'Catálogos: los idiomas, en un desplegable de selección múltiple; en Extensiones eliges qué idiomas de cada extensión se ven (al instalar una con muchos, solo el tuyo y el inglés).',
          en: 'Catalogs: languages in a multi-choice drop-down; in Extensions you choose which languages of each extension show (installing one with many, only yours and English).' },
        { es: 'Subidas al servidor: varias a la vez, solo lo que falta (si ya está, te lo dice en vez de dar error), en la carpeta de su serie, y se pueden cancelar.',
          en: 'Uploads to the server: several at once, only what is missing (if it is there already, it says so instead of failing), in the folder of its series, and they can be cancelled.' },
        { es: 'Descargas: botón «Cancelar» a la vista, «Parar todo» en Descargas y cancelar las de los catálogos (una o toda la serie).',
          en: 'Downloads: a visible «Cancel» button, «Stop all» in Downloads, and cancelling catalog downloads (one or the whole series).' },
        { es: 'Al conectar un servidor, una dirección mal escrita ya no se guarda: dice que no se pudo conectar.',
          en: 'Connecting a server, a mistyped address is no longer kept: it says it could not connect.' },
        { es: 'Ajustes enseña la versión y sus novedades.', en: 'Settings shows the version and what is new in it.' },
      ],
    },
    {
      version: '0.2.0',
      date: '2026-11-11',
      notes: [
        { es: 'Primera versión para Google Play: lector local de cómics, manga y libros (CBZ, CBR, CB7, PDF, EPUB, MOBI, FB2, DjVu…), catálogos y bibliotecas (servidor propio, OPDS, Komga, Kavita, WebDAV, Suwayomi).',
          en: 'First version for Google Play: a local reader of comics, manga and books (CBZ, CBR, CB7, PDF, EPUB, MOBI, FB2, DjVu…), catalogs and libraries (own server, OPDS, Komga, Kavita, WebDAV, Suwayomi).' },
        { es: 'Pantalla de inicio clara u oscura y el sentido de lectura como ajuste para todo.', en: 'A light or dark splash screen, and the reading direction as one setting for everything.' },
      ],
    },
  ],
  desktop: [
    {
      version: '0.5.2',
      date: '2026-11-12',
      notes: [
        { es: 'Komga, Kavita, catálogos OPDS y carpetas WebDAV se vuelven a conectar en Bibliotecas, ahora sin servidor: se navegan en Catálogos («Tus bibliotecas») y lo que abres se descarga para leerlo.',
          en: 'Komga, Kavita, OPDS catalogs and WebDAV folders can be connected again in Libraries, now without a server: browse them in Catalogs («Your libraries») and what you open is downloaded to read.' },
        { es: 'Internet Archive vuelve como catálogo preparado: cómics clásicos y libros digitalizados de dominio público.',
          en: 'The Internet Archive is back as a ready-made catalog: classic comics and scanned public-domain books.' },
        { es: '«Mantenerme al día» también en una serie de un catálogo OPDS (un Komga, un Kavita…): tu servidor descarga cada libro nuevo.',
          en: '«Keep me up to date» also on a series of an OPDS catalog (a Komga, a Kavita…): your server downloads each new book.' },
        { es: 'Los desplegables (tipo de biblioteca, orden, idioma, letra…) se abren junto a su campo; en la tableta salían arriba de la pantalla, de lado a lado.',
          en: 'Drop-downs (library type, order, language, font…) open next to their field; on the tablet they came out at the top of the screen, edge to edge.' },
      ],
    },
    {
      version: '0.5.1',
      date: '2026-11-12',
      notes: [
        { es: 'Las marcas, notas y subrayados de tus archivos del PC pasan también a tus otros dispositivos que tengan el mismo archivo.',
          en: 'The bookmarks, notes and highlights of your files on this PC also reach your other devices that have the same file.' },
        { es: 'Si usas más de un servidor, lo que queda pendiente de enviar sin conexión ya no se mezcla entre cuentas.',
          en: 'If you use more than one server, what is left to send while offline no longer mixes between accounts.' },
      ],
    },
    {
      version: '0.5.0',
      date: '2026-11-12',
      notes: [
        { es: 'Favoritos: marca con la estrella series, archivos y series de los catálogos, y tenlos juntos en «Favoritos»; con tu servidor, en todos tus dispositivos.',
          en: 'Favourites: star series, files and catalog series and find them together in «Favoritos»; with your server, on all your devices.' },
        { es: '«Mantenerme al día» en una serie de MangaDex o Suwayomi: tu servidor descarga cada capítulo nuevo según sale, y lo que el catálogo retire se queda en tu nube.',
          en: '«Keep me up to date» on a MangaDex or Suwayomi series: your server downloads each new chapter as it comes out, and what the catalog takes down stays in your cloud.' },
        { es: 'Con tu servidor conectado, lo que descargas de un catálogo se queda en el PC y además se guarda en tu nube; lo que bajó el servidor sale marcado.',
          en: 'With your server connected, what you download from a catalog stays on the device and is also saved to your cloud; what the server fetched shows as downloaded.' },
        { es: 'Sigue donde ibas en otro dispositivo: «Ibas por la página 45 en el móvil · Ir allí»; gana siempre lo último que leíste, aunque un dispositivo estuviera sin conexión.',
          en: 'Pick up where you were on another device: «You were on page 45 on the phone · Go there»; what you read last always wins, even if a device was offline.' },
        { es: 'Tus bibliotecas Suwayomi y catálogos son los mismos en todos tus dispositivos, y el progreso de archivos sueltos y capítulos leídos en línea también viaja.',
          en: 'Your Suwayomi libraries and catalogs are the same on all your devices, and the progress of loose files and chapters read online travels too.' },
      ],
    },
    {
      version: '0.4.0',
      date: '2026-11-12',
      notes: [
        { es: 'Lector local por defecto: tus carpetas y archivos, formatos nuevos (DjVu, MOBI/AZW3, FB2, CBT, AVIF, JPEG XL), catálogos y bibliotecas (servidor propio, OPDS, Komga, Kavita, WebDAV, Suwayomi).',
          en: 'A local reader by default: your folders and files, new formats (DjVu, MOBI/AZW3, FB2, CBT, AVIF, JPEG XL), catalogs and libraries (own server, OPDS, Komga, Kavita, WebDAV, Suwayomi).' },
        { es: 'Descargas para leer sin conexión mucho más rápidas: el cómic o el PDF baja entero y varias a la vez; se pueden cancelar.',
          en: 'Much faster downloads for reading offline: the comic or PDF comes whole and several at once; they can be cancelled.' },
        { es: 'Carpeta de descargas a elegir en Ajustes, con los nombres de siempre (EL archivador/Comics/Korra/…); al cambiarla se mueve todo.',
          en: 'A downloads folder of your choice in Settings, with the usual names (EL archivador/Comics/Korra/…); changing it moves everything.' },
        { es: 'Lector: las barras solo salen o se esconden al hacer clic en el centro; en los libros, los márgenes también pasan página. F5 actualiza.',
          en: 'Reader: the bars only show or hide with a click in the middle; in books, the margins turn the page too. F5 refreshes.' },
        { es: 'Catálogos: idiomas en un desplegable; en Extensiones eliges qué idiomas de cada extensión se ven.',
          en: 'Catalogs: languages in a drop-down; in Extensions you choose which languages of each extension show.' },
        { es: 'Subidas al servidor: varias a la vez, solo lo que falta, en la carpeta de su serie, y se pueden cancelar.',
          en: 'Uploads to the server: several at once, only what is missing, in the folder of its series, and they can be cancelled.' },
        { es: 'Al conectar un servidor, una dirección mal escrita ya no se guarda.', en: 'Connecting a server, a mistyped address is no longer kept.' },
      ],
    },
  ],
}

/** The entries of a platform, from the version it runs (that one first) back. */
export function releasesUpTo(platform: ChangelogPlatform, version: string): Release[] {
  const all = CHANGELOG[platform] || []
  const at = all.findIndex((r) => r.version === version)
  return at < 0 ? all : all.slice(at)
}
