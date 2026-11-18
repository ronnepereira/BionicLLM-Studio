import { scheduleResultMessageId } from '../../lib/schedule-results'
import { v4 as uuid } from 'uuid'
import { beginAgentRun, endAgentRun } from '../agent-context'
import { startBackgroundAgent } from './sub-agent'
import { useChatStore, flushChatPersist } from '../../stores/chatStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useModelStore } from '../../stores/modelStore'
import { useGenerationStore } from '../../stores/generationStore'
import { toolResultIsFailure } from '../../lib/tool-result-failure'
import type { StudioSchedule } from '../../lib/schedules'
import { isTerminal, type AgentTask } from '../../lib/agent-tasks'
import { resolveChatWorkspaceSlug } from '../workspace-slug'

/** Schedule execution never changes the selected model or the current view. */
export async function runScheduledAgent(item: StudioSchedule, signal: AbortSignal, onConversation: (id: string) => Promise<void>): Promise<{ status: 'completed' | 'failed' | 'cancelled'; result: string }> {
  // Import registers real tools before the headless loop starts.
  await import('../mcp')
  if (signal.aborted) return { status: 'cancelled', result: 'Execução cancelada antes do início.' }
  const model = useModelStore.getState().models.find(model => model.name === item.agent.model)
  if (!model || model.provider === 'lu-cloud' || model.type === 'image' || model.type === 'video') throw new Error('O modelo de texto deste agendamento não está disponível. Confira os provedores e modelos.')
  const chat = useChatStore.getState()
  const convId = chat.createConversation(item.agent.model, '', 'lu', { agent: { profileId: item.agent.id, instructions: item.agent.instructions }, activate: false })
  chat.renameConversation(convId, `${item.name} · ${item.id.slice(0, 8)}`)
  useAgentModeStore.getState().setWorkspace(convId, { kind: 'sandbox' })
  useAgentModeStore.getState().setAgentModeActive(convId, true)
  chat.addMessage(convId, { id: uuid(), role: 'user', content: item.goal, timestamp: Date.now() })
  const slug = await resolveChatWorkspaceSlug(convId, item.name)
  await flushChatPersist()
  await onConversation(convId)
  const run = beginAgentRun({ chatId: slug, conversationId: convId, workspace: { kind: 'sandbox' } })
  run.abortSignal = signal
  let taskId: string | undefined
  const cancel = () => {
    if (taskId) {
      useAgentTaskStore.getState().cancel(taskId)
      useGenerationStore.getState().abortConversation(taskId)
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) return { status: 'cancelled', result: 'Execução cancelada antes do início.' }
    taskId = await startBackgroundAgent({ goal: item.goal, model: item.agent.model }, run)
    // The agenda owns delivery; opening its conversation must not trigger a second model turn.
    useAgentTaskStore.getState().update(taskId, { reported: true })
    if (signal.aborted) cancel()
    const task = await new Promise<AgentTask>((resolve, reject) => {
      const check = () => {
        const current = useAgentTaskStore.getState().get(taskId!)
        if (!current) { unsubscribe(); reject(new Error('A conversa ou a execução foi removida.')); return }
        if (isTerminal(current.status)) { unsubscribe(); resolve(current) }
      }
      const unsubscribe = useAgentTaskStore.subscribe(check)
      check()
    })
    const result = (task.error?.trim() ? task.error : undefined) || (task.output?.trim() ? task.output : undefined) || 'A execução terminou sem resposta final.'
    const messageId = scheduleResultMessageId(item.id, item.lastAt ?? item.nextAt ?? 0)
    if (!useChatStore.getState().conversations.find(conversation => conversation.id === convId)?.messages.some(message => message.id === messageId)) {
      useChatStore.getState().addMessage(convId, { id: messageId, role: 'assistant', content: result, timestamp: Date.now() })
    }
    await flushChatPersist()

    return { status: task.status === 'cancelled' ? 'cancelled' : task.status === 'failed' || !!task.error?.trim() || !task.output?.trim() || toolResultIsFailure(result) ? 'failed' : 'completed', result }
  } finally {
    signal.removeEventListener('abort', cancel)
    endAgentRun(run)
  }
}
