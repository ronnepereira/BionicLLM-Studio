/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ list: vi.fn(), prepare: vi.fn(), execute: vi.fn(), discard: vi.fn(), text: (v: string) => v }))
vi.mock('../../../api/studio-google', () => ({ googleDrafts: fake.list, prepareGoogle: fake.prepare, executeGoogle: fake.execute, discardGoogle: fake.discard }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { GoogleActions } from '../GoogleActions'
const services = [{ service: 'gmail' as const, email: 'test@example.com', enabled: true, write_access: true }]
const draft = { id: 'draft-id', account: 'test@example.com', input: { action: 'gmail_send', to: 'recipient@example.com', subject: 'Assunto', text: '<script>Texto externo</script>' }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => {
  for (const mock of [fake.list, fake.prepare, fake.execute, fake.discard]) mock.mockReset()
  fake.list.mockResolvedValue([]); fake.prepare.mockResolvedValue(draft); fake.discard.mockResolvedValue([])
})
afterEach(cleanup)
it('does not restore stale pending records after a newer confirmation was loaded', async () => {
  let complete!: (value: unknown) => void
  fake.list.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    .mockResolvedValueOnce([{ ...draft, phase: 'done', remote_id: 'confirmed-id' }])
  render(<GoogleActions desktop services={services} disabled={false} />)
  fireEvent.click(screen.getByText('Refresh drafts'))
  await screen.findByText('Confirmed by Google')
  await act(async () => complete([draft]))
  expect(screen.queryByText('Review action')).toBeNull()
  expect(screen.getByText('Confirmed by Google')).toBeTruthy()
})
it('never collects action content or calls native commands in preview', () => {
  render(<GoogleActions desktop={false} services={[]} disabled={false} />)
  expect((screen.getByLabelText('Recipient e-mail') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.list).not.toHaveBeenCalled(); expect(fake.execute).not.toHaveBeenCalled()
})
it('prepares locally without sending and requires write authorization', async () => {
  const view = render(<GoogleActions desktop services={[{ ...services[0], write_access: false }]} disabled={false} />)
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  view.rerender(<GoogleActions desktop services={services} disabled={false} />)
  fireEvent.change(screen.getByLabelText('Recipient e-mail'), { target: { value: 'recipient@example.com' } })
  fireEvent.change(screen.getByLabelText('E-mail subject'), { target: { value: 'Assunto' } })
  fireEvent.change(screen.getByLabelText('Plain text content'), { target: { value: 'Mensagem' } })
  fireEvent.click(screen.getByText('Prepare local draft'))
  await waitFor(() => expect(fake.prepare).toHaveBeenCalledWith({ action: 'gmail_send', to: 'recipient@example.com', subject: 'Assunto', text: 'Mensagem' }, expect.any(AbortSignal)))
  expect(fake.execute).not.toHaveBeenCalled()
})
it('requires review before explicit execution and renders external text inertly', async () => {
  fake.list.mockResolvedValue([draft]); fake.execute.mockResolvedValue([{ ...draft, phase: 'done', remote_id: 'confirmed-id' }])
  render(<GoogleActions desktop services={services} disabled={false} />)
  await screen.findByText('Assunto', { exact: false })
  expect(screen.queryByText('Confirm e-mail sending')).toBeNull()
  fireEvent.click(screen.getByText('Review action'))
  expect(screen.getByText('<script>Texto externo</script>')).toBeTruthy()
  expect(document.querySelector('script')).toBeNull()
  expect(fake.execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Confirm e-mail sending'))
  await waitFor(() => expect(fake.execute).toHaveBeenCalledWith('draft-id', expect.any(AbortSignal)))
})
it('blocks uncertain records and a changed account, and confirms local removal separately', async () => {
  fake.list.mockResolvedValue([{ ...draft, phase: 'uncertain' }])
  const view = render(<GoogleActions desktop services={services} disabled={false} />)
  await screen.findByText('Uncertain result — check Google before repeating')
  expect(screen.queryByText('Review action')).toBeNull()
  fireEvent.click(screen.getByText('Remove local record')); expect(fake.discard).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Confirm removal'))
  await waitFor(() => expect(fake.discard).toHaveBeenCalledWith('draft-id'))
  fake.list.mockResolvedValue([draft])
  view.rerender(<GoogleActions desktop services={[{ ...services[0], email: 'other@example.com' }]} disabled={false} />)
  fireEvent.click(screen.getByText('Refresh drafts'))
  await screen.findByText('Review action')
  expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.execute).not.toHaveBeenCalled()
})
