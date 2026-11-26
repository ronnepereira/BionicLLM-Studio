export const CHAT_QUESTION_PROMPT = [
  'When you need a meaningful decision or missing detail from the user before continuing, end your turn and wait.',
  'For one clear question, use only the fenced block below as your final answer. Use the user’s language.',
  'Offer up to four distinct, concise answers if useful, or an empty options array for an open question. The app also offers a free-text field.',
  'Continue the original task when the user replies. Use this format for clarification, never for app permissions or tool approvals.',
  '```studio-question',
  '{"question":"Which output format should I use?","options":["Markdown","PDF"]}',
  '```',
].join('\n')

export interface ChatQuestion {
  question: string
  options: string[]
}

export function parseChatQuestionJson(json: string): ChatQuestion | undefined {
  if (json.length > 4_096) return
  try {
    const value: unknown = JSON.parse(json)
    if (!value || typeof value !== 'object' || !('question' in value) || !('options' in value)) return
    const { question, options } = value
    if (typeof question !== 'string' || !question.trim() || question.length > 500) return
    if (!Array.isArray(options) || options.length > 4) return
    if (options.some(option => typeof option !== 'string' || !option.trim() || option.length > 160)) return
    return { question: question.trim(), options: [...new Set<string>(options.map(option => option.trim()))] }
  } catch {
    return undefined
  }
}

export function parseChatQuestion(text: string): ChatQuestion | undefined {
  const content = text.trim()
  if (content.length > 4_128) return
  const match = /^\x60{3}studio-question[ \t]*\r?\n([\s\S]+?)\r?\n\x60{3}$/.exec(content)
  if (match) return parseChatQuestionJson(match[1])
}

interface QuestionMessage {
  id: string
  role: string
  content: string
  hidden?: boolean
  agentBlocks?: { phase: string; content: string }[]
}

export function pendingChatQuestion(messages: readonly QuestionMessage[] | undefined) {
  const last = messages?.findLast(message => !message.hidden && message.role !== 'system')
  if (last?.role !== 'assistant') return
  const finalAnswer = last.agentBlocks?.findLast(block => block.phase === 'answer' && block.content.trim())
  // The same assistant bubble may contain earlier commentary and tool results.
  // Only a standalone, closed block in the final answer can pause the queue.
  const question = parseChatQuestion(finalAnswer?.content ?? last.content)
  return question ? { ...question, id: last.id } : undefined
}
