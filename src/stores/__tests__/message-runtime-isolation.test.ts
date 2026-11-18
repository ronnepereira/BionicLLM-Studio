/** @vitest-environment jsdom */
import { expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ run: vi.fn(), validate: vi.fn() }))
vi.mock('../../api/agents/message-agent', () => ({ runMessagingAgent: fake.run, validateMessagingModel: fake.validate }))
vi.mock('../chatStore', () => ({ useChatStore: { persist: { hasHydrated: () => true } } }))
vi.mock('../skillStore', () => ({ useSkillStore: { getState: () => ({ skills: [] }) } }))
vi.mock('../agentProfileStore', () => ({ useAgentProfileStore: { subscribe: () => () => {} } }))
import { createMessageRuntime } from '../createMessageRuntime'
it('keeps receiver ownership and Stop independent between Telegram and WhatsApp', async () => {
  function adapter() {
    let rejectPoll: ((error: Error) => void) | undefined
    const stop = vi.fn(async () => { rejectPoll?.(new Error('stopped')) })
    return { available: () => true, runtime: async () => ({ active: true, saved: { config: { chats: ['chat'], agent_id: 'agent', auto_reply: false }, history: [] } }),
      start: async () => crypto.randomUUID(), stop,
      poll: () => new Promise<null>((_resolve, reject) => { rejectPoll = reject }), finish: vi.fn(), send: vi.fn(), discard: vi.fn() }
  }
  const tgApi = adapter(), waApi = adapter()
  const telegram = createMessageRuntime('Telegram', tgApi), whatsapp = createMessageRuntime('WhatsApp', waApi)
  const agent = { id: 'agent', model: 'openai::test', name: 'Atendimento', instructions: 'Seja breve.' }
  const config = { chats: ['chat'], agent_id: agent.id, auto_reply: false }
  await telegram.getState().start(config, agent)
  await whatsapp.getState().start(config, agent)
  await vi.waitFor(() => expect(whatsapp.getState().phase).toBe('listening'))
  await telegram.getState().stop()
  await vi.waitFor(() => expect(telegram.getState().phase).toBe('idle'))
  expect(whatsapp.getState().phase).toBe('listening')
  expect(waApi.stop).not.toHaveBeenCalled()
  await whatsapp.getState().stop()
  await vi.waitFor(() => expect(whatsapp.getState().phase).toBe('idle'))
  expect(fake.run).not.toHaveBeenCalled()
})
