import { useSettingsStore } from '../../stores/settingsStore'
import { INTERFACE_SCALES, normalizeInterfaceScale } from '../../lib/interface-scale'
import { useUiText } from '../../lib/ui-text'

export function InterfaceScaleSetting() {
  const uiText = useUiText()
  const scale = useSettingsStore((state) => normalizeInterfaceScale(state.settings.interfaceScale))
  const updateSettings = useSettingsStore((state) => state.updateSettings)
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label htmlFor="interface-scale" className="t-micro text-gray-700 dark:text-gray-400">{uiText('Interface scale (zoom)')}</label>
        <select id="interface-scale" value={scale}
          onChange={(event) => updateSettings({ interfaceScale: normalizeInterfaceScale(Number(event.target.value)) })}
          aria-describedby="interface-scale-note"
          className="rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 t-micro text-gray-900 dark:text-gray-100">
          {INTERFACE_SCALES.map(value => <option key={value} value={value}>{value}%</option>)}
        </select>
      </div>
      <p id="interface-scale-note" className="t-micro text-gray-500 dark:text-gray-400">{uiText('Adjusts text, buttons and panels together. Default: 115%. Changes apply immediately.')}</p>
    </div>
  )
}
