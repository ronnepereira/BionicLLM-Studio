// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Node 26 exposes an undefined localStorage getter even in this jsdom setup.
vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    get length() { return values.size }, key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, String(value)) },
    removeItem: (key: string) => { values.delete(key) }, clear: () => values.clear(),
  } })
})

import { useAgentProfileStore } from '../agentProfileStore'
import { useChatStore, migratePersistedChat } from '../chatStore'
import { useModelStore } from '../modelStore'
import { useAgentModeStore } from '../agentModeStore'
import { openAgentConversation } from '../../lib/open-agent-conversation'
import { buildChatSystemPrompt } from '../../lib/system-prompt'

beforeEach(() => {
  vi.stubGlobal('navigator', { locks: { request: async (_name: string, work: (lock: object) => unknown) => work({}) } })
  localStorage.clear()
  useAgentProfileStore.setState({ profiles: [] })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ activeModel: '', models: [] })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {} })
})

describe('dedicated agent profiles', () => {
  it('persists validated profiles and ignores malformed or duplicate records', async () => {
    const store = useAgentProfileStore.getState()
    const id = store.add('Revisor', 'Verifique as fontes.', '')
    store.update(id, 'Pesquisador', 'Cite as fontes.', 'openai::my-model')
    await useAgentProfileStore.persist.rehydrate()
    expect(useAgentProfileStore.getState().profiles[0]).toMatchObject({ id, name: 'Pesquisador', model: 'openai::my-model' })
    expect(() => store.add('Bad', 'x'.repeat(16_001), '')).toThrow()
    expect(() => store.add('Bad', 'instruções', 'lu-cloud::model')).toThrow()
    const valid = useAgentProfileStore.getState().profiles[0]
    localStorage.setItem('bionic-agent-profiles-v1', JSON.stringify({ version: 0, state: { profiles: [valid, valid, { id: 'bad', name: null }] } }))
    await useAgentProfileStore.persist.rehydrate()
    expect(useAgentProfileStore.getState().profiles).toEqual([valid])
  })

  it('opens independent real agent chats and freezes instructions independently of profile edits', async () => {
    const store = useAgentProfileStore.getState()
    const id = store.add('Revisor', 'Verifique as fontes.', 'openai::my-model')
    const profile = useAgentProfileStore.getState().profiles[0]
    const first = openAgentConversation(profile)
    const second = openAgentConversation(profile)
    expect(first).not.toBe(second)
    const conversation = useChatStore.getState().conversations.find(c => c.id === first)!
    expect(conversation).toMatchObject({ title: 'Revisor', model: 'openai::my-model', agentProfileId: id, agentInstructions: 'Verifique as fontes.', messages: [] })
    expect(useAgentModeStore.getState().agentModeActive[first]).toBe(true)
    expect(useAgentModeStore.getState().workspaces[first]).toEqual({ kind: 'sandbox' })
    expect(buildChatSystemPrompt(conversation, false)).toContain('Verifique as fontes.')
    store.update(id, 'Outro nome', 'Outra função.', '')
    await store.remove(id)
    expect(useChatStore.getState().conversations.find(c => c.id === first)?.agentInstructions).toBe('Verifique as fontes.')
    const migrated = migratePersistedChat({ conversations: [conversation] }) as { conversations: typeof conversation[] }
    expect(migrated.conversations[0].agentInstructions).toBe('Verifique as fontes.')
  })

  it('does not create a phantom conversation without a model', () => {
    expect(() => openAgentConversation({ id: 'test', name: 'Revisor', instructions: 'Revise.', model: '' })).toThrow('Escolha um modelo')
    expect(useChatStore.getState().conversations).toHaveLength(0)
  })
})
