import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FileDiff, Globe, TerminalSquare, FolderOpen, Loader2, X } from 'lucide-react'
import { useSidePanelStore, type SidePanelTab } from '../../stores/sidePanelStore'
import { useBrowserStore } from '../../stores/browserStore'
import { useChatStore } from '../../stores/chatStore'
import { useCodexStore } from '../../stores/codexStore'
import { BrowserPanel, BrowserTabs } from '../browser/BrowserPanel'
import { ExplorerPanel } from '../chat/ExplorerPanel'
import { ReviewPanel } from './ReviewPanel'
const TerminalPanel = lazy(() => import('./TerminalPanel').then(m => ({ default: m.TerminalPanel })))

const TABS = [
  { id: 'review', label: 'Revisão', icon: FileDiff, color: 'text-amber-500', key: 'R' },
  { id: 'browser', label: 'Navegador', icon: Globe, color: 'text-blue-400', key: 'B' },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, color: 'text-green-500', key: 'T' },
  { id: 'files', label: 'Abrir arquivo', icon: FolderOpen, color: 'text-yellow-500', key: 'P' },
] as const

function openTool(id: SidePanelTab) {
  if (id === 'browser') useBrowserStore.getState().setOpen(true)
  else useSidePanelStore.getState().show(id)
}

export function SidePanel({ visible }: { visible: boolean }) {
  const { open, active, visited, size, dismiss } = useSidePanelStore()
  const codeMode = useChatStore(s => s.conversations.find(c => c.id === s.activeConversationId)?.mode === 'codex')
  const conversationId = useChatStore(s => s.activeConversationId)
  const planWaiting = useCodexStore(s => !!conversationId && !!s.planApprovalByConversation[conversationId])
  const selected = TABS.find(tab => tab.id === active)
  const menu = useRef<HTMLDivElement>(null)
  const shown = visible && open
  useEffect(() => { if (planWaiting) useSidePanelStore.getState().show('files') }, [planWaiting])
  useEffect(() => {
    if (shown && !active && document.activeElement === document.body) menu.current?.querySelector('button')?.focus()
  }, [active, shown])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!visible || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || document.querySelector('[role="dialog"][data-studio-dialog],dialog[open]')) return
      const item = TABS.find(t => t.key.toLowerCase() === event.key.toLowerCase())
      if (item) { event.preventDefault(); openTool(item.id) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [visible])
  return <>
    {shown && <SidePanelResize />}
    <aside aria-label="Painel lateral" style={{ '--side-panel-size': `${size}%`, display: shown ? 'flex' : 'none' } as React.CSSProperties} className="studio-panel studio-form min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl bg-white ring-1 ring-black/10 dark:bg-[#1e1e1e] dark:ring-white/10 max-[999px]:h-[var(--side-panel-size)] min-[1000px]:w-[var(--side-panel-size)]">
      {active && <div className="flex min-w-0 shrink-0 items-center border-b border-gray-200 dark:border-white/10">
        <div className="flex min-h-11 min-w-0 flex-1 items-center">
          {active === 'browser' ? <BrowserTabs /> : selected && <div className="flex min-w-0 items-center gap-1.5 pl-3 text-xs text-gray-700 dark:text-gray-200">
            <selected.icon size={14} className={`shrink-0 ${selected.color}`} />
            <span className="truncate">{selected.label}</span>
            <button type="button" aria-label={`Fechar ${selected.label}`} title={`Fechar ${selected.label}`} onClick={() => dismiss(selected.id)} className="shrink-0 rounded p-1 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><X size={14} /></button>
          </div>}
        </div>
      </div>}
      {!active && <div ref={menu} className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-y-auto p-5">{TABS.map(tab => <button type="button" key={tab.id} onClick={() => openTool(tab.id)} className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/5"><tab.icon size={18} className={tab.color} /><span className="flex-1">{tab.label}</span><kbd className="text-xs text-gray-500">Ctrl+Alt+{tab.key}</kbd></button>)}</div>}
      {visited.map(tab => <div key={tab} role="region" aria-label={TABS.find(item => item.id === tab)?.label} hidden={active !== tab} className={active === tab ? 'min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}>
        {tab === 'browser' && <BrowserPanel embedded active={shown && active === tab} />}
        {tab === 'review' && <ReviewPanel />}
        {tab === 'terminal' && <Suspense fallback={<div className="p-4"><Loader2 size={18} className="animate-spin" /></div>}><TerminalPanel active={shown && active === tab} /></Suspense>}
        {tab === 'files' && <ExplorerPanel embedded showPlan={codeMode} onApprovePlan={instruction => window.dispatchEvent(new CustomEvent('bionic:approve-code-plan', { detail: { instruction, conversationId: useChatStore.getState().activeConversationId } }))} />}
      </div>)}
    </aside>
  </>
}

function SidePanelResize() {
  const size = useSidePanelStore(s => s.size)
  const [vertical, setVertical] = useState(() => window.innerWidth < 1000)
  useEffect(() => {
    const update = () => setVertical(window.innerWidth < 1000)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const origin = useRef<{ id: number; position: number; extent: number; size: number; vertical: boolean } | null>(null)
  const stop = (event: React.PointerEvent<HTMLDivElement>) => {
    if (origin.current?.id !== event.pointerId) return
    origin.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <div role="separator" tabIndex={0} aria-label="Redimensionar painel lateral" aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuenow={Math.round(size)} aria-valuemin={25} aria-valuemax={75} className="group z-10 flex shrink-0 items-center justify-center rounded focus-visible:ring-2 focus-visible:ring-blue-500 max-[999px]:-my-1 max-[999px]:h-2 max-[999px]:cursor-row-resize min-[1000px]:-mx-1 min-[1000px]:w-2 min-[1000px]:cursor-col-resize touch-none" onPointerDown={event => {
    if (event.button !== 0) return
    event.preventDefault()
    const vertical = window.innerWidth < 1000
    const bounds = event.currentTarget.parentElement!.getBoundingClientRect()
    origin.current = { id: event.pointerId, position: vertical ? event.clientY : event.clientX, extent: vertical ? bounds.height : bounds.width, size, vertical }
    event.currentTarget.setPointerCapture(event.pointerId)
  }} onPointerMove={event => {
    const start = origin.current
    if (!start || start.id !== event.pointerId) return
    if (!(event.buttons & 1)) { stop(event); return }
    useSidePanelStore.getState().resize(start.size - ((start.vertical ? event.clientY : event.clientX) - start.position) / start.extent * 100)
  }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={() => { origin.current = null }} onKeyDown={event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key)) return
    event.preventDefault()
    useSidePanelStore.getState().resize(event.key === 'Home' ? 25 : event.key === 'End' ? 75 : size + (['ArrowLeft','ArrowUp'].includes(event.key) ? 2 : -2))
  }}><span className="rounded-full bg-gray-400/40 group-hover:bg-blue-500 max-[999px]:h-1 max-[999px]:w-10 min-[1000px]:h-10 min-[1000px]:w-1" /></div>
}
