import { useSettingsStore } from '../../stores/settingsStore'
import { useUiText } from '../../lib/ui-text'

export function AssistantIdentitySettings() {
  const text = useUiText()
  const { settings, updateSettings } = useSettingsStore()
  const field = 'mt-1 w-full rounded-lg border border-gray-300 dark:border-white/15 bg-transparent px-3 py-2 text-sm'
  return <div className="space-y-4">
    <label className="block text-sm">{text('Assistant name')}<input className={field} maxLength={80}
      value={typeof settings.assistantName === 'string' ? settings.assistantName : ''} placeholder="TARS" onChange={event => updateSettings({ assistantName: event.target.value })} /></label>
    <label className="block text-sm">{text('General instructions')}<textarea className={`${field} min-h-28`} maxLength={16_000}
      value={typeof settings.assistantInstructions === 'string' ? settings.assistantInstructions : ''} placeholder={text('For example: The user is Ronne. Address him by name and answer in Brazilian Portuguese.')}
      onChange={event => updateSettings({ assistantInstructions: event.target.value })} /></label>
    <p className="text-xs text-gray-500">{text('These preferences apply to chat, voice and agents. Leave the name empty to display the model name.')}</p>
  </div>
}
