/** English: the Spanish text of the code → its English. Split by where the texts are, so several people can
 * add to it at once; each part is merged here. A text missing here shows in Spanish. */
import { EN_APP } from './i18n/en-app.ts'
import { EN_LIBRARY } from './i18n/en-library.ts'
import { EN_READERS } from './i18n/en-readers.ts'

export const EN: Record<string, string> = { ...EN_READERS, ...EN_LIBRARY, ...EN_APP }
