import { useCallback } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { localizeUiText, type UiParameters } from './ui-copy'
export { localizeUiText } from './ui-copy'

export function useUiText() {
  const language = useSettingsStore((state) => state.settings.language)
  return useCallback((source: string | null | undefined, parameters?: UiParameters) => localizeUiText(language, source, parameters), [language])
}
