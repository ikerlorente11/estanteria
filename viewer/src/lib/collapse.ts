/** The sections a page lets fold away (the sources of a Suwayomi, the series followed…): folded until opened;
 * which were opened is kept in this device only (a convenience: another device shows them folded). */
import { reactive } from 'vue'

const KEY = 'estanteria.expanded'
const open = reactive<Record<string, boolean>>((() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch (_) { return {} } })())

export function isCollapsed(id: string): boolean { return !open[id] }
export function toggleCollapsed(id: string): void {
  if (open[id]) delete open[id]
  else open[id] = true
  try { localStorage.setItem(KEY, JSON.stringify(open)) } catch (_) { /* this session only */ }
}
