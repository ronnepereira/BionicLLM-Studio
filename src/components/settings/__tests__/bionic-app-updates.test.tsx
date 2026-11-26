// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fixture = vi.hoisted(() => ({
  publication: { repository: 'test-owner/bionicllm-studio', updatesEnabled: false },
  update: {
    isChecking: false, downloadStatus: 'idle', autoDownload: false, updateAvailable: false,
    latestVersion: '4.0.1', noBuildForPlatform: false, lastCheckFailed: false,
    errorMessage: null, downloadProgress: 0, releaseNotes: null,
    checkForUpdate: vi.fn(), downloadUpdate: vi.fn(), installAndRestart: vi.fn(), setAutoDownload: vi.fn(), openReleasePage: vi.fn(),
  },
}))
vi.mock('../../../../bionic-publication.json', () => ({ default: fixture.publication }))
vi.mock('../../../stores/updateStore', () => ({ useUpdateStore: () => fixture.update }))

import { AppUpdatesSettings } from '../AppUpdatesSettings'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  fixture.publication.updatesEnabled = false
  fixture.update.downloadStatus = 'idle'
  fixture.update.updateAvailable = false
})

describe('BionicLLM app updates', () => {
  it('explains private preparation without offering an inaccessible automatic update', () => {
    render(<AppUpdatesSettings />)
    expect(screen.getByText(/canal está em preparação/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Verificar atualizações' })).toBeNull()
    expect(fixture.update.checkForUpdate).not.toHaveBeenCalled()
  })

  it('checks and downloads only after a user action on the public channel', () => {
    fixture.publication.updatesEnabled = true
    fixture.update.updateAvailable = true
    render(<AppUpdatesSettings />)
    fireEvent.click(screen.getByRole('button', { name: 'Verificar atualizações' }))
    expect(fixture.update.checkForUpdate).toHaveBeenCalledWith(true)
    fireEvent.click(screen.getByRole('button', { name: 'Baixar atualização' }))
    expect(fixture.update.downloadUpdate).toHaveBeenCalledOnce()
    expect(fixture.update.installAndRestart).not.toHaveBeenCalled()
  })

  it('installs a downloaded update only on confirmation', () => {
    fixture.publication.updatesEnabled = true
    fixture.update.downloadStatus = 'downloaded'
    render(<AppUpdatesSettings />)
    expect(fixture.update.installAndRestart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Instalar e reiniciar' }))
    expect(fixture.update.installAndRestart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Agora não' }))
    expect(fixture.update.installAndRestart).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Instalar e reiniciar' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar instalação' }))
    expect(fixture.update.installAndRestart).toHaveBeenCalledOnce()
  })
})
