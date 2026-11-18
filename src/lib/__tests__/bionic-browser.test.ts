/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { browserUrl, claimBrowser, waitForBrowser } from '../../api/studio-browser'
import { browserActionArgs, registerBrowserTools } from '../../api/mcp/browser-tools'
import { useBrowserStore } from '../../stores/browserStore'
import { beginAgentRun, endAgentRun } from '../../api/agent-context'
import { resolveChatToolRoute } from '../chat-tool-intent'
import { ToolRegistry } from '../../api/mcp/tool-registry'
import { selectRelevantTools, SMALL_MODEL_MAX_TOOLS } from '../tool-selection'
import { DEFAULT_PERMISSIONS } from '../../api/mcp/types'
import * as browserApi from '../../api/studio-browser'
import * as backend from '../../api/backend'
import { resolveApprovalLevel } from '../agent-approval-policy'
import { browserRoutingText } from '../browser-intent'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

beforeEach(() => useBrowserStore.setState({ ownerToken: null, open: false }))
afterEach(() => vi.restoreAllMocks())

describe('internal browser boundaries and routing', () => {
  it('accepts ordinary websites and rejects application origins, credentials and executable URLs', () => {
    expect(browserUrl('google.com')).toBe('https://google.com/')
    expect(browserUrl('http://127.0.0.1:5286/page')).toContain('/page')
    for (const source of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,test', 'tauri://localhost', 'http://ipc.localhost', 'https://tauri.localhost', 'https://name:pass@example.com', 'https://example.com\n', '']) expect(() => browserUrl(source)).toThrow()
  })
  it('reports a completed navigation failure and permits recovery after the error is cleared', async () => {
    useBrowserStore.setState({ open: true, loading: false, error: 'Conexão recusada' })
    await expect(waitForBrowser(() => true)).rejects.toThrow('Conexão recusada')
    useBrowserStore.setState({ error: null })
    await expect(waitForBrowser(() => true)).resolves.toBeUndefined()
  })
  it('opens a local preview in the calling run workspace and returns server errors', async () => {
    vi.spyOn(backend, 'isTauri').mockReturnValue(true)
    vi.spyOn(backend, 'isMobile').mockReturnValue(false)
    vi.spyOn(browserApi, 'browserReady').mockResolvedValue()
    vi.spyOn(browserApi, 'waitForBrowser').mockResolvedValue()
    const command = vi.spyOn(browserApi, 'browserCommand').mockResolvedValue({ ok: true })
    const run = beginAgentRun({ conversationId: 'preview', chatId: 'preview-slug', workspace: { kind: 'folder', path: 'C:/Projects/timer' } })
    const registry = new ToolRegistry()
    registerBrowserTools(registry)
    try {
      await registry.execute('browser_open', { path: 'pomodoro.html' }, 0, run)
      expect(command).toHaveBeenCalledWith({ action: 'preview', path: 'pomodoro.html', chatId: 'preview-slug', workingDirectory: 'C:/Projects/timer' })
      command.mockRejectedValueOnce(new Error('Arquivo HTML não encontrado'))
      expect(await registry.execute('browser_open', { path: 'missing.html' }, 0, run)).toContain('Error: Arquivo HTML não encontrado')
      expect(useBrowserStore.getState().loading).toBe(false)
      expect(await registry.execute('browser_open', { path: 'timer.html', url: 'http://localhost:8080' }, 0, run)).toContain('Informe somente')
    } finally { endAgentRun(run) }
  })
  it('validates untrusted model action arguments without accepting script or selector injection', () => {
    expect(browserActionArgs({ action: 'type', target: 'e2', text: "');alert(1)//", token: 'page-token' })).toEqual({ action: 'type', target: 'e2', text: "');alert(1)//", token: 'page-token' })
    for (const args of [{ action: 'eval', token: 'x' }, { action: 'click', token: 'x', target: 'body' }, { action: 'scroll', token: 'x', y: Infinity }, { action: 'press', token: 'x', text: 'Control+Shift+I' }, { action: 'type', token: 'x', target: 'e1', text: 'x'.repeat(16001) }]) expect(() => browserActionArgs(args)).toThrow()
  })
  it('returns a new observation after typing and pressing Enter without replaying the action', async () => {
    vi.spyOn(backend, 'isTauri').mockReturnValue(true)
    vi.spyOn(backend, 'isMobile').mockReturnValue(false)
    vi.spyOn(browserApi, 'waitForBrowser').mockResolvedValue()
    let reads = 0
    const command = vi.spyOn(browserApi, 'browserCommand').mockImplementation(async request => request.action === 'read'
      ? { token: `page-${++reads}`, text: 'Resultados', elements: [{ ref: 'e1', label: 'Pesquisar' }] }
      : { ok: true })
    useBrowserStore.setState({ open: true, ready: true, error: null })
    const run = beginAgentRun({ conversationId: 'search' })
    const registry = new ToolRegistry()
    registerBrowserTools(registry)
    try {
      const first = JSON.parse(await registry.execute('browser_action', { action: 'type', token: 'page-0', target: 'e1', text: 'Rust' }, 0, run))
      expect(first.token).toBe('page-1')
      const next = JSON.parse(await registry.execute('browser_action', { action: 'press', token: first.token, target: 'e1', text: 'Enter' }, 0, run))
      expect(next.token).toBe('page-2')
      expect(command).toHaveBeenCalledWith({ action: 'press', token: 'page-1', target: 'e1', text: 'Enter' })
      expect(command.mock.calls.filter(([request]) => request.action === 'press')).toHaveLength(1)
      command.mockImplementation(async request => request.action === 'read'
        ? { token: 'scroll-result', pageScroll: { atTop: true }, text: 'Página' }
        : { ok: true, scroll: { moved: false, scope: 'element' }, message: 'Sem movimento' })
      const stalled = JSON.parse(await registry.execute('browser_action', { action: 'scroll', token: next.token, target: 'e1', y: -10000 }, 0, run))
      expect(stalled.scroll).toEqual({ moved: false, scope: 'element' })
      expect(stalled.message).toBe('Sem movimento')
      expect(stalled.token).toBe('scroll-result')
      command.mockImplementation(async request => { if (request.action === 'read') throw new Error('A página mudou'); return { ok: true } })
      const pending = JSON.parse(await registry.execute('browser_action', { action: 'click', token: next.token, target: 'e1' }, 0, run))
      expect(pending.ok).toBe(true)
      expect(pending.observationError).toContain('A página mudou')
      expect(command.mock.calls.filter(([request]) => request.action === 'click')).toHaveLength(1)
    } finally { endAgentRun(run) }
  })
  it('keeps browser tools for natural search and continuation requests', () => {
    expect(resolveChatToolRoute('pesquise no navegador aberto por documentação Rust', false, [])).toEqual({ capability: 'web' })
    const followUp = browserRoutingText('agora pesquise por Tauri', ['abra google.com no navegador'])
    const registry = new ToolRegistry()
    registerBrowserTools(registry)
    expect(selectRelevantTools(followUp, registry.getAll(), DEFAULT_PERMISSIONS, SMALL_MODEL_MAX_TOOLS).map(tool => tool.name)).toEqual(expect.arrayContaining(['browser_open', 'browser_read', 'browser_action']))
    expect(browserRoutingText('bom dia', ['abra google.com no navegador'])).toBe('bom dia')
  })
  it('prevents a second live agent from taking over, then allows it after the first run ends', () => {
    const first = beginAgentRun({ conversationId: 'first' })
    const second = beginAgentRun({ conversationId: 'second' })
    try {
      claimBrowser(first)
      expect(() => claimBrowser(second)).toThrow('Outro agente')
      endAgentRun(first)
      expect(() => claimBrowser(second)).not.toThrow()
      expect(() => claimBrowser()).toThrow('execução ativa')
    } finally { endAgentRun(first); endAgentRun(second) }
  })
  it('routes Portuguese browser commands and their follow-ups through the actual chat tool loop', () => {
    const content = 'abre o site google.com no navegador'
    expect(resolveChatToolRoute(content, false, [])).toEqual({ capability: 'web' })
    expect(resolveChatToolRoute('digite modelos locais na busca', false, [{ role: 'user', content }])).toEqual({ capability: 'web' })
    expect(resolveChatToolRoute('boa tarde', false, [{ role: 'user', content }])).toBeNull()
  })
  it('keeps browser actions behind desktop/Ask permissions and out of read-only runs', () => {
    const registry = new ToolRegistry()
    registerBrowserTools(registry)
    expect(registry.getPermissionLevel('browser_action', DEFAULT_PERMISSIONS)).toBe('confirm')
    const decision = { categoryLevel: 'confirm' as const, codexMode: null, readOnlyRun: false }
    expect(resolveApprovalLevel('browser_action', decision)).toBe('confirm')
    expect(resolveApprovalLevel('browser_action', { ...decision, codexMode: 'ask', execConfirm: true })).toBe('confirm')
    expect(resolveApprovalLevel('browser_action', { ...decision, readOnlyRun: true })).toBe('blocked')
    expect(resolveApprovalLevel('browser_action', { ...decision, categoryLevel: 'blocked' })).toBe('blocked')
    const selected = selectRelevantTools('abra google.com no navegador', registry.getAll(), DEFAULT_PERMISSIONS, SMALL_MODEL_MAX_TOOLS)
    expect(selected.map(tool => tool.name)).toEqual(expect.arrayContaining(['browser_open', 'browser_read', 'browser_action']))
  })
})

describe('page snapshot/action script', () => {
  it('prepares a hit-tested native click, focuses a field for Enter and scrolls an inner area', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-tauri/resources/browser-page.js'), 'utf8')
    const page = new Function(`return (${source})`)() as (request: Record<string, unknown>) => { click?: { x: number; y: number }; key?: string; error?: string; message?: string; scroll?: { moved: boolean; scope: string; after: { atTop: boolean } }; elements?: { ref: string; label: string; scrollable?: boolean }[] }
    document.body.innerHTML = '<input aria-label="Pesquisar"><button>Buscar</button><div aria-label="Lista" style="overflow-y:auto">Resultados</div>'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 } as DOMRect)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const button = document.querySelector('button')!
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => button) })
    const area = document.querySelector('div')!
    Object.defineProperty(area, 'clientHeight', { value: 30 })
    Object.defineProperty(area, 'scrollHeight', { value: 500 })
    Object.defineProperty(area, 'scrollBy', { configurable: true, value: vi.fn(({ top }: ScrollToOptions) => { area.scrollTop = Math.max(0, Math.min(470, area.scrollTop + (top || 0))) }) })
    const snapshot = page({ action: 'read', token: 'one' })
    expect(page({ action: 'click', token: 'one', target: 'e2' }).click).toEqual({ x: 50, y: 10 })
    page({ action: 'read', token: 'two' })
    expect(page({ action: 'press', token: 'two', target: 'e1', text: 'Enter' }).key).toBe('Enter')
    expect(document.activeElement).toBe(document.querySelector('input'))
    const list = snapshot.elements?.find(element => element.label === 'Lista')
    expect(list?.scrollable).toBe(true)
    page({ action: 'read', token: 'three' })
    expect(page({ action: 'scroll', token: 'three', target: list?.ref, y: 300 }).error).toBeUndefined()
    expect(area.scrollBy).toHaveBeenCalledWith({ left: 0, top: 300, behavior: 'instant' })
    page({ action: 'read', token: 'four' })
    expect(page({ action: 'scroll', token: 'four', target: list?.ref, y: -10000 }).scroll?.moved).toBe(true)
    page({ action: 'read', token: 'five' })
    const stalled = page({ action: 'scroll', token: 'five', target: list?.ref, y: -10000 })
    expect(stalled.scroll).toMatchObject({ moved: false, scope: 'element', after: { atTop: true } })
    expect(stalled.message).toContain('omita target')
  })
  it('hides field values, preserves literal text and refuses stale element references', () => {
    const source = readFileSync(resolve(__dirname, '../../../src-tauri/resources/browser-page.js'), 'utf8')
    const page = new Function(`return (${source})`)() as (request: Record<string, unknown>) => { token?: string; text?: string; elements?: { ref: string; type: string }[]; error?: string }
    document.body.innerHTML = '<label>Conta<input value="private-value"></label><label>Senha<input type="password" value="secret-password"></label><button>Enviar</button>'
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100, height: 20, top: 0, bottom: 20, left: 0, right: 100 } as DOMRect)
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
    const snapshot = page({ action: 'read', token: 'one' })
    expect(JSON.stringify(snapshot)).not.toContain('private-value')
    expect(JSON.stringify(snapshot)).not.toContain('secret-password')
    const input = document.querySelector('input')!
    const onInput = vi.fn()
    input.addEventListener('input', onInput)
    const literal = "'); window.compromised = true; //"
    expect(page({ action: 'type', token: 'one', target: 'e1', text: literal }).error).toBeUndefined()
    expect(input.value).toBe(literal)
    expect(onInput).toHaveBeenCalledOnce()
    expect(page({ action: 'click', token: 'one', target: 'e3' }).error).toContain('novamente')
  })
})
