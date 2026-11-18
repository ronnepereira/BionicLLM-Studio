import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { FileDiff, Globe, TerminalSquare, FolderOpen, PanelRightClose, Loader2 } from 'lucide-react'
import { useSidePanelStore, type SidePanelTab } from '../../stores/sidePanelStore'
import { useBrowserStore } from '../../stores/browserStore'
import { useChatStore } from '../../stores/chatStore'
import { useCodexStore } from '../../stores/codexStore'
import { BrowserPanel } from '../browser/BrowserPanel'
import { ExplorerPanel } from '../chat/ExplorerPanel'
import { ReviewPanel } from './ReviewPanel'
const TerminalPanel = lazy(() => import('./TerminalPanel').then(m => ({ default: m.TerminalPanel })))

const TABS = [
  { id: 'review', label: 'Revisão', icon: FileDiff, color: 'text-amber-500', key: 'R' },
  { id: 'browser', label: 'Navegador', icon: Globe, color: 'text-blue-400', key: 'B' },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, color: 'text-green-500', key: 'T' },
  { id: 'files', label: 'Abrir arquivo', icon: FolderOpen, color: 'text-yellow-500', key: 'P' },
] as const

export function SidePanel({ visible }: { visible: boolean }) {
  const { open, active, visited, size, show, close } = useSidePanelStore()
  const codeMode = useChatStore(s => s.conversations.find(c => c.id === s.activeConversationId)?.mode === 'codex')
  const conversationId = useChatStore(s => s.activeConversationId)
  const planWaiting = useCodexStore(s => !!conversationId && !!s.planApprovalByConversation[conversationId])
  const tablist = useRef<HTMLDivElement>(null)
  const shown = visible && open
  useEffect(() => { if (planWaiting) useSidePanelStore.getState().show('files') }, [planWaiting])
  const choose = (id: SidePanelTab) => {
    if (id === 'browser') useBrowserStore.getState().setOpen(true)
    else show(id)
  }
  const hide = () => { useBrowserStore.getState().setOpen(false); close() }
  useEffect(() => {
    const selected = tablist.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (shown && selected) {
      const scroller = tablist.current!
      if (selected.offsetLeft < scroller.scrollLeft) scroller.scrollLeft = selected.offsetLeft
      else if (selected.offsetLeft + selected.offsetWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = selected.offsetLeft + selected.offsetWidth - scroller.clientWidth
    }
  }, [active, shown])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!visible || !event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || document.querySelector('[role="dialog"][data-studio-dialog],dialog[open]')) return
      const item = TABS.find(t => t.key.toLowerCase() === event.key.toLowerCase())
      if (item) { event.preventDefault(); if (item.id === 'browser') useBrowserStore.getState().setOpen(true); else useSidePanelStore.getState().show(item.id) }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [visible])
  return <>
    {shown && <SidePanelResize />}
    <aside aria-label="Painel lateral" style={{ '--side-panel-size': `${size}%`, display: shown ? 'flex' : 'none' } as React.CSSProperties} className="studio-panel studio-form min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl bg-white ring-1 ring-black/10 dark:bg-[#1e1e1e] dark:ring-white/10 max-[999px]:h-[var(--side-panel-size)] min-[1000px]:w-[var(--side-panel-size)]">
      <div className="flex min-w-0 shrink-0 items-center border-b border-gray-200 dark:border-white/10">
        <div ref={tablist} role="tablist" aria-label="Ferramentas do painel lateral" {...{ focusgroup: 'tablist nomemory' }} className="flex min-w-0 flex-1 overflow-x-auto scrollbar-thin" onKeyDown={event => {
          if ('focusGroup' in HTMLElement.prototype || !['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return
          event.preventDefault()
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
          buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length]?.focus()
        }}>
          {TABS.map(tab => <button type="button" key={tab.id} id={`side-tab-${tab.id}`} role="tab" aria-selected={active === tab.id} tabIndex={active === tab.id || !active && tab.id === 'review' ? 0 : -1} {...(active === tab.id ? { focusgroupstart: '' } : {})} onClick={() => choose(tab.id)} className="relative flex min-h-11 shrink-0 items-center gap-1.5 px-3 text-xs text-gray-600 hover:bg-gray-100 aria-selected:text-blue-500 aria-selected:after:absolute aria-selected:after:inset-x-2 aria-selected:after:bottom-0 aria-selected:after:border-b-2 aria-selected:after:border-blue-500 dark:text-gray-300 dark:hover:bg-white/5" title={`Ctrl+Alt+${tab.key}`}><tab.icon size={14} className={tab.color} />{tab.label}</button>)}
        </div>
        <button type="button" aria-label="Ocultar painel lateral" onClick={hide} className="m-1 flex min-h-8 min-w-8 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10"><PanelRightClose size={16} /></button>
      </div>
      {!active && <div className="flex min-h-0 flex-1 flex-col justify-center gap-3 overflow-y-auto p-5">{TABS.map(tab => <button type="button" key={tab.id} onClick={() => choose(tab.id)} className="flex min-h-12 items-center gap-3 rounded-lg border border-gray-200 px-4 py-3 text-left text-sm hover:bg-gray-100 dark:border-white/10 dark:hover:bg-white/5"><tab.icon size={18} className={tab.color} /><span className="flex-1">{tab.label}</span><kbd className="text-xs text-gray-500">Ctrl+Alt+{tab.key}</kbd></button>)}</div>}
      {visited.map(tab => <div key={tab} role="tabpanel" aria-labelledby={`side-tab-${tab}`} hidden={active !== tab} className={active === tab ? 'min-h-0 min-w-0 flex-1 overflow-hidden' : 'hidden'}>
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
