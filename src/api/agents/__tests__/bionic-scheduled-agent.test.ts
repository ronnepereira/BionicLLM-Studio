/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { useAgentModeStore } from '../../../stores/agentModeStore'
import type { StudioSchedule } from '../../../lib/schedules'
import type { AgentRunContext } from '../../agent-context'

const launch = vi.hoisted(() => vi.fn())
vi.mock('../sub-agent', () => ({ startBackgroundAgent: launch }))
vi.mock('../../mcp', () => ({}))
import { runScheduledAgent } from '../scheduled-agent'

const schedule: StudioSchedule = { id: 'schedule', name: 'Pesquisa agendada', goal: 'Cite as fontes.', agent: { id: 'profile', name: 'Pesquisador', instructions: 'Use as referências.', model: 'openai::test-model' }, timezone: 'America/Sao_Paulo', rule: { kind: 'interval', minutes: 10, startAt: 1 }, enabled: true, nextAt: 1, status: 'running' }
beforeEach(() => {
  launch.mockReset()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useAgentTaskStore.setState({ byConv: {} })
  useModelStore.setState({ models: [{ name: 'openai::test-model', model: 'test-model', size: 0, type: 'text', provider: 'openai', providerName: 'OpenAI' }], activeModel: 'user-selected-model' })
})

describe('scheduled agent adapter', () => {
  it('uses the real conversation/workspace, preserves selection and awaits the task result', async () => {
    const active = useChatStore.getState().createConversation('user-selected-model', '')
    const linked = vi.fn(async () => {})
    launch.mockImplementation(async (_args: unknown, run: AgentRunContext) => {
      // Sandbox is normalized to null; the pinned slug scopes native filesystem calls.
      expect(run.workspace).toBeNull()
      expect(run.chatId).toBe(useAgentModeStore.getState().workspaceSlugs[run.conversationId!])
      expect(run.chatId).not.toBe(run.conversationId)
      expect(run.mode).toBeNull() // Normal agent permissions, never a bypass preset.
      expect(linked).toHaveBeenCalledWith(run.conversationId)
      useAgentTaskStore.getState().start({ id: 'scheduled-task', convId: run.conversationId!, goal: schedule.goal, context: '', background: true, startedAt: Date.now(), controller: new AbortController() })
      return 'scheduled-task'
    })
    const work = runScheduledAgent(schedule, new AbortController().signal, linked)
    await vi.waitFor(() => expect(useAgentTaskStore.getState().get('scheduled-task')?.reported).toBe(true))
    const task = useAgentTaskStore.getState().get('scheduled-task')!
    expect(useAgentModeStore.getState().workspaces[task.convId]).toEqual({ kind: 'sandbox' })
    expect(useChatStore.getState().conversations.find(c => c.id === task.convId)).toMatchObject({ agentInstructions: schedule.agent.instructions, messages: [expect.objectContaining({ role: 'user', content: schedule.goal })] })
    expect(useChatStore.getState().activeConversationId).toBe(active)
    expect(useModelStore.getState().activeModel).toBe('user-selected-model')
    useAgentTaskStore.getState().finish('scheduled-task', { status: 'done', output: 'Referências verificadas.', endedAt: Date.now() })
    await expect(work).resolves.toEqual({ status: 'completed', result: 'Referências verificadas.' })
  })
  it('does not dispatch if linking the durable claim to the conversation fails', async () => {
    await expect(runScheduledAgent(schedule, new AbortController().signal, async () => { throw new Error('Disco cheio') })).rejects.toThrow('Disco cheio')
    expect(launch).not.toHaveBeenCalled()
  })
  it('passes Stop to the real task controller and waits for its terminal state', async () => {
    const controller = new AbortController()
    let taskController!: AbortController
    launch.mockImplementation(async (_args: unknown, run: AgentRunContext) => {
      taskController = new AbortController()
      taskController.signal.addEventListener('abort', () => useAgentTaskStore.getState().finish('cancel-test', { status: 'cancelled', endedAt: Date.now() }))
      useAgentTaskStore.getState().start({ id: 'cancel-test', convId: run.conversationId!, goal: schedule.goal, context: '', background: true, startedAt: Date.now(), controller: taskController })
      return 'cancel-test'
    })
    const work = runScheduledAgent(schedule, controller.signal, async () => {})
    await vi.waitFor(() => expect(useAgentTaskStore.getState().get('cancel-test')?.reported).toBe(true))
    controller.abort()
    await expect(work).resolves.toMatchObject({ status: 'cancelled' })
    expect(taskController.signal.aborted).toBe(true)
  })
})

it('does not mark an empty model response as a successful scheduled task', async () => {
  launch.mockImplementation(async (_args: unknown, run: AgentRunContext) => {
    useAgentTaskStore.getState().start({ id: 'empty-result', convId: run.conversationId!, goal: schedule.goal, context: '', background: true, startedAt: Date.now(), controller: new AbortController() })
    return 'empty-result'
  })
  const work = runScheduledAgent(schedule, new AbortController().signal, async () => {})
  await vi.waitFor(() => expect(useAgentTaskStore.getState().get('empty-result')?.reported).toBe(true))
  useAgentTaskStore.getState().finish('empty-result', { status: 'done', output: '   ', endedAt: Date.now() })
  await expect(work).resolves.toEqual({ status: 'failed', result: 'A execução terminou sem resposta final.' })
})
