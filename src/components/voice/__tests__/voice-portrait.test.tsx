// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { VoicePortrait } from '../VoicePortrait'
import { useSettingsStore } from '../../../stores/settingsStore'

vi.mock('../../../api/voice-session', () => ({ voiceLevels: vi.fn(() => ({ mic: 0, bot: 0 })) }))
afterEach(cleanup)
describe('voice portrait', () => {
  it('keeps the spectrum below the head and pauses visuals without a voice control call', () => {
    useSettingsStore.setState(s => ({ settings: { ...s.settings, language: 'pt-BR' } }))
    const view = render(<VoicePortrait mood="speaking" />)
    const head = view.getByTestId('voice-hologram')
    const waves = view.getByTestId('voice-waves')
    expect(head.compareDocumentPosition(waves) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: 'Pausar animação' }))
    expect(view.getByRole('button', { name: 'Retomar animação' })).toBeTruthy()
    expect(head.dataset.mood).toBe('speaking')
  })
})
