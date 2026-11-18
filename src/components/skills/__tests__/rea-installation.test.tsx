/** @vitest-environment jsdom */
import { createElement } from 'react'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { REA_PLUGIN, type ReaStatus } from '../../../lib/plugins/rea'
import { ReaInstallation } from '../ReaInstallation'

const fake = vi.hoisted(() => ({ desktop: true, phase: 'off', status: vi.fn(), fetch: vi.fn() }))
vi.mock('../../../api/backend', async original => ({ ...await original<typeof import('../../../api/backend')>(), isTauri: () => fake.desktop }))
vi.mock('../../../lib/plugins/rea-runtime', () => ({ useReaRuntime: (select: (state: { phase: string }) => unknown) => select({ phase: fake.phase }) }))
vi.mock('../../../lib/plugins/rea', async original => ({ ...await original<typeof import('../../../lib/plugins/rea')>(), reaStatus: () => fake.status(), reaFetch: () => fake.fetch() }))

const missing: ReaStatus = { version: REA_PLUGIN.version, ready: false, tarball: null, workDir: '/probe/work', path: null, node: 'v26.12.1', nodeOk: true, nodeRange: '^22.23.4 || ^24.22.1 || >=26.12.1' }
const installButton = () => screen.getByRole('button', { name: `Install/update REA ${REA_PLUGIN.version}` })
beforeEach(() => {
  fake.desktop = true; fake.phase = 'off'; fake.status.mockReset(); fake.fetch.mockReset()
  fake.status.mockResolvedValue(missing)
  fake.fetch.mockResolvedValue({ ...missing, ready: true, tarball: '/probe/rea.tgz' })
  useSettingsStore.setState(state => ({ settings: { ...state.settings, language: 'en', reaPluginEnabled: false } }))
})
afterEach(cleanup)

it('checks first and installs only on request, without activating REA', async () => {
  render(createElement(ReaInstallation))
  await waitFor(() => expect(installButton().hasAttribute('disabled')).toBe(false))
  expect(fake.fetch).not.toHaveBeenCalled()
  fireEvent.click(installButton())
  await screen.findByText(`REA ${REA_PLUGIN.version} package installed and verified.`)
  expect(fake.fetch).toHaveBeenCalledTimes(1)
  expect(useSettingsStore.getState().settings.reaPluginEnabled).toBe(false)
  expect(installButton().hasAttribute('disabled')).toBe(true)
})

it('does not claim an old backend installed the new version', async () => {
  fake.status.mockResolvedValue({ ...missing, version: '6.5.0', ready: true })
  render(createElement(ReaInstallation))
  await screen.findByText(/interface and desktop backend have different REA versions/)
  expect(installButton().hasAttribute('disabled')).toBe(true)
  expect(screen.queryByText(`REA ${REA_PLUGIN.version} package installed and verified.`)).toBeNull()
})

it('keeps installation errors visible and permits a manual retry', async () => {
  fake.fetch.mockRejectedValue(new Error('Checksum mismatch'))
  render(createElement(ReaInstallation))
  await waitFor(() => expect(installButton().hasAttribute('disabled')).toBe(false))
  fireEvent.click(installButton())
  expect((await screen.findByRole('alert')).textContent).toBe('Checksum mismatch')
  expect(installButton().hasAttribute('disabled')).toBe(false)
})

it('prevents replacement while REA is enabled', async () => {
  useSettingsStore.setState(state => ({ settings: { ...state.settings, reaPluginEnabled: true } }))
  render(createElement(ReaInstallation))
  await screen.findByText(/package is missing or needs repair/)
  expect(installButton().hasAttribute('disabled')).toBe(true)
})

it('does not call native commands from the web preview', () => {
  fake.desktop = false
  render(createElement(ReaInstallation))
  expect(installButton().hasAttribute('disabled')).toBe(true)
  expect(fake.status).not.toHaveBeenCalled()
  expect(fake.fetch).not.toHaveBeenCalled()
})
