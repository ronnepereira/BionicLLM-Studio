import { skillBudgetForModel } from '../lib/skill-model-budget'
import { create } from 'zustand'
import { runMessagingAgent, validateMessagingModel } from '../api/agents/message-agent'
import { useSkillStore } from './skillStore'
import { useChatStore } from './chatStore'
import { useAgentProfileStore } from './agentProfileStore'
import { messagingPrompt, type MessageChannel, type MessageConfig, type MessageView, type MessageDelivery } from '../lib/messaging'
import type { StudioAgentProfile } from '../lib/agent-profiles'
interface MessageApi<Id> {
  available: () => boolean
  runtime: () => Promise<MessageView<Id>>
  start: (config: MessageConfig<Id>) => Promise<string>
  stop: () => Promise<void>
  poll: (sessionId: string) => Promise<MessageDelivery<Id> | null>
  finish: (sessionId: string, id: string, reply: string | null, conversationId: string | null) => Promise<void>
  send: (sessionId: string, id: string) => Promise<void>
  discard: (id: string) => Promise<void>
}
type Phase = 'idle' | 'loading' | 'starting' | 'listening' | 'generating' | 'stopping' | 'error'
interface Work { id?: string; controller: AbortController; agent: StudioAgentProfile; unsubscribe?: () => void }
export interface MessageRuntimeState<Id> {
  view: MessageView<Id> | null; phase: Phase; error: string
  initialize: () => Promise<void>
  refresh: () => Promise<void>
  start: (config: MessageConfig<Id>, agent: StudioAgentProfile) => Promise<void>
  stop: () => Promise<void>
  send: (id: string) => Promise<void>
  discard: (id: string) => Promise<void>
}
export function createMessageRuntime<Id extends string | number>(channel: MessageChannel, api: MessageApi<Id>) {
  let work: Work | null = null
  let initializing: Promise<void> | null = null
  let manualSend = false
  // Intentionally not persisted: re-opening the app never resumes sending on its own.
  const store = create<MessageRuntimeState<Id>>((set, get) => ({
    view: null, phase: 'idle', error: '',
    refresh: async () => { if (api.available()) set({ view: await api.runtime() }) },
    initialize: async () => {
      if (!api.available()) return
      if (initializing) return initializing
      set({ phase: 'loading' })
      initializing = (async () => {
        try { await api.stop(); await get().refresh(); set({ phase: 'idle' }) }
        catch { set({ phase: 'error', error: `Não foi possível carregar o receptor do ${channel}. Confira o aplicativo desktop.` }) }
      })()
      await initializing
    },
    start: async (config, agent) => {
      if (work || manualSend || !api.available()) return
      set({ phase: 'starting', error: '' })
      const current: Work = { controller: new AbortController(), agent: { ...agent } }
      work = current
      try {
        if (!useChatStore.persist.hasHydrated()) throw new Error(`Aguarde o carregamento das conversas antes de ativar o ${channel}.`)
        if (config.agent_id !== agent.id) throw new Error('O agente selecionado não corresponde à configuração do receptor.')
        validateMessagingModel(agent)
        current.unsubscribe = useAgentProfileStore.subscribe(state => {
          const selected = state.profiles.find(profile => profile.id === current.agent.id)
          if (!selected || selected.model !== current.agent.model || selected.instructions !== current.agent.instructions) {
            set({ error: 'O agente vinculado foi alterado ou removido. Revise a configuração e reative o receptor.' })
            void get().stop()
          }
        })
        current.id = await api.start(config)
        if (current.controller.signal.aborted) { await api.stop(); current.unsubscribe?.(); work = null; set({ phase: get().error ? 'error' : 'idle' }); return }
        await get().refresh()
        void receive(current)
      } catch (error) {
        current.unsubscribe?.()
        work = null
        await api.stop().catch(() => {})
        set({ phase: 'error', error: error instanceof Error ? error.message : String(error) })
      }
    },
    stop: async () => {
      work?.controller.abort()
      set({ phase: 'stopping' })
      try {
        await api.stop()
        await get().refresh()
        if (!work) set({ phase: 'idle' })
      } catch { set({ phase: 'error', error: 'Não foi possível confirmar a parada do receptor. Nenhum novo envio será iniciado.' }) }
    },
    send: async id => {
      if (!work?.id || work.controller.signal.aborted || manualSend) return
      manualSend = true
      set({ error: '' })
      try { await api.send(work.id, id); await get().refresh() }
      catch (error) { set({ error: error instanceof Error ? error.message : typeof error === 'string' ? error : `O envio não foi confirmado. Confira o chat do ${channel}; a resposta não será reenviada automaticamente.` }); await get().refresh().catch(() => {}) }
      finally { manualSend = false }
    },
    discard: async id => {
      try { await api.discard(id); await get().refresh() }
      catch (error) { set({ error: error instanceof Error ? error.message : String(error) }) }
    },
  }))

  async function receive(current: Work) {
    try {
      while (!current.controller.signal.aborted && current.id) {
        store.setState({ phase: 'listening' })
        const message = await api.poll(current.id)
        if (current.controller.signal.aborted) break
        if (!message) continue
        store.setState({ phase: 'generating' })
        await store.getState().refresh()
        let result: { reply: string; conversationId: string }
        try { result = await runMessagingAgent(channel, current.agent, messagingPrompt(channel, current.agent, useSkillStore.getState().skills, await skillBudgetForModel(current.agent.model)), message, current.controller) }
        catch {
          if (!current.controller.signal.aborted) await api.finish(current.id, message.id, null, null)
          throw new Error('Não foi possível gerar a resposta. O receptor foi pausado; a mensagem não será repetida automaticamente.')
        }
        if (current.controller.signal.aborted) break
        await api.finish(current.id, message.id, result.reply, result.conversationId)
        await store.getState().refresh()
      }
    } catch (error) {
      if (!current.controller.signal.aborted) store.setState({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      current.unsubscribe?.()
      current.controller.abort()
      await api.stop().catch(() => {})
      if (work === current) {
        work = null
        await store.getState().refresh().catch(() => {})
        store.setState({ phase: store.getState().error ? 'error' : 'idle' })
      }
    }
  }

  return store
}
