import { expect, it } from 'vitest'
import { withAssistantIdentity } from '../assistant-identity'
import { buildChatSystemPrompt, withHouseConduct } from '../system-prompt'

it('adds the chosen name and general instructions while keeping task instructions', () => {
  const identity = { assistantName: 'TARS', assistantInstructions: 'O usuário se chama Ronne.' }
  const prompt = buildChatSystemPrompt({ agentInstructions: 'Pesquise as fontes.' }, true, [], identity)
  expect(prompt).toContain('TARS')
  expect(prompt).toContain('O usuário se chama Ronne.')
  expect(prompt).toContain('Pesquise as fontes.')
  expect(withHouseConduct('Coding role', [], identity)).toContain('TARS')
  expect(withAssistantIdentity('Original')).toBe('Original')
})
