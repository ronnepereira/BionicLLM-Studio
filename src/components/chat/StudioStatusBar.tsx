import { useEffect, useState } from 'react'
import { Cpu, MemoryStick, Monitor, Zap } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { useSettingsStore } from '../../stores/settingsStore'
import { useChatStore } from '../../stores/chatStore'
import { backendCall, isTauri } from '../../api/backend'
import { ContextDropdown } from './ContextDropdown'
import { TokenCounter } from './TokenCounter'
import { RadioControls } from '../radio/RadioControls'

interface Resources {
  cpuPercent: number | null
  ramUsedBytes: number
  ramTotalBytes: number
  measuredAt: number
  gpus: { index: number; name: string; percent: number | null; usedBytes: number | null; totalBytes: number | null }[]
}
export function StudioStatusBar() {
  const text = useUiText()
  const language = useSettingsStore(state => state.settings.language)
  const code = useChatStore(state => state.conversations.find(conversation => conversation.id === state.activeConversationId)?.mode === 'codex')
  const [resources, setResources] = useState<Resources | null>(null)
  useEffect(() => {
    if (!isTauri()) return
    let alive = true, pending = false
    const refresh = async () => {
      if (!alive || pending || document.visibilityState === 'hidden') return
      pending = true
      try { const value = await backendCall<Resources>('resource_usage'); if (alive) setResources(value) }
      catch { if (alive) setResources(null) }
      finally { pending = false }
    }
    const visible = () => { void refresh() }
    void refresh()
    const timer = setInterval(visible, 5_000)
    document.addEventListener('visibilitychange', visible)
    return () => { alive = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [])
  const number = (value: number) => value.toLocaleString(language === 'en' ? 'en-US' : 'pt-BR', { maximumFractionDigits: 1 })
  const percent = (value: number | null | undefined) => typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)}%` : '—'
  const memory = (used: number | null | undefined, total: number | null | undefined) => typeof used === 'number' && typeof total === 'number' && total > 0 ? `${number(used / 1073741824)}/${number(total / 1073741824)} GiB` : '—'
  return <div aria-label={text('Studio status bar')} className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-gray-200 dark:border-white/[0.06] px-3 py-1 text-[11px] text-gray-500 tabular-nums">
    <RadioControls />
    <div className="flex-1" />
    {!code && <div className="flex items-center gap-1.5"><Zap size={12} aria-hidden="true" className="shrink-0 text-amber-500 dark:text-amber-400" /><ContextDropdown><TokenCounter /></ContextDropdown></div>}
    <span className="inline-flex items-center gap-1" title={text('Total computer CPU usage')}><Cpu size={12} className="text-blue-600 dark:text-blue-400" />CPU {percent(resources?.cpuPercent)}</span>
    <span className="inline-flex items-center gap-1" title={text('Total computer RAM usage')}><MemoryStick size={12} className="text-emerald-600 dark:text-emerald-400" />RAM {memory(resources?.ramUsedBytes, resources?.ramTotalBytes)}</span>
    {resources?.gpus.length ? resources.gpus.map(gpu => <span key={gpu.index} className="inline-flex items-center gap-1" title={gpu.name}><Monitor size={12} className="text-cyan-600 dark:text-cyan-400" />GPU{resources.gpus.length > 1 ? gpu.index + 1 : ''} {percent(gpu.percent)} · {memory(gpu.usedBytes, gpu.totalBytes)}</span>) : <span className="inline-flex items-center gap-1" title={text('Live GPU measurements are unavailable on this device or driver.')}><Monitor size={12} className="text-cyan-600 dark:text-cyan-400" />GPU —</span>}
  </div>
}
