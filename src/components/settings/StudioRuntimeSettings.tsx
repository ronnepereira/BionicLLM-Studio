import { useSettingsStore } from '../../stores/settingsStore'
import { useModelStore } from '../../stores/modelStore'
import { useUiText } from '../../lib/ui-text'

export function ChatFontSetting() {
  const { settings, updateSettings } = useSettingsStore()
  const text = useUiText()
  return <div className="space-y-2">
    <label className="flex items-center justify-between gap-3 t-body">{text('Chat font size')}
      <span className="flex items-center gap-2"><input aria-label={text('Chat font size')} type="range" min="12" max="24" step="1" value={settings.chatFontSize ?? 13} onChange={e => updateSettings({ chatFontSize: Number(e.target.value) })} /><output>{settings.chatFontSize ?? 13}px</output></span>
    </label>
    <p className="rounded-md border border-gray-200 dark:border-white/10 p-3" style={{ fontSize: settings.chatFontSize ?? 13 }}>{text('Preview: this is how your chat messages will look.')}</p>
    <button className="lu-control" onClick={() => updateSettings({ chatFontSize: 13 })}>{text('Restore default')}</button>
  </div>
}

export function StudioRuntimeSettings() {
  const { settings, updateSettings } = useSettingsStore()
  const models = useModelStore(s => s.models)
  const text = useUiText()
  return <div className="space-y-3 t-body">
    <p className="text-gray-500">{text('Minimizing or closing to the tray keeps chat, agents and schedules running. Use Quit to stop the application.')}</p>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={settings.completionNotifications !== false} onChange={e => updateSettings({ completionNotifications: e.target.checked })} />{text('Notify when work finishes in the background')}</label>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={settings.notificationPreview === true} onChange={e => updateSettings({ notificationPreview: e.target.checked })} />{text('Show a preview in notifications')}</label>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={settings.externalAgentEnabled !== false} onChange={e => updateSettings({ externalAgentEnabled: e.target.checked })} />{text('Allow local programs to use BionicLLM as an agent')}</label>
    <label className="block space-y-1"><span>{text('Default model for external programs')}</span>
      <select className="lu-control w-full" value={settings.agentDefaultModel ?? ''} onChange={e => updateSettings({ agentDefaultModel: e.target.value })}>
        <option value="">{text('Use the selected model')}</option>
        {models.filter(m => m.type !== 'image' && m.type !== 'video').map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
      </select>
    </label>
    <label className="flex gap-2 items-center"><input type="checkbox" checked={settings.agentFixedModel === true} disabled={!settings.agentDefaultModel} onChange={e => updateSettings({ agentFixedModel: e.target.checked })} />{text('Always use the default model (ignore the client model)')}</label>
    <p className="t-micro text-gray-500">{text('Local API: http://127.0.0.1:17863 · connection instructions in docs/external-agent.md')}</p>
  </div>
}
