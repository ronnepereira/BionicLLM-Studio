// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EngineSourceSettings } from '../EngineSourceSettings'
import { useSettingsStore } from '../../../stores/settingsStore'
import { backendCall } from '../../../api/backend'
vi.mock('../../../api/backend', () => ({ backendCall: vi.fn() }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('downloads CUDA with the selected release and requires explicit activation', async () => {
  useSettingsStore.getState().updateSettings({ language: 'pt-BR' })
  vi.mocked(backendCall).mockImplementation(async (command) => {
    if (command === 'engine_source_status') return { active: null, bundledTag: 'b9949', bundledCommit: 'abc' }
    if (command === 'engine_package_catalog') return { tag: 'b12470', options: [{ backend: 'cuda-13.5', label: 'CUDA 13.5', bytes: 630000000 }, { backend: 'vulkan', label: 'VULKAN', bytes: 40000000 }] }
    if (command === 'engine_package_download') return { tag: 'b12470', backend: 'cuda-13.5', commit: 'def', directory: 'staged' }
    return null
  })
  render(<EngineSourceSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Verificar versão mais recente' }))
  await waitFor(() => expect(screen.getByRole('option', { name: /CUDA 13.5/ })).toBeTruthy())
  fireEvent.change(screen.getByRole('combobox', { name: 'Aceleração' }), { target: { value: 'cuda-13.5' } })
  fireEvent.click(screen.getByRole('button', { name: 'Baixar pacote oficial' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Ativar b12470 · CUDA-13.5' })).toBeTruthy())
  expect(backendCall).toHaveBeenCalledWith('engine_package_download', { tag: 'b12470', backend: 'cuda-13.5' })
  expect(vi.mocked(backendCall).mock.calls.some(([command]) => command === 'engine_source_build' || command === 'engine_source_activate')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Ativar b12470 · CUDA-13.5' }))
  await waitFor(() => expect(backendCall).toHaveBeenCalledWith('engine_source_activate', { rollback: false }))
})
it('does not offer a stale package after the tag changes', async () => {
  useSettingsStore.getState().updateSettings({ language: 'en' })
  vi.mocked(backendCall).mockImplementation(async command => command === 'engine_source_status' ? { active: null } : { tag: 'b123', options: [{ backend: 'cpu', label: 'CPU', bytes: 100 }] })
  render(<EngineSourceSettings />)
  fireEvent.click(screen.getByRole('button', { name: 'Check latest version' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Download official package' })).toBeTruthy())
  fireEvent.change(screen.getByRole('textbox', { name: 'Official source tag' }), { target: { value: 'b999' } })
  expect(screen.queryByRole('button', { name: 'Download official package' })).toBeNull()
})
