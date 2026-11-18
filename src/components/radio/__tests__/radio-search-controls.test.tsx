// @vitest-environment jsdom
import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const search = vi.hoisted(() => vi.fn())
vi.mock('../../../lib/radio-search', () => ({ searchOnlineRadios: search }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => (value: string) => value }))
vi.mock('../RadioSpectrum', () => ({ RadioSpectrum: () => null }))
vi.mock('../../../stores/radioStore', () => ({
  RADIO_STATIONS: [{ id: 'local', name: 'Saved radio', url: 'https://saved.example/live' }],
  useRadioStore: () => ({ custom: [], selected: 'local', status: 'stopped', volume: 0.5,
    muted: false, requested: false, toggle: vi.fn(), select: vi.fn(), add: vi.fn(), remove: vi.fn(), setVolume: vi.fn() }),
}))
import { RadioControls } from '../RadioControls'

type Station = { name: string; url: string }
function deferred() {
  let resolve!: (rows: Station[]) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<Station[]>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function open() {
  render(<StrictMode><RadioControls /></StrictMode>)
  fireEvent.click(screen.getByRole('button', { name: 'Webradio' }))
  return screen.getByRole('textbox', { name: 'Find a station' })
}
async function advance(ms = 400) { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => { vi.useFakeTimers(); search.mockReset(); search.mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('automatic online radio search', () => {
  it('debounces once and actually searches in StrictMode', async () => {
    const input = open()
    fireEvent.change(input, { target: { value: 'Ja' } })
    await advance(200)
    fireEvent.change(input, { target: { value: 'Jazz' } })
    await advance(399)
    expect(search).not.toHaveBeenCalled()
    await advance(1)
    expect(search).toHaveBeenCalledExactlyOnceWith('Jazz')
    expect(screen.getByText('Nenhuma rádio encontrada')).toBeTruthy()
  })

  it('displays a failure separately from an empty successful result', async () => {
    search.mockRejectedValue(new Error('offline'))
    fireEvent.change(open(), { target: { value: 'Jazz' } })
    await advance()
    expect(screen.getByText('Não foi possível pesquisar rádios online. Tente novamente.')).toBeTruthy()
    expect(screen.queryByText('Nenhuma rádio encontrada')).toBeNull()
  })

  it('ignores an older response while the new request remains pending', async () => {
    const older = deferred(), newer = deferred()
    search.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    const input = open()
    fireEvent.change(input, { target: { value: 'Jazz' } }); await advance()
    fireEvent.change(input, { target: { value: 'Rock' } }); await advance()
    await act(async () => older.resolve([{ name: 'Old result', url: 'https://old.example/live' }]))
    expect(screen.queryByText('Old result')).toBeNull()
    expect(screen.getByText('Buscando…')).toBeTruthy()
    await act(async () => newer.resolve([{ name: 'New result', url: 'https://new.example/live' }]))
    expect(screen.getByText('New result')).toBeTruthy()
    expect(screen.queryByText('Buscando…')).toBeNull()
  })

  it('clears loading and ignores failures after clearing the query', async () => {
    const pending = deferred()
    search.mockReturnValue(pending.promise)
    fireEvent.change(open(), { target: { value: 'Jazz' } }); await advance()
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(screen.queryByText('Buscando…')).toBeNull()
    await act(async () => pending.reject(new Error('late offline')))
    expect(screen.queryByText('Não foi possível pesquisar rádios online. Tente novamente.')).toBeNull()
    expect(screen.queryByText('Nenhuma rádio encontrada')).toBeNull()
  })

  it('cancels debounce on close and searches again after reopening', async () => {
    const input = open()
    fireEvent.change(input, { target: { value: 'Jazz' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close radio panel' }))
    await advance()
    expect(search).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Webradio' }))
    await advance()
    expect(search).toHaveBeenCalledExactlyOnceWith('Jazz')
  })

  it('cancels the pending debounce on unmount', async () => {
    fireEvent.change(open(), { target: { value: 'Jazz' } })
    cleanup()
    await advance()
    expect(search).not.toHaveBeenCalled()
  })
})
