import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, X, Globe, Loader2, Square, Wrench, Eraser } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { useBrowserStore } from '../../stores/browserStore'
import { browserCommand, browserUrl } from '../../api/studio-browser'
import { isTauri } from '../../api/backend'
import type { CSSProperties } from 'react'

interface BrowserEvent { url: string; title: string; loading: boolean; canGoBack: boolean; canGoForward: boolean; error: string | null }

export function BrowserResizeHandle() {
  const text = useUiText()
  const size = useBrowserStore(s => s.size)
  const [vertical, setVertical] = useState(() => window.innerWidth < 1000)
  const origin = useRef<{ pointer: number; size: number; extent: number } | null>(null)
  useEffect(() => {
    const query = matchMedia('(max-width: 999px)')
    const changed = () => setVertical(query.matches)
    query.addEventListener('change', changed)
    return () => query.removeEventListener('change', changed)
  }, [])
  const resize = (value: number) => useBrowserStore.setState({ size: Math.max(20, Math.min(75, value)) })
  return <div role="separator" tabIndex={0} aria-label={text('Resize browser panel')}
    aria-orientation={vertical ? 'horizontal' : 'vertical'} aria-valuemin={20} aria-valuemax={75} aria-valuenow={Math.round(size)}
    className="group z-10 flex shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 max-[999px]:h-2 max-[999px]:-my-1 max-[999px]:cursor-row-resize min-[1000px]:w-2 min-[1000px]:-mx-1 min-[1000px]:cursor-col-resize touch-none"
    onPointerDown={event => {
      if (event.button !== 0) return
      const box = event.currentTarget.parentElement!.getBoundingClientRect()
      origin.current = { pointer: vertical ? event.clientY : event.clientX, size, extent: vertical ? box.height : box.width }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      const start = origin.current
      if (start) resize(start.size - ((vertical ? event.clientY : event.clientX) - start.pointer) / start.extent * 100)
    }}
    onPointerUp={() => { origin.current = null }} onLostPointerCapture={() => { origin.current = null }}
    onKeyDown={event => {
      if (['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
        event.preventDefault()
        resize(event.key === 'Home' ? 20 : event.key === 'End' ? 75 : size + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? 2 : -2))
      }
    }}>
    <span className="rounded-full bg-gray-400/40 group-hover:bg-blue-500 group-focus-visible:bg-blue-500 max-[999px]:h-1 max-[999px]:w-10 min-[1000px]:h-10 min-[1000px]:w-1" />
  </div>
}

export function BrowserPanel({ embedded = false, active = true }: { embedded?: boolean; active?: boolean }) {
  const text = useUiText()
  const { url, title, loading, error, canGoBack, canGoForward, setOpen } = useBrowserStore()
  const size = useBrowserStore(s => s.size)
  const [address, setAddress] = useState(url)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [clearingCache, setClearingCache] = useState(false)
  const [cacheNotice, setCacheNotice] = useState('')
  const clearCache = async () => {
    if (clearingCache) return
    setClearingCache(true)
    setCacheNotice('')
    useBrowserStore.setState({ ownerToken: null, error: null })
    try {
      await browserCommand({ action: 'clear_cache' })
      setCacheNotice(text('Browser cache cleared.'))
    } catch (error) {
      useBrowserStore.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally { setClearingCache(false) }
  }
  const host = useRef<HTMLDivElement>(null)
  const manual = async (action: string, target?: string) => {
    // Manual interaction takes over the shared panel; stale AI snapshots fail closed natively.
    useBrowserStore.setState({ ownerToken: null, error: null })
    try {
      if (action === 'navigate') {
        const url = browserUrl(target || '')
        useBrowserStore.setState({ loading: true })
        await browserCommand({ action, url })
      } else await browserCommand({ action })
    } catch (error) { useBrowserStore.setState({ loading: false, error: error instanceof Error ? error.message : String(error) }) }
  }
  useEffect(() => { setAddress(url) }, [url])
  useEffect(() => {
    if (!isTauri() || !active) return
    let disposed = false
    let off: (() => void) | undefined
    let opened = false
    let pending = false
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const layout = async () => {
      if (disposed || !host.current) return
      if (pending) { again = true; return }
      pending = true
      try {
        const box = host.current.getBoundingClientRect()
        const blocked = [...document.querySelectorAll('[role="dialog"][data-studio-dialog], [aria-modal="true"], dialog[open]')].some(element => element.getClientRects().length > 0)
        if (blocked || box.width < 1 || box.height < 1 || document.visibilityState === 'hidden') {
          if (opened) await browserCommand({ action: 'hide' })
          useBrowserStore.setState({ ready: false })
          return
        }
        const scale = window.devicePixelRatio
        const bounds = { x: Math.round(box.left * scale), y: Math.round(box.top * scale), width: Math.floor(box.width * scale), height: Math.floor(box.height * scale) }
        await browserCommand({ action: opened ? 'layout' : 'open', bounds })
        opened = true
        if (!disposed) useBrowserStore.setState({ ready: true })
      } catch (error) {
        if (!disposed) useBrowserStore.setState({ ready: false, error: error instanceof Error ? error.message : String(error) })
      } finally {
        pending = false
        if (disposed) { if (opened) void browserCommand({ action: 'hide' }).catch(() => {}) }
        else if (again) { again = false; void layout() }
      }
    }
    const scheduleLayout = () => { clearTimeout(timer); timer = setTimeout(() => { void layout() }, 40) }
    const resize = new ResizeObserver(scheduleLayout)
    if (host.current) resize.observe(host.current)
    let wasBlocked = false
    const mutations = new MutationObserver(() => {
      const blocked = [...document.querySelectorAll('[role="dialog"][data-studio-dialog], [aria-modal="true"], dialog[open]')].some(element => element.getClientRects().length > 0)
      if (blocked !== wasBlocked) { wasBlocked = blocked; scheduleLayout() }
    })
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role', 'aria-modal', 'open'] })
    window.addEventListener('resize', scheduleLayout)
    document.addEventListener('visibilitychange', scheduleLayout)
    void (async () => {
      const { listen } = await import('@tauri-apps/api/event')
      const unsubscribe = await listen<BrowserEvent>('studio-browser-state', event => {
        if (!disposed) useBrowserStore.setState(event.payload)
      })
      if (disposed) { unsubscribe(); return }
      off = unsubscribe
      await layout()
    })().catch(error => { if (!disposed) useBrowserStore.setState({ error: String(error) }) })
    return () => {
      disposed = true; off?.(); resize.disconnect(); mutations.disconnect(); clearTimeout(timer)
      window.removeEventListener('resize', scheduleLayout)
      document.removeEventListener('visibilitychange', scheduleLayout)
      useBrowserStore.setState({ ready: false })
      if (opened) void browserCommand({ action: 'hide' }).catch(() => {})
    }
  }, [active])
  const control = 'rounded-md p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-white/10 disabled:opacity-30'
  return <aside aria-label={text('Internal browser')} style={{ '--browser-size': `${size}%` } as CSSProperties} className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-white dark:bg-[#1e1e1e] ${embedded ? 'h-full w-full' : 'rounded-xl ring-1 ring-black/[0.04] dark:ring-white/[0.05] max-[999px]:h-[var(--browser-size)] min-[1000px]:w-[var(--browser-size)] shrink-0'}`}>
    <div className="flex items-center gap-2 border-b border-gray-200 dark:border-white/10 px-3 py-2"><Globe size={15} className="shrink-0" /><span className="flex-1 truncate text-xs font-medium">{title || text('Internal browser')}</span><button className={control} onClick={() => setOpen(false)} title={text('Close browser panel')} aria-label={text('Close browser panel')}><X size={15} /></button></div>
    <div className="flex items-center gap-1 border-b border-gray-200 dark:border-white/10 px-2 py-2">
      <button className={control} disabled={!canGoBack} onClick={() => { void manual('back') }} title={text('Go back')} aria-label={text('Go back')}><ArrowLeft size={15} /></button>
      <button className={control} disabled={!canGoForward} onClick={() => { void manual('forward') }} title={text('Go forward')} aria-label={text('Go forward')}><ArrowRight size={15} /></button>
      <button className={control} onClick={() => { void manual(loading ? 'stop' : 'reload') }} title={loading ? text('Stop loading') : text('Reload page')} aria-label={loading ? text('Stop loading') : text('Reload page')}>{loading ? <Square size={13} /> : <RotateCw size={14} />}</button>
      <form className="min-w-0 flex-1" onSubmit={event => { event.preventDefault(); void manual('navigate', address) }}><input type="text" aria-label={text('Website address')} placeholder={text('Enter a website, for example google.com')} className="w-full min-w-0 rounded-lg border border-gray-300 dark:border-white/15 bg-gray-50 dark:bg-black/15 px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-500" value={address} onChange={event => setAddress(event.target.value)} autoCapitalize="off" spellCheck={false} /></form>
      <button className={control} onClick={() => setToolsOpen(open => !open)} aria-expanded={toolsOpen} aria-controls="browser-tools" title={text('Browser tools')} aria-label={text('Browser tools')}><Wrench size={15} className="text-blue-500" /></button>
      {loading && <Loader2 size={13} className="animate-spin shrink-0" aria-label={text('Loading page')} />}
    </div>
    {toolsOpen && <div id="browser-tools" className="flex flex-wrap items-center gap-2 border-b border-gray-200 dark:border-white/10 px-3 py-2">
      <button className="flex items-center gap-1.5 rounded-md bg-[#1f6feb] px-2.5 py-1.5 text-xs text-white hover:brightness-110 disabled:opacity-50" disabled={clearingCache || !isTauri()} onClick={() => { void clearCache() }} title={text('Clear cached website files')}>
        {clearingCache ? <Loader2 size={14} className="animate-spin" /> : <Eraser size={14} />}{text(clearingCache ? 'Clearing cache...' : 'Clear browser cache')}
      </button>
      <span role="status" className="text-xs text-gray-500 dark:text-gray-400">{cacheNotice}</span>
    </div>}
    {error && <div role="alert" className="border-b border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400">{error}</div>}
    <div ref={host} className="relative min-h-0 flex-1 bg-white">
      {!isTauri() ? <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">{text('Website browsing is available in the Windows desktop app. This web preview only shows the split panel layout.')}</div> : !url && <div className="flex h-full items-center justify-center p-6 text-center text-sm text-gray-500">{text('Enter an address above or ask your agent to open a website in the internal browser.')}</div>}
    </div>
  </aside>
}
