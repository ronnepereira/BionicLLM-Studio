import catalog from './locales/pt-BR.json'
import type { Settings } from '../types/settings'
import { brandUiCopy, ORIGINAL_APP_CREDIT } from './ui-brand'

export type UiParameters = Record<string, unknown>
const portuguese: Record<string, string> = catalog

/** Only authored UI copy enters here. Never pass user/model content. */
export function localizeUiText(language: Settings['language'], source: string | null | undefined, parameters?: UiParameters): string {
  if (source == null) return ''
  // JSX entities are decoded before interpolation, so parameters remain exact.
  const entities: Record<string, string> = { middot: '·', darr: '↓', uarr: '↑', rarr: '→' }
  const text = (language === 'en' ? source : portuguese[source] ?? source).replace(/&(middot|darr|uarr|rarr);/g, (_, name: string) => entities[name])
  const display = source === ORIGINAL_APP_CREDIT ? text : brandUiCopy(text)
  return parameters ? display.replace(/\{(v\d+)\}/g, (token, key: string) => Object.hasOwn(parameters, key) ? String(parameters[key]) : token) : display
}
