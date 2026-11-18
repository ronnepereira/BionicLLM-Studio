import { useEffect, useRef, useState } from 'react'
import { Square, Play, Eraser } from 'lucide-react'
import { backendCall, isTauri } from '../../api/backend'
import { useCodexStore } from '../../stores/codexStore'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export function TerminalPanel({ active }: { active: boolean }) {
  const folder = useCodexStore(s => s.workingDirectory)
  const host = useRef<HTMLDivElement>(null)
  const terminal = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const session = useRef<string | null>(null)
  const alive = useRef(true)
  const inputQueue = useRef(Promise.resolve())
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cwd, setCwd] = useState('')
  const [error, setError] = useState('')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const resize = () => {
    if (!host.current?.getClientRects().length) return
    fit.current?.fit()
    const t = terminal.current
    if (t && session.current) void backendCall('studio_terminal_resize', { id: session.current, cols: t.cols, rows: t.rows }).catch(() => {})
  }
  useEffect(() => {
    alive.current = true
    if (!host.current || !isTauri()) return
    const term = new Terminal({ fontSize: 13, fontFamily: 'Consolas, monospace', cursorBlink: true, scrollback: 3000, theme: { background: '#151515', foreground: '#e5e7eb' }, allowProposedApi: false })
    const addon = new FitAddon()
    term.loadAddon(addon); term.open(host.current)
    terminal.current = term; fit.current = addon
    const data = term.onData(data => {
      const id = session.current
      if (!id) return
      inputQueue.current = inputQueue.current.then(() => backendCall<void>('studio_terminal_write', { id, data })).catch(e => { if (alive.current) setError(String(e)) })
    })
    const observer = new ResizeObserver(resize)
    observer.observe(host.current)
    let polling = false
    const poll = async () => {
      const id = session.current
      if (!id || polling) return
      polling = true
      try {
        const out = await backendCall<{ bytes: number[]; exitCode: number | null; dropped: boolean }>('studio_terminal_read', { id })
        if (!alive.current || session.current !== id) return
        if (out.dropped) term.writeln('\r\n[Saída muito extensa: parte do conteúdo anterior foi descartada.]')
        if (out.bytes.length) term.write(new Uint8Array(out.bytes))
        if (out.exitCode !== null) { setRunning(false); setExitCode(out.exitCode) }
      } catch (e) { if (alive.current && session.current === id) { setError(String(e)); setRunning(false) } }
      finally { polling = false }
    }
    const timer = window.setInterval(() => { void poll() }, 150)
    return () => {
      alive.current = false
      clearInterval(timer); observer.disconnect(); data.dispose(); term.dispose()
      terminal.current = null; fit.current = null
      const id = session.current; session.current = null
      if (id) void backendCall('studio_terminal_close', { id }).catch(() => {})
    }
  }, [])
  useEffect(() => { if (active) { resize(); terminal.current?.focus() } }, [active])
  const stop = async () => {
    const id = session.current
    if (!id) return
    setBusy(true)
    try { await backendCall('studio_terminal_close', { id }); session.current = null; setRunning(false); terminal.current?.writeln('\r\n[Sessão encerrada.]') }
    catch (e) { setError(String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const start = async () => {
    if (busy || !isTauri()) return
    setBusy(true); setError(''); setExitCode(null)
    try {
      if (session.current) { await backendCall('studio_terminal_close', { id: session.current }); session.current = null }
      fit.current?.fit()
      const t = terminal.current
      const result = await backendCall<{ id: string; cwd: string }>('studio_terminal_start', { workingDirectory: folder || undefined, cols: t?.cols ?? 80, rows: t?.rows ?? 24 })
      if (!alive.current) { void backendCall('studio_terminal_close', { id: result.id }); return }
      session.current = result.id; setCwd(result.cwd); setRunning(true); t?.clear(); t?.focus()
    } catch (e) { if (alive.current) setError(String(e)) }
    finally { if (alive.current) setBusy(false) }
  }
  const button = 'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10 disabled:opacity-40'
  return <div className="flex h-full min-h-0 flex-col bg-[#151515] text-gray-200">
    <div className="flex flex-wrap items-center gap-1 border-b border-white/10 p-2">
      <button type="button" onClick={() => { void start() }} disabled={busy || running || !isTauri()} className={button}><Play size={13} className="text-green-400" />{busy ? 'Aguarde…' : 'Iniciar terminal'}</button>
      <button type="button" onClick={() => { void stop() }} disabled={busy || !session.current} className={button}><Square size={12} className="text-red-400" />Encerrar sessão</button>
      <button type="button" onClick={() => terminal.current?.clear()} className={button}><Eraser size={13} />Limpar tela</button>
    </div>
    <p className="break-all border-b border-white/10 px-3 py-2 text-xs text-gray-400">{cwd || folder || 'Caixa de areia própria do terminal'}{running ? ' · Em execução' : exitCode !== null ? ` · Finalizado com código ${exitCode}` : ''}</p>
    {!running && !cwd && <p className="px-3 py-2 text-xs text-gray-400">{isTauri() ? 'Inicie uma sessão interativa. A pasta inicial é a selecionada em Abrir arquivo. Trocar de aba ou ocultar o painel mantém a sessão; Encerrar sessão ou Sair fecha os processos.' : 'O terminal interativo está disponível no aplicativo desktop.'}</p>}
    {error && <p role="alert" className="px-3 py-2 text-xs text-red-400">{error}</p>}
    <div ref={host} role="region" aria-label="Terminal interativo" className="min-h-0 min-w-0 flex-1 overflow-hidden p-2" />
  </div>
}
