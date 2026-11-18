import type { ChatMessage } from '../api/providers/types'
import { useEffect } from 'react'
import { backendCall, isTauri } from '../api/backend'
import { useSettingsStore } from '../stores/settingsStore'
import { useModelStore } from '../stores/modelStore'
import { useChatStore, flushChatPersist } from '../stores/chatStore'
import { useGenerationStore } from '../stores/generationStore'
import { useScheduleStore } from '../stores/scheduleStore'
import { useBackgroundJobStore } from '../stores/backgroundJobStore'
import { useUIStore } from '../stores/uiStore'
import { subscribeApprovals, listApprovals } from '../lib/approval-queue'
import { runScheduledAgent } from '../api/agents/scheduled-agent'
import { getProviderForModel } from '../api/providers'
import type { StudioSchedule } from '../lib/schedules'

interface Job { id: string; prompt: string; model?: string; kind: string; status: string; messages?: ChatMessage[] }

export function useDesktopRuntime() {
  useEffect(() => {
    if (!isTauri()) return
    let alive = true, polling = false
    const running = new Map<string, AbortController>()
    const notify = (title: string, body: string, conversationId?: string) => {
      const settings = useSettingsStore.getState().settings
      if (settings.completionNotifications === false) return
      void backendCall('desktop_notify', { title, body: settings.notificationPreview === true ? body.slice(0, 180) : 'Abra o BionicLLM Studio para ver o resultado.', conversationId }).catch(console.warn)
    }
    const generations = useGenerationStore.subscribe((state, before) => {
      for (const id of Object.keys(before.runs)) {
        if (state.runs[id] || id.startsWith('task-')) continue
        const conversation = useChatStore.getState().conversations.find(c => c.id === id)
        const answer = conversation?.messages.filter(m => m.role === 'assistant' && m.content.trim()).at(-1)
        if (conversation && answer && answer.timestamp >= before.runs[id].bookedAt) notify('BionicLLM Studio · resposta finalizada', conversation.title || answer.content, id)
      }
    })
    const schedules = useScheduleStore.subscribe((state, before) => {
      for (const item of state.items) {
        const old = before.items.find(s => s.id === item.id)
        if (old?.status === 'running' && ['completed', 'failed'].includes(item.status)) {
          notify(item.status === 'completed' ? 'Agenda concluída' : 'Falha na agenda', item.name, item.conversationId)
        }
      }
    })
    const media = useBackgroundJobStore.subscribe((state, before) => {
      for (const [id, job] of Object.entries(state.jobs)) {
        if (before.jobs[id]?.state === 'running' && job.state !== 'running') notify('BionicLLM Studio · geração finalizada', job.toolName, job.convId)
      }
    })
    const announced = new Set<string>()
    const approvals = subscribeApprovals(() => {
      for (const conversation of useChatStore.getState().conversations) {
        for (const call of listApprovals(conversation.id)) {
          if (announced.has(call.id)) continue
          announced.add(call.id)
          notify('BionicLLM Studio · sua confirmação é necessária', call.toolName, conversation.id)
        }
      }
    })
    let unlisten: (() => void) | undefined
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      const stop = await listen<string | null>('notification:open', ({ payload }) => {
        if (payload && useChatStore.getState().conversations.some(c => c.id === payload)) {
          useChatStore.getState().setActiveConversation(payload)
          useUIStore.getState().setView('chat')
        }
      })
      if (!alive) stop(); else unlisten = stop
    })
    const execute = async (job: Job) => {
      const controller = new AbortController(); running.set(job.id, controller)
      let conversationId: string | undefined
      try {
        const settings = useSettingsStore.getState().settings
        const chosen = settings.agentFixedModel === true ? settings.agentDefaultModel : ((job.model === 'default' ? undefined : job.model) || settings.agentDefaultModel || useModelStore.getState().activeModel)
        if (!chosen || !useModelStore.getState().models.some(m => m.name === chosen && m.type !== 'image' && m.type !== 'video')) throw new Error('O modelo solicitado ou padrão não está disponível. Configure um modelo de texto em Configurações.')
        let result: string, status: string
        if (job.kind === 'chat') {
          conversationId = useChatStore.getState().createConversation(chosen, '', 'lu', { activate: false })
          useChatStore.getState().addMessage(conversationId, { id: crypto.randomUUID(), role: 'user', content: job.prompt, timestamp: Date.now() })
          const { provider, modelId } = getProviderForModel(chosen)
          result = ''; let lastProgress = 0
          for await (const chunk of provider.chatStream(modelId, job.messages || [{ role: 'user', content: job.prompt }], { signal: controller.signal, window: 'chat' })) {
            result += chunk.content
            if (Date.now() - lastProgress > 250) {
              await backendCall('agent_gateway_progress', { id: job.id, result })
              lastProgress = Date.now()
            }
          }
          if (!result.trim()) throw new Error('O modelo terminou sem uma resposta.')
          status = 'completed'
          useChatStore.getState().addMessage(conversationId, { id: crypto.randomUUID(), role: 'assistant', content: result, timestamp: Date.now() })
          await flushChatPersist()
        } else {
          const item: StudioSchedule = { id: job.id, name: 'Agente externo', goal: job.prompt, agent: { id: job.id, name: 'Agente externo', instructions: '', model: chosen }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, rule: { kind: 'once', local: '2000-01-01T00:00' }, enabled: false, nextAt: null, lastAt: Date.now(), status: 'running' }
          const outcome = await runScheduledAgent(item, controller.signal, async id => { conversationId = id })
          result = outcome.result; status = outcome.status
        }
        await backendCall('agent_gateway_finish', { id: job.id, status, result, conversationId })
        notify('Agente externo finalizado', result, conversationId)
      } catch (error) {
        await backendCall('agent_gateway_finish', { id: job.id, status: controller.signal.aborted ? 'cancelled' : 'failed', result: String(error), conversationId }).catch(console.warn)
        if (!controller.signal.aborted) notify('Agente externo · falha', String(error), conversationId)
      } finally { running.delete(job.id) }
    }
    const poll = async () => {
      if (polling || !alive || !useModelStore.getState().inventoryLoaded || !useChatStore.persist.hasHydrated()) return
      polling = true
      try {
        const jobs = await backendCall<Job[]>('agent_gateway_sync', { enabled: useSettingsStore.getState().settings.externalAgentEnabled !== false, models: useModelStore.getState().models.filter(m => m.type !== 'image' && m.type !== 'video').map(m => m.name) })
        if (!alive) return
        for (const job of jobs) {
          if (job.status === 'cancelled') running.get(job.id)?.abort()
          else if (!running.has(job.id)) void execute(job)
        }
      } catch (error) { console.warn('[desktop-runtime]', error) }
      finally { polling = false }
    }
    const timer = window.setInterval(() => { void poll() }, 1000)
    void poll()
    return () => { alive = false; clearInterval(timer); generations(); schedules(); media(); approvals(); unlisten?.(); for (const controller of running.values()) controller.abort() }
  }, [])
}
