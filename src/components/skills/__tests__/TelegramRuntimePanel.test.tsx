/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({
  native: true, start: vi.fn(), stop: vi.fn(), send: vi.fn(), discard: vi.fn(), text: (source: string) => source,
  state: { phase: 'idle', view: null as unknown, error: '' },
}))
const agent = { id: 'profile', name: 'Atendimento', instructions: 'Atenda bem.', model: 'openai::test' }
vi.mock('../../../api/studio-telegram', () => ({ telegramAvailable: () => fake.native }))
vi.mock('../../../stores/telegramRuntimeStore', () => ({ useTelegramRuntimeStore: () => ({ ...fake.state, start: fake.start, stop: fake.stop, send: fake.send, discard: fake.discard }) }))
vi.mock('../../../stores/agentProfileStore', () => ({ useAgentProfileStore: (selector: (state: unknown) => unknown) => selector({ profiles: [agent] }) }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { TelegramRuntimePanel } from '../TelegramRuntimePanel'
afterEach(cleanup)
beforeEach(() => {
  fake.native = true; fake.state = { phase: 'idle', view: null, error: '' }
  for (const mock of [fake.start, fake.stop, fake.send, fake.discard]) mock.mockReset().mockResolvedValue(undefined)
})
it('starts in review mode and only enables automatic sending through an explicit selection', async () => {
  render(<TelegramRuntimePanel configured />)
  const toggle = screen.getByRole('checkbox') as HTMLInputElement
  expect(toggle.checked).toBe(false)
  fireEvent.change(screen.getByLabelText('Assigned agent'), { target: { value: agent.id } })
  fireEvent.change(screen.getByLabelText('Allowed chat IDs'), { target: { value: '123,-100456' } })
  fireEvent.click(screen.getByText('Activate receiver'))
  await waitFor(() => expect(fake.start).toHaveBeenCalledWith({ chats: [123, -100456], agent_id: agent.id, auto_reply: false }, agent))
  fireEvent.click(toggle)
  fireEvent.click(screen.getByText('Activate receiver'))
  await waitFor(() => expect(fake.start).toHaveBeenLastCalledWith({ chats: [123, -100456], agent_id: agent.id, auto_reply: true }, agent))
  expect(fake.send).not.toHaveBeenCalled()
})
it('refuses a wildcard instead of enabling replies to everybody', async () => {
  render(<TelegramRuntimePanel configured />)
  fireEvent.change(screen.getByLabelText('Assigned agent'), { target: { value: agent.id } })
  fireEvent.change(screen.getByLabelText('Allowed chat IDs'), { target: { value: '*' } })
  fireEvent.click(screen.getByText('Activate receiver'))
  await screen.findByRole('alert')
  expect(fake.start).not.toHaveBeenCalled()
})
it('sends a saved draft only on a user click and offers no resend for uncertainty', async () => {
  fake.state.phase = 'listening'
  fake.state.view = { active: true, saved: { config: { agent_id: agent.id, chats: [123], auto_reply: false }, history: [
    { id: 'draft-1', chat_id: 123, text: 'Olá', reply: 'Olá de volta', status: 'draft' },
    { id: 'uncertain-1', chat_id: 123, text: 'Outra mensagem', reply: 'Resposta', status: 'uncertain' },
  ] } }
  render(<TelegramRuntimePanel configured />)
  expect(fake.send).not.toHaveBeenCalled()
  expect(screen.getAllByText('Send reply')).toHaveLength(1)
  fireEvent.click(screen.getByText('Send reply'))
  await waitFor(() => expect(fake.send).toHaveBeenCalledWith('draft-1'))
  fireEvent.click(screen.getByText('Stop receiver'))
  expect(fake.stop).toHaveBeenCalledOnce()
})
