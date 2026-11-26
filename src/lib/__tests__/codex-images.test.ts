import { expect, it } from 'vitest'
import { codexHistoryMessage, codexPromptMessages } from '../codex-history-message'
import { buildRequestMessages } from '../context-decay'
import type { Message } from '../../types/chat'
import type { ChatMessage } from '../../api/providers/types'

it('carries the attached image through Code history restoration and the request budget', () => {
  const image = { name: '1.jpg', data: 'lu-attachment:v1:' + 'a'.repeat(64), mimeType: 'image/jpeg' }
  const stored: Message = { id: 'picture', role: 'user', content: 'Quais são as cores?', timestamp: 1, images: [image] }
  const restored = codexHistoryMessage(stored, '', true)
  const history: ChatMessage[] = [{ role: 'system', content: 'Describe the image.' }, restored]
  const request = buildRequestMessages(history, { budgetTokens: 32000, enabled: true })
  expect(request.messages.at(-1)?.images).toEqual([{ data: image.data, mimeType: image.mimeType }])
  expect(codexPromptMessages(request.messages).at(-1)?.images).toEqual(restored.images)
  expect(stored.images).toEqual([image])
})

it('preserves tool call IDs when restoring a Code turn with images', () => {
  const call = { id: 'read', type: 'function' as const, function: { name: 'file_read', arguments: { path: 'a.ts' } } }
  expect(codexHistoryMessage({ id: 'assistant', role: 'assistant', content: '', timestamp: 1, hidden: true, tool_calls: [call] }, '', false).tool_calls).toEqual([call])
  expect(codexHistoryMessage({ id: 'result', role: 'tool', content: 'text', timestamp: 2, hidden: true, tool_call_id: 'read' }, '', false).tool_call_id).toBe('read')
})
