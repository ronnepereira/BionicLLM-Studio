import type { Conversation } from '../types/chat'

/** Exact original messages remain available after compaction. Scope is always
 * the requesting conversation; never search another person's/project's chat. */
export function recallConversation(conversation: Conversation | undefined, query: string, limit = 6): string {
  if (!conversation) return 'A conversa não está disponível.'
  const words = query.toLocaleLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 12)
  if (!words.length) return 'Informe palavras ou uma frase para procurar no histórico original.'
  return conversation.messages.map((message, index) => {
    const lower = message.content.toLocaleLowerCase()
    const score = words.reduce((sum, word) => sum + (lower.includes(word) ? 1 : 0), 0)
    const start = Math.max(0, lower.indexOf(words.find(word => lower.includes(word)) || words[0]) - 240)
    return { message, index, score, start }
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, Math.max(1, Math.min(10, limit)))
    .map(({ message, index, start }) => `[${index + 1} · ${message.role} · ${message.id}]\n${message.content.slice(start, start + 1800)}`)
    .join('\n\n') || 'Nenhuma mensagem encontrada no histórico original.'
}
