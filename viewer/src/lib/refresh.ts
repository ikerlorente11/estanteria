import { plural, t } from './i18n.ts'
import type { Store } from './store.ts'

/** Looks again for what is new: the folders of this device and, with a server, its reading folder; then
 * the shelf is listed again. What it found is told. */
export async function lookForNew(store: Store): Promise<void> {
  try {
    if (store.shelf) await store.shelf.scan()
    if (store.state.server) {
      const r = await store.api.scan()
      const news = r.new + r.changed
      store.notify(news ? plural(news, '{n} archivo nuevo; se están abriendo.', '{n} archivos nuevos; se están abriendo.') : t('No hay nada nuevo.'))
    } else store.notify(t('Hecho: tu estantería está al día.'))
    await store.refresh()
  } catch (err: any) { store.notify(err?.message || String(err), true) }
}
