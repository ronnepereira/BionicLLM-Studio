/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TelegramDelivery, TelegramView } from '../../api/studio-telegram'
const fake = vi.hoisted(() => ({
  native: true, start: vi.fn(), stop: vi.fn(), poll: vi.fn(), finish: vi.fn(), send: vi.fn(), discard: vi.fn(), runtime: vi.fn(), agent: vi.fn(), validate: vi.fn(),
  listener: undefined as undefined | ((state: { profiles: { id: string; model: string; instructions: string }[] }) => void),
}))
vi.mock('../../api/studio-telegram', () => ({ telegramAvailable: () => fake.native, startTelegram: fake.start, stopTelegram: fake.stop, pollTelegram: fake.poll, finishTelegram: fake.finish, sendTelegram: fake.send, discardTelegram: fake.discard, telegramRuntime: fake.runtime }))
vi.mock('../../api/agents/message-agent', () => ({ runMessagingAgent: fake.agent, validateMessagingModel: fake.validate }))
vi.mock('../chatStore', () => ({ useChatStore: { persist: { hasHydrated: () => true } } }))
vi.mock('../skillStore', () => ({ useSkillStore: { getState: () => ({ skills: [] }) } }))
vi.mock('../agentProfileStore', () => ({ useAgentProfileStore: { subscribe: (callback: typeof fake.listener) => { fake.listener = callback; return () => { fake.listener = undefined } } } }))
import { useTelegramRuntimeStore } from '../telegramRuntimeStore'
const agent = { id: 'profile', name: 'Atendimento', model: 'openai::test', instructions: 'Seja breve.' }
const config = { chats: [123], agent_id: agent.id, auto_reply: false }
const message: TelegramDelivery = { id: 'claim', bot_id: 42, update_id: 1, message_id: 2, chat_id: 123, text: 'Olá!', received_at: 1, status: 'processing', reply: null, conversation_id: null }
let rejectPoll: ((error: Error) => void) | undefined
let view: TelegramView
beforeEach(() => {
  for (const mock of [fake.start, fake.stop, fake.poll, fake.finish, fake.send, fake.discard, fake.runtime, fake.agent, fake.validate]) mock.mockReset()
  fake.native = true; rejectPoll = undefined
  fake.listener = undefined
  view = { active: false, saved: { config, bot_id: 42, offset: 0, history: [] } }
  fake.runtime.mockImplementation(async () => structuredClone(view))
  fake.start.mockImplementation(async () => { view.active = true; return 'session' })
  fake.stop.mockImplementation(async () => { view.active = false; rejectPoll?.(new Error('parado')); rejectPoll = undefined })
  fake.poll.mockImplementation(() => new Promise((_resolve, reject) => { rejectPoll = reject }))
  fake.agent.mockResolvedValue({ reply: 'Olá de volta!', conversationId: 'conversation' })
  fake.finish.mockResolvedValue(undefined)
  useTelegramRuntimeStore.setState({ view: null, phase: 'idle', error: '' })
})
afterEach(async () => {
  await useTelegramRuntimeStore.getState().stop()
  await vi.waitFor(() => expect(['idle', 'error']).toContain(useTelegramRuntimeStore.getState().phase))
})
it('initializes locally stopped without automatically starting or sending', async () => {
  await useTelegramRuntimeStore.getState().initialize()
  expect(fake.stop).toHaveBeenCalled()
  expect(fake.start).not.toHaveBeenCalled()
  expect(fake.send).not.toHaveBeenCalled()
})
it('generates a review draft and never invokes send on its own', async () => {
  fake.poll.mockResolvedValueOnce(message)
  await useTelegramRuntimeStore.getState().start(config, agent)
  await vi.waitFor(() => expect(fake.finish).toHaveBeenCalledWith('session', 'claim', 'Olá de volta!', 'conversation'))
  expect(fake.send).not.toHaveBeenCalled()
  expect(fake.agent.mock.calls[0][1]).toEqual(agent)
  await useTelegramRuntimeStore.getState().send('claim')
  expect(fake.send).toHaveBeenCalledWith('session', 'claim')
})
it('Stop reaches the model and a late result cannot become a reply', async () => {
  let complete!: (result: unknown) => void
  fake.agent.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  fake.poll.mockResolvedValueOnce(message)
  await useTelegramRuntimeStore.getState().start(config, agent)
  await vi.waitFor(() => expect(fake.agent).toHaveBeenCalledOnce())
  const controller = fake.agent.mock.calls[0][4] as AbortController
  await useTelegramRuntimeStore.getState().stop()
  expect(controller.signal.aborted).toBe(true)
  complete({ reply: 'late reply', conversationId: 'conversation' })
  await vi.waitFor(() => expect(useTelegramRuntimeStore.getState().phase).toBe('idle'))
  expect(fake.finish).not.toHaveBeenCalled()
  expect(fake.send).not.toHaveBeenCalled()
})
it('pauses after generation failure and does not retry the message', async () => {
  fake.poll.mockResolvedValueOnce(message)
  fake.agent.mockRejectedValue(new Error('model failed'))
  await useTelegramRuntimeStore.getState().start(config, agent)
  await vi.waitFor(() => expect(useTelegramRuntimeStore.getState().phase).toBe('error'))
  expect(fake.finish).toHaveBeenCalledWith('session', 'claim', null, null)
  expect(fake.poll).toHaveBeenCalledOnce()
  expect(fake.send).not.toHaveBeenCalled()
})
it('stops if the bound agent is removed or its instructions are changed', async () => {
  await useTelegramRuntimeStore.getState().start(config, agent)
  expect(fake.listener).toBeDefined()
  fake.listener!({ profiles: [] })
  await vi.waitFor(() => expect(useTelegramRuntimeStore.getState().phase).toBe('error'))
  expect(useTelegramRuntimeStore.getState().error).toContain('alterado ou removido')
  expect(fake.stop).toHaveBeenCalled()
  expect(fake.agent).not.toHaveBeenCalled()
})
it('shows a known native send refusal instead of hiding the service-window explanation', async () => {
  await useTelegramRuntimeStore.getState().start(config, agent)
  fake.send.mockRejectedValue('A janela de atendimento de 24 horas terminou.')
  await useTelegramRuntimeStore.getState().send('claim')
  expect(useTelegramRuntimeStore.getState().error).toContain('24 horas terminou')
})
