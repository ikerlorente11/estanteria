/** The app's languages. Every text is written in Spanish in the code and goes through `t()`, which gives
 * it in the language chosen (the system's, Spanish or English). The Spanish text is the key: a text
 * without a translation shows in Spanish, never as a key. Placeholders are `{name}`, filled from `params`. */
import { computed, reactive } from 'vue'
import { EN } from './i18n-en.ts'

export type Language = 'es' | 'en'
export type LanguageChoice = 'system' | Language

export const LANGUAGES: { id: LanguageChoice; label: string }[] = [
  { id: 'system', label: 'Como el sistema' }, { id: 'es', label: 'Español' }, { id: 'en', label: 'English' },
]

const state = reactive({ choice: 'system' as LanguageChoice })

function systemLanguage(): Language {
  try { return (navigator.language || 'es').toLowerCase().startsWith('es') ? 'es' : 'en' } catch (_) { return 'es' }
}

/** the language in use now */
export const language = computed<Language>(() => (state.choice === 'system' ? systemLanguage() : state.choice))

/** Chooses the language (the settings call it at start and on change). */
export function setLanguage(choice: LanguageChoice): void {
  state.choice = choice
  try { document.documentElement.lang = language.value } catch (_) { /* no page */ }
}

const DICTIONARIES: Record<Language, Record<string, string>> = { es: {}, en: EN }

/** `text` (in Spanish) in the language in use, with its `{placeholders}` filled. */
export function t(text: string, params?: Record<string, string | number>): string {
  const out = (language.value === 'es' ? text : DICTIONARIES[language.value][text]) ?? text
  return params ? out.replace(/\{(\w+)\}/g, (all, name) => (name in params ? String(params[name]) : all)) : out
}

/** One form or the other by `n` (1 or not), translated: plural(n, '{n} archivo', '{n} archivos'). */
export function plural(n: number, one: string, many: string, params?: Record<string, string | number>): string {
  return t(n === 1 ? one : many, { n, ...(params || {}) })
}

/** Dates and numbers as the language writes them. */
export function locale(): string { return language.value === 'es' ? 'es-ES' : 'en-GB' }
