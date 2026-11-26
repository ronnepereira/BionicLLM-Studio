import type { Message } from '../types/chat'
import type { ChatMessage } from '../api/providers/types'
import { decayRestoredToolResult, isToolResult } from './context-decay'

/** Restore the wire payload, including pictures and the previous tool chain. */
export function codexHistoryMessage(message: Message, reminder: string, decay: boolean): ChatMessage {
  const result: ChatMessage = {
    role: message.role as 'user' | 'assistant' | 'tool',
    content: message.role === 'user' && reminder ? `${reminder}\n${message.content}` : message.content,
    ...(message.images?.length ? { images: message.images.map(({ data, mimeType }) => ({ data, mimeType })) } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
  }
  if (decay && message.hidden && isToolResult(result)) result.content = decayRestoredToolResult(result.content)
  return result
}

/** Prompt tool transports omit native tool metadata, but still carry vision. */
export function codexPromptMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(({ role, content, images }) => ({ role, content, ...(images?.length ? { images } : {}) }))
}
