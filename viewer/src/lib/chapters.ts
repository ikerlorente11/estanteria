/** A chapter read page by page, whatever catalog it comes from: its pages as image URLs. */
import type { CatalogDef } from './catalogs.ts'
import { suwayomiServer } from './devicelibraries.ts'
import { t } from './i18n.ts'
import { mangadexPages } from './mangadex.ts'
import type { NetBackend } from './net.ts'
import { suwayomiPages } from './suwayomi.ts'

export async function chapterPages(net: NetBackend, def: CatalogDef, chapter: string): Promise<string[]> {
  if (def.protocol === 'mangadex') return mangadexPages(net, chapter)
  if (def.protocol === 'suwayomi') {
    const server = def.library ? suwayomiServer(def.library) : null
    if (!server) throw new Error(t('Ese servidor Suwayomi ya no está entre tus bibliotecas.'))
    return suwayomiPages(net, server, chapter)
  }
  throw new Error(t('Este catálogo no ofrece capítulos para leer en línea.'))
}
