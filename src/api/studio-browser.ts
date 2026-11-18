import { backendCall, isTauri } from './backend'
import { useBrowserStore } from '../stores/browserStore'
import { useUIStore } from '../stores/uiStore'
import { useCompareStore } from '../stores/compareStore'
import { isAgentRunOpen, type AgentRunContext } from './agent-context'

export function browserUrl(raw: string): string {
  if (raw.length > 8192 || [...raw].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new Error('Informe um endereço de site válido.')
  const source = raw.trim()
  if (!source) throw new Error('Informe um endereço de site válido.')
  let url: URL
  try { url = new URL(source.includes('://') ? source : `https://${source}`) }
  catch { throw new Error('Informe um endereço de site válido.') }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || ['tauri.localhost', 'ipc.localhost'].includes(url.hostname)) throw new Error('O navegador aceita apenas sites HTTP ou HTTPS, sem credenciais no endereço.')
  return url.href
}
export function revealBrowser() {
  useCompareStore.getState().setComparing(false)
  useUIStore.getState().setView('chat')
  useBrowserStore.getState().setOpen(true)
}
export async function browserCommand<T = Record<string, unknown>>(request: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('A navegação interna funciona no aplicativo desktop para Windows, não nesta prévia web.')
  return backendCall<T>('studio_browser', { request })
}
/** The browser is shared visually. A second live agent cannot take over another run's page. */
export function claimBrowser(run?: AgentRunContext) {
  if (!run || !isAgentRunOpen(run.token)) throw new Error('A navegação por IA precisa de uma execução ativa do agente.')
  const current = useBrowserStore.getState()
  if (current.ownerToken && current.ownerToken !== run.token && isAgentRunOpen(current.ownerToken)) throw new Error('Outro agente está usando o navegador. Aguarde o término ou interrompa esse agente antes de assumir.')
  useBrowserStore.setState({ ownerToken: run.token })
}
export async function browserReady(signal?: AbortSignal) {
  if (!isTauri()) throw new Error('A navegação interna funciona no aplicativo desktop para Windows, não nesta prévia web.')
  revealBrowser()
  await waitForBrowser(() => useBrowserStore.getState().ready, signal)
}
export async function waitForBrowser(condition: () => boolean, signal?: AbortSignal) {
  const deadline = Date.now() + 28_000
  while (!condition()) {
    if (signal?.aborted) throw new Error('Navegação cancelada pelo usuário.')
    const state = useBrowserStore.getState()
    if (!state.open) throw new Error('O navegador foi fechado pelo usuário.')
    if (state.error) throw new Error(state.error)
    if (Date.now() > deadline) throw new Error('O navegador não respondeu a tempo. Confira o painel antes de repetir a ação.')
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  if (signal?.aborted) throw new Error('Navegação cancelada pelo usuário.')
  const state = useBrowserStore.getState()
  if (!state.open) throw new Error('O navegador foi fechado pelo usuário.')
  if (state.error) throw new Error(state.error)
}
