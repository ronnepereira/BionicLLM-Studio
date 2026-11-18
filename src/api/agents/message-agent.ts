import { v4 as uuid } from 'uuid'
import { getEnabledProviders, getProviderForModel } from '../providers/registry'
import { useModelStore } from '../../stores/modelStore'
import { useChatStore, flushChatPersist } from '../../stores/chatStore'
import { useGenerationStore } from '../../stores/generationStore'
import { runInLane } from '../../lib/run-slot'
import { laneOf, currentLaneFacts } from '../../lib/run-lane-of-model'
import { settleThinking } from '../../lib/thinking-stripper'
import { messagingReply, type MessageChannel, type MessageDelivery } from '../../lib/messaging'
import type { StudioAgentProfile } from '../../lib/agent-profiles'

export function validateMessagingModel(agent: StudioAgentProfile) {
  const model = useModelStore.getState().models.find(model => model.name === agent.model)
  if (!model || model.provider === 'lu-cloud' || model.type === 'image' || model.type === 'video') throw new Error('Selecione no agente um modelo de texto disponível antes de ativar o receptor.')
  const selected = getProviderForModel(agent.model)
  if (!getEnabledProviders().some(provider => provider.id === selected.provider.id && provider.entryId === selected.provider.entryId)) throw new Error('O provedor do agente está desativado. Confira os provedores nas configurações.')
  return selected
}

/** A plain text turn: no tool registry, MCP, browser, shell or delegation path. */
export async function runMessagingAgent(channel: MessageChannel, agent: StudioAgentProfile, system: string, message: Pick<MessageDelivery<string | number>, 'chat_id' | 'text'>, controller: AbortController): Promise<{ reply: string; conversationId: string }> {
  const { provider, modelId } = validateMessagingModel(agent)
  if (controller.signal.aborted) throw new DOMException('Execução interrompida.', 'AbortError')
  const chat = useChatStore.getState()
  const conversationId = chat.createConversation(agent.model, '', 'lu', { agent: { profileId: agent.id, instructions: agent.instructions }, activate: false })
  chat.renameConversation(conversationId, `${channel} · ${agent.name} · ${message.chat_id}`)
  chat.addMessage(conversationId, { id: uuid(), role: 'user', content: message.text, timestamp: Date.now() })
  await flushChatPersist()
  let reply = ''
  const timeout = new AbortController()
  const timer = window.setTimeout(() => timeout.abort(), 120_000)
  const signal = AbortSignal.any([controller.signal, timeout.signal])
  // Abort must also remove a waiting local run, before it owns a provider stream.
  const cancelLane = () => useGenerationStore.getState().abortConversation(conversationId)
  signal.addEventListener('abort', cancelLane, { once: true })
  try {
    if (signal.aborted) throw new DOMException('Execução interrompida.', 'AbortError')
    const outcome = await runInLane({ conversationId, lane: laneOf(agent.model, currentLaneFacts()), abort: () => controller.abort() }, async () => {
      if (signal.aborted) throw new DOMException('Execução interrompida.', 'AbortError')
      useGenerationStore.getState().setGenerating(conversationId, true)
      try {
      let content = '', complete = false
      for await (const chunk of provider.chatStream(modelId, [
        { role: 'system', content: system }, { role: 'user', content: message.text },
      ], { signal, maxTokens: 900 })) {
        if (signal.aborted) throw new DOMException('Execução interrompida.', 'AbortError')
        if (chunk.toolCalls?.length) throw new Error('O modelo tentou usar ferramentas indisponíveis neste conector.')
        content += chunk.content
        if (content.length > 32_000) throw new Error('A resposta do modelo excedeu o limite permitido.')
        if (chunk.done && !['disconnect', 'length'].includes(chunk.finishReason ?? '')) complete = true
      }
      if (!complete || signal.aborted) throw new Error('A geração foi interrompida antes de uma resposta completa.')
      reply = messagingReply(settleThinking(content, '', false).content)
      } finally { useGenerationStore.getState().setGenerating(conversationId, false) }
    })
    if (outcome !== 'ran' || signal.aborted) throw new DOMException('Execução interrompida.', 'AbortError')
    chat.addMessage(conversationId, { id: uuid(), role: 'assistant', content: reply, timestamp: Date.now() })
    await flushChatPersist()
    return { reply, conversationId }
  } finally { window.clearTimeout(timer); signal.removeEventListener('abort', cancelLane) }
}
