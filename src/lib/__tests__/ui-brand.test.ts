import { describe, expect, it } from 'vitest'
import { brandUiCopy, ORIGINAL_APP_CREDIT } from '../ui-brand'
import { localizeUiText } from '../ui-copy'

describe('BU presentation without data migration', () => {
  it('rebrands authored copy in both interface languages', () => {
    expect(brandUiCopy('LU. LU, LU! LU?')).toBe('BU. BU, BU! BU?')
    expect(brandUiCopy('LU uses the LU Engine.')).toBe('BU uses the BU Engine.')
    expect(brandUiCopy('Locally Uncensored')).toBe('BionicLLM Studio')
    expect(localizeUiText('pt-BR', 'LU Engine')).toBe('BU Engine')
    expect(localizeUiText('en', 'LU Engine')).toBe('BU Engine')
  })
  it('keeps the original credit in About, including license and author', () => {
    for (const language of ['pt-BR', 'en'] as const) {
      const credit = localizeUiText(language, ORIGINAL_APP_CREDIT)
      expect(credit).toContain('Locally Uncensored')
      expect(credit).toContain('PurpleDoubleD')
      expect(credit).toContain('AGPL-3.0')
    }
  })
  it('keeps links, email, binary names, protocol identifiers and paths exact', () => {
    for (const text of [
      'https://example.com/LU?q=LU', 'https://github.com/PurpleDoubleD/locally-uncensored',
      'LU@example.com', 'bu-llama-server.exe', 'LU-monogram.svg', 'lu-cloud',
      'C:\\Program Files\\Locally Uncensored\\locally-uncensored.exe',
      '/home/user/Locally Uncensored/models', '`LU`',
    ]) expect(brandUiCopy(text)).toBe(text)
  })
  it('brands the template before interpolating user/model values', () => {
    const value = 'LU custom model in C:\\Locally Uncensored\\LU.gguf'
    expect(localizeUiText('en', 'LU: {v0}', { v0: value })).toBe(`BU: ${value}`)
    expect(localizeUiText('pt-BR', 'Failed to load {v0}', { v0: value })).toContain(value)
    expect(localizeUiText('pt-BR', 'LU Engine, runs locally on {v0}, nothing to configure.', { v0: 'https://example.com/LU' })).toContain('https://example.com/LU')
  })
})
