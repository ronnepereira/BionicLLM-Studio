/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), drafts: vi.fn(), verify: vi.fn(), media: vi.fn(), prepare: vi.fn(), publish: vi.fn(), update: vi.fn(), discard: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-instagram', () => ({ instagramAvailable: () => fake.desktop, instagramStatus: fake.status, instagramDrafts: fake.drafts, verifyInstagram: fake.verify, instagramMedia: fake.media, prepareInstagram: fake.prepare, publishInstagram: fake.publish, updateInstagram: fake.update, discardInstagram: fake.discard }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { InstagramConnector } from '../InstagramConnector'
const configured = { configured: true, enabled: true, publishing: true, identity: { id: '1789000', page_id: '123456', username: 'test_account', expires_at: null } }
const draft = { id: 'draft', account: '1789000', input: { kind: 'reel', url: 'https://example.com/video.mp4', caption: '<script>data</script>', share_to_feed: false }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => { fake.desktop = true; localStorage.clear(); for (const mock of [fake.status, fake.drafts, fake.verify, fake.media, fake.prepare, fake.publish, fake.update, fake.discard]) mock.mockReset(); fake.status.mockResolvedValue({ configured: false, enabled: false, publishing: false, identity: null }); fake.drafts.mockResolvedValue([]) })
afterEach(cleanup)
function open() { const result = render(<InstagramConnector />); result.getByTestId('instagram-connector').setAttribute('open', ''); return result }
it('does not collect preview credentials or fetch media on startup', () => {
  fake.desktop = false; open()
  expect((screen.getByLabelText('Page access token') as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText('Public HTTPS media URL') as HTMLInputElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.media).not.toHaveBeenCalled()
})
it('clears secrets immediately and preserves saved identity when replacement fails', async () => {
  fake.status.mockResolvedValue(configured); fake.verify.mockRejectedValue(new Error('Permissão recusada'))
  open(); await screen.findByText(/test_account/)
  for (const [label, value] of [['Instagram professional account ID', '1789000'], ['Facebook Page ID', '123456'], ['Meta app ID', '987654'], ['Meta app secret', 'secret'], ['Page access token', 'token']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByText('Verify and save'))
  expect((screen.getByLabelText('Page access token') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Meta app secret') as HTMLInputElement).value).toBe('')
  await screen.findByText('Permissão recusada'); expect(screen.getByText(/test_account/)).toBeTruthy(); expect(localStorage.length).toBe(0)
})
it('prepares a Reel with explicit feed choice without starting processing or publication', async () => {
  fake.status.mockResolvedValue(configured); fake.prepare.mockResolvedValue(draft)
  open(); await screen.findByText(/test_account/)
  fireEvent.change(screen.getByRole('combobox', { name: 'Media format' }), { target: { value: 'reel' } })
  fireEvent.change(screen.getByLabelText('Public HTTPS media URL'), { target: { value: 'https://example.com/video.mp4' } })
  fireEvent.click(screen.getByLabelText('Also share this Reel to the feed'))
  fireEvent.click(screen.getByText('Prepare local draft'))
  await waitFor(() => expect(fake.prepare).toHaveBeenCalledWith({ kind: 'reel', url: 'https://example.com/video.mp4', caption: '', share_to_feed: false }, expect.any(AbortSignal)))
  expect(fake.publish).not.toHaveBeenCalled(); expect(fake.media).not.toHaveBeenCalled()
})
it('requires review of account, caption, URL and format before publishing', async () => {
  fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([draft]); fake.publish.mockResolvedValue([{ ...draft, phase: 'done', remote_id: '123456789' }])
  open(); await screen.findByText('Review action'); expect(screen.queryByText('Confirm Instagram publication')).toBeNull()
  fireEvent.click(screen.getByText('Review action'))
  expect(screen.getByText('<script>data</script>', { exact: false })).toBeTruthy(); expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('img')).toBeNull()
  expect(screen.getByText('https://example.com/video.mp4')).toBeTruthy(); expect(fake.publish).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Confirm Instagram publication'))
  await waitFor(() => expect(fake.publish).toHaveBeenCalledWith('draft', expect.any(AbortSignal)))
})
it('keeps interrupted processing and old account targets unable to publish again', async () => {
  fake.status.mockResolvedValue(configured); fake.drafts.mockResolvedValue([{ ...draft, phase: 'uncertain', remote_id: 'container-id' }])
  const view = open(); await screen.findByText(/Processing or publication unconfirmed/); expect(screen.queryByText('Review action')).toBeNull()
  expect(screen.getByText(/Processing ID/)).toBeTruthy()
  view.unmount(); fake.status.mockResolvedValue({ ...configured, identity: { ...configured.identity, id: 'other' } }); fake.drafts.mockResolvedValue([draft]); open()
  await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true); expect(fake.publish).not.toHaveBeenCalled()
})
