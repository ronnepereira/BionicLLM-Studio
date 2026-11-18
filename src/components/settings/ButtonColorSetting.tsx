import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_BUTTON_COLOR, normalizeButtonColor } from '../../lib/accent-color'
import { useUiText } from '../../lib/ui-text'

export function ButtonColorSetting() {
  const uiText = useUiText()
  const color = useSettingsStore((state) => normalizeButtonColor(state.settings.buttonColor))
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="button-color" className="t-micro text-gray-700 dark:text-gray-400">{uiText('Button color')}</label>
        <div className="flex flex-wrap items-center gap-2">
          <input id="button-color" type="color" value={color}
            onChange={(event) => updateSettings({ buttonColor: event.target.value })}
            className="h-8 w-10 cursor-pointer rounded border border-gray-300 dark:border-white/15 bg-transparent p-1"
            aria-describedby="button-color-note" />
          <code className="t-micro text-gray-700 dark:text-gray-300">{color}</code>
          <button type="button" className="lu-control lu-control--outline"
            disabled={color === DEFAULT_BUTTON_COLOR}
            onClick={() => updateSettings({ buttonColor: DEFAULT_BUTTON_COLOR })}>
            {uiText('Restore default blue')}
          </button>
        </div>
      </div>
      <p id="button-color-note" className="t-micro text-gray-500 dark:text-gray-400">{uiText('Changes button and accent colors throughout the app. Text contrast adjusts automatically.')}</p>
    </div>
  )
}
