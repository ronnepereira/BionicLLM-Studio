/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), save: vi.fn(), connect: vi.fn(), update: vi.fn(), read: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-google', () => ({ googleAvailable: () => fake.desktop, googleStatus: fake.status, saveGoogleClient: fake.save, connectGoogle: fake.connect, updateGoogle: fake.update, readGoogle: fake.read }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
vi.mock('../GoogleActions', () => ({ GoogleActions: () => null }))
import { GoogleConnector } from '../GoogleConnector'
const overview = { configured: true, services: [{ service: 'gmail', email: 'test@example.com', enabled: false }, { service: 'drive', email: null, enabled: false }, { service: 'calendar', email: null, enabled: false }] }
beforeEach(() => {
  fake.desktop = true
  for (const mock of [fake.status, fake.save, fake.connect, fake.update, fake.read]) mock.mockReset()
  fake.status.mockResolvedValue({ configured: false, services: [] })
  localStorage.clear()
})
afterEach(cleanup)
function open() { const result = render(<GoogleConnector />); result.getByTestId('google-connector').setAttribute('open', ''); return result }
it('disables preview credential and account actions without calling native services', () => {
  fake.desktop = false; open()
  expect((screen.getByLabelText('Google OAuth client secret') as HTMLInputElement).disabled).toBe(true)
  for (const button of screen.getAllByText('Connect with Google')) expect((button as HTMLButtonElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.connect).not.toHaveBeenCalled()
})
it('clears client inputs before saving without storing browser secrets', async () => {
  let complete!: () => void
  fake.save.mockImplementation(() => new Promise<void>(resolve => { complete = resolve }))
  open()
  fireEvent.change(screen.getByLabelText('Google OAuth client ID'), { target: { value: 'client' } })
  fireEvent.change(screen.getByLabelText('Google OAuth client secret'), { target: { value: 'secret' } })
  fireEvent.click(screen.getByText('Save OAuth client'))
  expect(fake.save).toHaveBeenCalledWith({ client_id: 'client', client_secret: 'secret' })
  expect((screen.getByLabelText('Google OAuth client secret') as HTMLInputElement).value).toBe('')
  expect(localStorage.length).toBe(0)
  await act(async () => complete())
})
it('reads local status only, requires explicit enabling and confirms local removal', async () => {
  fake.status.mockResolvedValue(overview)
  fake.update.mockResolvedValue({ configured: true, services: [] })
  open()
  await screen.findByText('test@example.com')
  expect(fake.connect).not.toHaveBeenCalled(); expect(fake.read).not.toHaveBeenCalled()
  const gmail = within(screen.getByRole('region', { name: 'Gmail' }))
  expect((gmail.getByRole('switch') as HTMLInputElement).checked).toBe(false)
  expect((gmail.getByRole('button', { name: 'Search' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(gmail.getByText('Remove local connection'))
  expect(fake.update).not.toHaveBeenCalled()
  fireEvent.click(gmail.getByText('Confirm removal'))
  await screen.findAllByText('Not connected')
  expect(fake.update).toHaveBeenCalledWith('gmail', null)
})
it('cancels authorization on unmount while folding keeps the pending request alive', async () => {
  fake.status.mockResolvedValue({ configured: true, services: [] })
  let signal!: AbortSignal
  fake.connect.mockImplementation((_service: string, abort: AbortSignal) => { signal = abort; return new Promise(() => {}) })
  const view = open()
  await screen.findByText('OAuth client saved')
  fireEvent.click(screen.getAllByText('Connect with Google')[0])
  view.getByTestId('google-connector').removeAttribute('open')
  expect(signal.aborted).toBe(false)
  view.unmount(); expect(signal.aborted).toBe(true)
})
it('locks the shared OAuth client while only YouTube is connected and refreshes after removal', async () => {
  fake.status.mockResolvedValue({ configured: true, services: [{ service: 'youtube', email: 'test@example.com', enabled: true, write_access: false }] })
  open(); await screen.findByText('OAuth client saved')
  expect((screen.getByLabelText('Google OAuth client ID') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByText('Remove local OAuth client') as HTMLButtonElement).disabled).toBe(true)
  fake.status.mockResolvedValue({ configured: true, services: [] })
  await act(async () => { window.dispatchEvent(new Event('bionic-google-changed')) })
  await waitFor(() => expect((screen.getByLabelText('Google OAuth client ID') as HTMLInputElement).disabled).toBe(false))
})
