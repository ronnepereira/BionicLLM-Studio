/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChatBackground } from '../ChatBackground'
import { useSettingsStore } from '../../../stores/settingsStore'

let reduced = false
let preferenceChanged: () => void
const play = vi.fn(() => Promise.resolve())
const pause = vi.fn()
beforeEach(() => {
  reduced = false
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause)
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced }, addEventListener: (_: string, cb: () => void) => { preferenceChanged = cb }, removeEventListener: vi.fn() }))
  useSettingsStore.getState().updateSettings({ chatBackground: { kind: 'video', source: 'https://example.com/background.webm', name: '', dim: 75, paused: false } })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); play.mockClear(); pause.mockClear() })

it('starts muted and gives the user a persistent pause control', async () => {
  const { container } = render(<ChatBackground />)
  await waitFor(() => expect(play).toHaveBeenCalled())
  expect(container.querySelector('video')?.muted).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Pausar fundo' }))
  expect(useSettingsStore.getState().settings.chatBackground?.paused).toBe(true)
  expect(pause).toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Reproduzir fundo' }))
  expect(useSettingsStore.getState().settings.chatBackground?.paused).toBe(false)
})

it('honors reduced motion before starting and when the preference changes', async () => {
  reduced = true
  render(<ChatBackground />)
  await waitFor(() => expect(pause).toHaveBeenCalled())
  expect(play).not.toHaveBeenCalled()
  expect(screen.getByText(/preferência por movimento reduzido/)).toBeTruthy()
  reduced = false
  const { act } = await import('@testing-library/react')
  act(() => preferenceChanged())
  await waitFor(() => expect(play).toHaveBeenCalled())
})
