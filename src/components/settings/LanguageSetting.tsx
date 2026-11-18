import { useSettingsStore } from '../../stores/settingsStore'
import { useTranslation } from '../../lib/i18n'

export function LanguageSetting() {
  const { language, t } = useTranslation()
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  return (
    <div className="space-y-2 mb-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="app-language" className="text-sm text-gray-700 dark:text-gray-300">{t('language')}</label>
        <select
          id="app-language"
          value={language}
          onChange={(event) => updateSettings({ language: event.target.value === 'en' ? 'en' : 'pt-BR' })}
          className="rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm text-gray-900 dark:text-gray-100"
          aria-describedby="language-progress"
        >
          <option value="pt-BR">Português (Brasil)</option>
          <option value="en">English</option>
        </select>
      </div>
      <p id="language-progress" className="text-xs text-gray-500 dark:text-gray-400">{t('languageNote')}</p>
    </div>
  )
}
