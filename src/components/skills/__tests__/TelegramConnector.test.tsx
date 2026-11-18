/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ available: true, status: vi.fn(), verify: vi.fn(), remove: vi.fn(), text: (text: string) => text }))
vi.mock('../../../api/studio-telegram', () => ({ telegramAvailable: () => fake.available, telegramStatus: () => fake.status(), verifyTelegram: (...args: unknown[]) => fake.verify(...args), disconnectTelegram: () => fake.remove() }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
vi.mock('../TelegramRuntimePanel', () => ({ TelegramRuntimePanel: () => null }))
vi.mock('../../../stores/telegramRuntimeStore', () => ({ useTelegramRuntimeStore: (selector: (state: unknown) => unknown) => selector({ view: null, phase: 'idle' }) }))
import { TelegramConnector } from '../TelegramConnector'
beforeEach(() => {
  fake.available = true; fake.status.mockReset().mockResolvedValue(false)
  fake.verify.mockReset(); fake.remove.mockReset().mockResolvedValue(undefined)
  localStorage.clear()
})
afterEach(cleanup)
it('keeps the browser preview unable to collect credentials or call the backend', () => {
  fake.available = false
  render(<TelegramConnector />)
  expect((screen.getByLabelText('Bot token') as HTMLInputElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled()
  expect(fake.verify).not.toHaveBeenCalled()
})
it('clears tokens immediately, persists no browser secrets and only shows a verified identity after success', async () => {
  let complete!: (value: unknown) => void
  fake.verify.mockImplementation(() => new Promise(resolve => { complete = resolve }))
  render(<TelegramConnector />)
  await screen.findByText('Not configured')
  fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'private-token' } })
  fireEvent.click(screen.getByText('Verify and save'))
  expect((screen.getByLabelText('Bot token') as HTMLInputElement).value).toBe('')
  expect(fake.verify).toHaveBeenCalledWith('private-token')
  expect(localStorage.length).toBe(0)
  await act(async () => { complete({ id: 42, first_name: 'Test', username: 'test_bot' }) })
  expect(screen.getByText('Credential saved')).toBeTruthy()
  expect(screen.getByText('Bot verified: {v0} (@{v1})')).toBeTruthy()
})
it('does not verify saved credentials automatically and removes them without calling Telegram', async () => {
  fake.status.mockResolvedValue(true)
  render(<TelegramConnector />)
  await screen.findByText('Credential saved')
  expect(fake.verify).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Remove local credential'))
  await waitFor(() => expect(fake.remove).toHaveBeenCalledOnce())
  await screen.findByText('Not configured')
  expect(fake.verify).not.toHaveBeenCalled()
})
it('keeps the last saved credential status when replacement validation fails', async () => {
  fake.status.mockResolvedValue(true)
  fake.verify.mockRejectedValue(new Error('Token recusado'))
  render(<TelegramConnector />)
  await screen.findByText('Credential saved')
  fireEvent.change(screen.getByLabelText('Bot token'), { target: { value: 'replacement' } })
  fireEvent.click(screen.getByText('Verify and save'))
  await screen.findByRole('alert')
  expect(screen.getByText('Credential saved')).toBeTruthy()
  expect(fake.remove).not.toHaveBeenCalled()
})
