// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { BackendSelector } from '../BackendSelector'
import { useProviderStore } from '../../../stores/providerStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { addDetectedSideBySide } from '../../../lib/detected-backends-side-by-side'

const builtin = { id: 'builtin', name: 'LU Engine', baseUrl: 'http://127.0.0.1:8127/v1', port: 8127 }
const originalProviders = structuredClone(useProviderStore.getState().providers)

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ language: 'en' })
  useProviderStore.setState({
    providers: { ...structuredClone(originalProviders), openai: { ...originalProviders.openai, managed: false } },
    engineOptedOut: true, openaiEntries: [],
  })
})
afterEach(cleanup)

it('a stale builtin choice restores managed lifecycle instead of treating it as an external endpoint', () => {
  render(<BackendSelector open backends={[builtin]} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Use selected' }))
  expect(useProviderStore.getState().providers.openai.managed).toBe(true)
  expect(useProviderStore.getState().engineOptedOut).toBe(false)
})

it('adding detected servers never creates an unmanaged copy of the native engine', () => {
  expect(addDetectedSideBySide([builtin])).toBe(0)
  expect(useProviderStore.getState().openaiEntries).toEqual([])
})
