import { describe, it, expect } from 'vitest'
import { recallConversation } from '../conversation-recall'
import type { Conversation } from '../../types/chat'
import { effectiveSendWindow } from '../send-window'
import { parseModelRowContext } from '../../api/providers/context-probe'

describe('long cloud conversations', () => {
  it('uses the declared million-token capacity instead of an 8K guess or 32K cap', () => {
    const parsed = parseModelRowContext({ id: 'new-model', top_provider: { context_length: 1000000 } })
    expect(parsed.window).toBe(1000000)
    expect(effectiveSendWindow({ providerId: 'openai-custom', modelWindow: parsed.window! })).toBe(800000)
    expect(effectiveSendWindow({ providerId: 'openai-custom', modelWindow: parsed.window!, sendWindowTokens: 32000 })).toBe(32000)
  })
  it('recovers verbatim instructions represented by a summary without changing stored messages', () => {
    const conversation = { messages: [{ id: 'original', role: 'user', content: 'A entrega precisa usar a porta 9443 e preservar os arquivos originais.' }, { id: 'new', role: 'assistant', content: 'Outra etapa concluída.' }], compactions: [{ summary: 'Projeto em andamento' }] } as unknown as Conversation
    const before = JSON.stringify(conversation)
    const result = recallConversation(conversation, 'porta arquivos')
    expect(result).toContain('porta 9443')
    expect(result).toContain('original')
    expect(JSON.stringify(conversation)).toBe(before)
    expect(recallConversation(undefined, 'porta')).not.toContain('9443')
  })
})
