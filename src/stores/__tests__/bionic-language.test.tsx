/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSettingsStore } from '../settingsStore'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { LanguageSetting } from '../../components/settings/LanguageSetting'
import { translate } from '../../lib/i18n'

beforeEach(() => {
  localStorage.clear()
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS } })
})
afterEach(cleanup)

describe('BionicLLM language preference', () => {
  it.each([undefined, 'invalid', 'pt-BR', 'en'])('loads a profile with language %s without changing its model preferences', async (language) => {
    localStorage.setItem('chat-settings', JSON.stringify({
      version: 23,
      state: { settings: { ...DEFAULT_SETTINGS, language, topK: 17 }, personas: [], activePersonaId: '', _version: 23 },
    }))
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.language).toBe(language === 'en' ? 'en' : 'pt-BR')
    expect(useSettingsStore.getState().settings.topK).toBe(17)
  })

  it('switches in the settings control, persists, and survives restart', async () => {
    render(<LanguageSetting />)
    fireEvent.change(screen.getByLabelText('Idioma'), { target: { value: 'en' } })
    expect(screen.getByLabelText('Language')).toBeTruthy()
    expect(translate(useSettingsStore.getState().settings.language, 'settings')).toBe('Settings')
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings.language).toBe('en')
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'pt-BR' } })
    expect(translate(useSettingsStore.getState().settings.language, 'settings')).toBe('Configurações')
  })
})
