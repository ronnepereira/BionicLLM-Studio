/** @vitest-environment jsdom */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { cloudFetch } from '../client'
import { getPublicCatalog } from '../public-catalog'
import { getAppStatus } from '../app-status'
import { getLaunchSeats } from '../launch'
import { withMemorySyncSession } from '../memory-sync'
import { getAccessToken, loginWithProvider, requestPasswordReset, savedSessionUser } from '../supabase'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useProviderStore } from '../../../stores/providerStore'
import { getProvider } from '../../providers/registry'
import { pickForMode } from '../../../lib/active-model-mode'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { findEntry } from '../../../lib/settings-catalog'

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('BionicLLM without the original paid service', () => {
  it('does not send cloud, login, catalog, launch or memory requests', async () => {
    const fetch = vi.fn(() => { throw new Error('No network operation was expected') })
    vi.stubGlobal('fetch', fetch)
    await expect(cloudFetch('/api/jobs', { method: 'POST', body: 'private input' })).rejects.toMatchObject({ status: 410, code: 'service_removed' })
    await expect(getAccessToken()).rejects.toMatchObject({ code: 'service_removed' })
    await expect(loginWithProvider('google')).rejects.toMatchObject({ code: 'service_removed' })
    await expect(requestPasswordReset('user@example.test')).rejects.toMatchObject({ code: 'service_removed' })
    await expect(getLaunchSeats()).rejects.toMatchObject({ code: 'service_removed' })
    const sync = vi.fn()
    await expect(withMemorySyncSession('old-owner', sync)).rejects.toThrow('LU Cloud')
    expect(sync).not.toHaveBeenCalled()
    expect(await getPublicCatalog()).toBeNull()
    expect(await getAppStatus()).toBeNull()
    expect(await savedSessionUser()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('migrates an old LU mode without changing independent settings or chats', async () => {
    localStorage.setItem('chat-settings', JSON.stringify({ version: 23, state: { settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cloudTeasersEnabled: true, topK: 17, hfToken: 'preserve-test-token' }, personas: [], activePersonaId: '', _version: 23 } }))
    localStorage.setItem('chat-conversations', 'keep-this-data')
    await useSettingsStore.persist.rehydrate()
    expect(useSettingsStore.getState().settings).toMatchObject({ appMode: 'local', cloudTeasersEnabled: false, topK: 17, hfToken: 'preserve-test-token' })
    expect(localStorage.getItem('chat-conversations')).toBe('keep-this-data')
    expect(findEntry('appMode')).toBeUndefined()
    expect(findEntry('cloudTeasersEnabled')).toBeUndefined()
    expect(findEntry('codexArchitectAllowCloud')).toBeDefined()
    useSettingsStore.getState().updateSettings({ appMode: 'cloud', cloudTeasersEnabled: true, temperature: 0.8 })
    expect(useSettingsStore.getState().settings).toMatchObject({ appMode: 'local', cloudTeasersEnabled: false, temperature: 0.8 })
  })
  it('keeps OpenAI-compatible endpoints and Anthropic enabled while retiring only lu-cloud', async () => {
    const original = useProviderStore.getState().providers
    localStorage.setItem('lu-providers', JSON.stringify({ version: 1, state: { providers: {
      ...original,
      'lu-cloud': { ...original['lu-cloud'], enabled: true },
      anthropic: { ...original.anthropic, enabled: true, baseUrl: 'https://api.anthropic.com' },
      openai: { ...original.openai, enabled: true, managed: false, name: 'My endpoint', baseUrl: 'https://example.test/v1', isLocal: false },
    }, openaiEntries: [], engineOptedOut: false } }))
    await useProviderStore.persist.rehydrate()
    const state = useProviderStore.getState()
    expect(state.providers['lu-cloud'].enabled).toBe(false)
    expect(state.providers.openai).toMatchObject({ enabled: true, baseUrl: 'https://example.test/v1', isLocal: false, name: 'My endpoint' })
    expect(state.getEnabledProviders().map(p => p.id)).toContain('anthropic')
    state.setProviderConfig('lu-cloud', { enabled: true })
    expect(useProviderStore.getState().getEnabledProviders().some(p => p.id === 'lu-cloud')).toBe(false)
    expect(() => getProvider('lu-cloud')).toThrow('LU Cloud')
    expect(getProvider('openai').id).toBe('openai')
    const model = { name: 'openai::my-model', provider: 'openai', type: 'text', parameterSize: '8B' }
    expect(pickForMode(model.name, [model], 'local').next).toBe(model.name)
  })
})
