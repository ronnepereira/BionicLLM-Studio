/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), drafts: vi.fn(), verify: vi.fn(), posts: vi.fn(), prepare: vi.fn(), publish: vi.fn(), update: vi.fn(), discard: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-linkedin', () => ({ linkedinAvailable: () => fake.desktop, linkedinStatus: fake.status, linkedinDrafts: fake.drafts, verifyLinkedIn: fake.verify, linkedinPosts: fake.posts, prepareLinkedIn: fake.prepare, publishLinkedIn: fake.publish, updateLinkedIn: fake.update, discardLinkedIn: fake.discard }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { LinkedInConnector } from '../LinkedInConnector'
const configured = { configured: true, enabled: true, publishing: true, read_posts: false, target: { kind: 'member' }, identity: { author: 'urn:li:person:abc', member: 'urn:li:person:abc', name: 'Test Author', expires_at: 2000000000 } }
const draft = { id: 'draft', account: 'urn:li:person:abc', input: { message: '<script>external text</script>' }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => { fake.desktop = true; localStorage.clear(); for (const mock of [fake.status, fake.drafts, fake.verify, fake.posts, fake.prepare, fake.publish, fake.update, fake.discard]) mock.mockReset(); fake.status.mockResolvedValue({ configured: false, enabled: false, publishing: false, read_posts: false, target: { kind: 'member' }, identity: null }); fake.drafts.mockResolvedValue([]) })
afterEach(cleanup)
function open() { const result = render(<LinkedInConnector />); result.getByTestId('linkedin-connector').setAttribute('open', ''); return result }
it('keeps preview credentials and native actions disabled without creating fake accounts', () => {
  fake.desktop = false; open()
  expect((screen.getByLabelText('LinkedIn user access token') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.drafts).not.toHaveBeenCalled()
})
it('clears secrets before verifying and preserves old status on failed replacement', async () => {
  fake.status.mockResolvedValue(configured); fake.verify.mockRejectedValue(new Error('Token recusado'))
  open(); await screen.findByText(/Test Author/)
  for (const [label, value] of [['LinkedIn client ID', '987654'], ['LinkedIn client secret', 'secret'], ['LinkedIn user access token', 'token']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByText('Verify and save'))
  expect((screen.getByLabelText('LinkedIn user access token') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('LinkedIn client secret') as HTMLInputElement).value).toBe('')
  await screen.findByText('Token recusado'); expect(screen.getByText(/Test Author/)).toBeTruthy()
  expect(localStorage.length).toBe(0); expect(fake.update).not.toHaveBeenCalled()
})
it('requires review of the full inert text before publication', async () => {
  fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([draft]); fake.publish.mockResolvedValue([{ ...draft, phase: 'done', remote_id: '123456_999' }])
  open(); await screen.findByText('Review action')
  expect(fake.verify).not.toHaveBeenCalled(); expect(fake.posts).not.toHaveBeenCalled(); expect(fake.publish).not.toHaveBeenCalled()
  expect(screen.queryByText('Confirm LinkedIn publication')).toBeNull()
  fireEvent.click(screen.getByText('Review action')); expect(screen.getByText('<script>external text</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('Confirm LinkedIn publication'))
  await waitFor(() => expect(fake.publish).toHaveBeenCalledWith('draft', expect.any(AbortSignal)))
})
it('blocks uncertain records and changed authors', async () => {
  fake.status.mockResolvedValue({ ...configured, identity: { ...configured.identity, author: 'other' } }); fake.drafts.mockResolvedValue([draft])
  const view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([{ ...draft, phase: 'uncertain' }]); open()
  await screen.findByText(/Uncertain result/); expect(screen.queryByText('Review action')).toBeNull(); expect(fake.publish).not.toHaveBeenCalled()
})

it('keeps post reading separate from publication and requires company ID only for organizations', async () => {
  fake.status.mockResolvedValue(configured); open(); await screen.findByText(/Test Author/)
  expect((screen.getByText('Read permitted LinkedIn posts') as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('Enable post reading only when LinkedIn grants the required permissions') as HTMLInputElement).checked).toBe(false)
  expect(screen.queryByLabelText('LinkedIn company ID')).toBeNull()
  fireEvent.change(screen.getByLabelText('Publishing destination'), { target: { value: 'organization' } })
  fireEvent.change(screen.getByLabelText('LinkedIn company ID'), { target: { value: '456' } })
  for (const [label, value] of [['LinkedIn client ID', 'client'], ['LinkedIn client secret', 'secret'], ['LinkedIn user access token', 'token']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fake.verify.mockResolvedValue(configured); fireEvent.click(screen.getByText('Verify and save'))
  await waitFor(() => expect(fake.verify).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'organization', id: '456' }, read_posts: false, publishing: true }), expect.any(AbortSignal)))
  expect(fake.posts).not.toHaveBeenCalled()
})
