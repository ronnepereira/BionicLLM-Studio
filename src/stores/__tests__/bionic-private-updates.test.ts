import { beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ publication: { repository: 'test-owner/bionicllm-studio', updatesEnabled: false }, check: vi.fn() }))
vi.mock('../../../bionic-publication.json', () => ({ default: fixture.publication }))
vi.mock('../../api/backend', () => ({ isTauri: () => true, isLinux: () => false, isMacOS: () => false, backendCall: vi.fn(), openExternal: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: fixture.check }))

import { useUpdateStore } from '../updateStore'

beforeEach(() => {
  fixture.check.mockReset().mockResolvedValue(null)
  fixture.publication.updatesEnabled = false
  useUpdateStore.setState({ isChecking: false, lastChecked: null, updateAvailable: false, latestVersion: null })
})

describe('private preparation channel', () => {
  it('does not contact the updater even for a manual check', async () => {
    await useUpdateStore.getState().checkForUpdate(true)
    await useUpdateStore.getState().downloadUpdate()
    await useUpdateStore.getState().installAndRestart()
    expect(fixture.check).not.toHaveBeenCalled()
    expect(useUpdateStore.getState().isChecking).toBe(false)
  })

  it('uses the plugin after the public channel is enabled', async () => {
    fixture.publication.updatesEnabled = true
    await useUpdateStore.getState().checkForUpdate(true)
    expect(fixture.check).toHaveBeenCalledOnce()
  })
})
