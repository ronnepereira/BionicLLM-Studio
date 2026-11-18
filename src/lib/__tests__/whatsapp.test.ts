import { expect, it } from 'vitest'
import { parseWhatsappChats, parseMetaChats } from '../whatsapp'
it('normalizes full phone numbers and preserves group IDs without numeric rounding', () => {
  expect(parseWhatsappChats('+5511999999999,5511999999999\n120363123456789012@g.us')).toEqual(['5511999999999@s.whatsapp.net', '120363123456789012@g.us'])
})
it('keeps official Meta contact numbers separate from QR group support', () => {
  expect(parseMetaChats('+5511999999999')).toEqual(['5511999999999@s.whatsapp.net'])
  expect(() => parseMetaChats('120363123456789012@g.us')).toThrow(/sem grupos/)
})
it('refuses wildcard, broadcasts, unrelated addresses and malformed phones', () => {
  for (const value of ['', '*', '123', 'status@broadcast', '123@newsletter', '123456@lid', 'https://example.com', '+55(11)99999-9999']) expect(() => parseWhatsappChats(value)).toThrow()
})
