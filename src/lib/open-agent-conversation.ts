import { useChatStore } from '../stores/chatStore'
import { useModelStore } from '../stores/modelStore'
import { useAgentModeStore } from '../stores/agentModeStore'
import { useCodexStore } from '../stores/codexStore'
import { useUIStore } from '../stores/uiStore'
import { agentProfileInput, type StudioAgentProfile } from './agent-profiles'

/** Open a real agent chat. Sending a task uses the existing agent loop/gates. */
export function openAgentConversation(profile: StudioAgentProfile): string {
  const input = agentProfileInput(profile.name, profile.instructions, profile.model)
  const model = input.model || useModelStore.getState().activeModel
  if (!model) throw new Error('Escolha um modelo antes de abrir a conversa do agente.')
  if (model.startsWith('lu-cloud::')) throw new Error('O serviço LU Cloud não está disponível.')
  const models = useModelStore.getState().models
  const found = models.find(entry => entry.name === model)
  if (found && (found.type === 'image' || found.type === 'video')) throw new Error('Escolha um modelo de texto para o agente.')
  useModelStore.getState().setActiveModel(model)
  const chat = useChatStore.getState()
  const id = chat.createConversation(model, '', 'lu', { agent: { profileId: profile.id, instructions: input.instructions } })
  chat.renameConversation(id, input.name)
  useAgentModeStore.getState().setWorkspace(id, { kind: 'sandbox' })
  useAgentModeStore.getState().setAgentModeActive(id, true)
  useCodexStore.getState().setChatMode('lu')
  useUIStore.getState().setView('chat')
  return id
}
