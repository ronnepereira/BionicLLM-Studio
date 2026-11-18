/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), drafts: vi.fn(), verify: vi.fn(), posts: vi.fn(), prepare: vi.fn(), publish: vi.fn(), update: vi.fn(), discard: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-facebook', () => ({ facebookAvailable: () => fake.desktop, facebookStatus: fake.status, facebookDrafts: fake.drafts, verifyFacebook: fake.verify, facebookPosts: fake.posts, prepareFacebook: fake.prepare, publishFacebook: fake.publish, updateFacebook: fake.update, discardFacebook: fake.discard }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { FacebookConnector } from '../FacebookConnector'
const configured = { configured: true, enabled: true, publishing: true, identity: { id: '123456', name: 'Test Page', expires_at: null } }
const draft = { id: 'draft', account: '123456', input: { message: '<script>external text</script>' }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => { fake.desktop = true; localStorage.clear(); for (const mock of [fake.status, fake.drafts, fake.verify, fake.posts, fake.prepare, fake.publish, fake.update, fake.discard]) mock.mockReset(); fake.status.mockResolvedValue({ configured: false, enabled: false, publishing: false, identity: null }); fake.drafts.mockResolvedValue([]) })
afterEach(cleanup)
function open() { const result = render(<FacebookConnector />); result.getByTestId('facebook-connector').setAttribute('open', ''); return result }
it('keeps preview credentials and native actions disabled without creating fake accounts', () => {
  fake.desktop = false; open()
  expect((screen.getByLabelText('Page access token') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.drafts).not.toHaveBeenCalled()
})
it('clears secrets before verifying and preserves old status on failed replacement', async () => {
  fake.status.mockResolvedValue(configured); fake.verify.mockRejectedValue(new Error('Token recusado'))
  open(); await screen.findByText(/Test Page/)
  for (const [label, value] of [['Facebook Page ID', '123456'], ['Meta app ID', '987654'], ['Meta app secret', 'secret'], ['Page access token', 'token']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByText('Verify and save'))
  expect((screen.getByLabelText('Page access token') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Meta app secret') as HTMLInputElement).value).toBe('')
  await screen.findByText('Token recusado'); expect(screen.getByText(/Test Page/)).toBeTruthy()
  expect(localStorage.length).toBe(0); expect(fake.update).not.toHaveBeenCalled()
})
it('requires review of the full inert text before publication', async () => {
  fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([draft]); fake.publish.mockResolvedValue([{ ...draft, phase: 'done', remote_id: '123456_999' }])
  open(); await screen.findByText('Review action')
  expect(fake.verify).not.toHaveBeenCalled(); expect(fake.posts).not.toHaveBeenCalled(); expect(fake.publish).not.toHaveBeenCalled()
  expect(screen.queryByText('Confirm Page publication')).toBeNull()
  fireEvent.click(screen.getByText('Review action')); expect(screen.getByText('<script>external text</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('Confirm Page publication'))
  await waitFor(() => expect(fake.publish).toHaveBeenCalledWith('draft', expect.any(AbortSignal)))
})
it('blocks uncertain records and changed Page targets', async () => {
  fake.status.mockResolvedValue({ ...configured, identity: { ...configured.identity, id: 'other' } }); fake.drafts.mockResolvedValue([draft])
  const view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([{ ...draft, phase: 'uncertain' }]); open()
  await screen.findByText(/Uncertain result/); expect(screen.queryByText('Review action')).toBeNull(); expect(fake.publish).not.toHaveBeenCalled()
})
