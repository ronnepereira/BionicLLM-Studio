import { expect, it } from 'vitest'
import { parseTelegramChats } from '../telegram'
import { messagingPrompt, messagingReply } from '../messaging'
it('accepts explicit private/group IDs and rejects wildcard or unsafe input', () => {
  expect(parseTelegramChats('123, -100456\n123;789')).toEqual([123, -100456, 789])
  for (const input of ['', '*', '0', '1.2', '@user', '123 OR 1', '9999999999999999']) expect(() => parseTelegramChats(input)).toThrow()
})
it('includes chosen agent and active skills without granting computer access', () => {
  const prompt = messagingPrompt('Telegram', { id: 'agent', name: 'Agent', model: 'openai::test', instructions: 'Responda como atendente.' }, [
    { id: 'active', name: 'Atendimento', instructions: 'Use linguagem simples.', enabled: true },
    { id: 'off', name: 'Desativada', instructions: 'Nunca deve aparecer', enabled: false },
  ])
  expect(prompt).toContain('Responda como atendente.')
  expect(prompt).toContain('Use linguagem simples.')
  expect(prompt).toContain('não dispõe de ferramentas')
  expect(prompt).not.toContain('Nunca deve aparecer')
})
it('bounds plain replies without broken surrogate pairs and refuses empty output', () => {
  expect(() => messagingReply(' ')).toThrow()
  const value = messagingReply('😀'.repeat(3000))
  expect(value.length).toBeLessThanOrEqual(3900)
  expect(value).not.toMatch(/[\uD800-\uDBFF]…$/)
  expect(messagingReply(' Olá! ')).toBe('Olá!')
})
