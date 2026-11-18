/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), files: vi.fn(), drafts: vi.fn(), verify: vi.fn(), videos: vi.fn(), pick: vi.fn(), prepare: vi.fn(), upload: vi.fn(), uploadStatus: vi.fn(), remove: vi.fn(), discard: vi.fn(), update: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-tiktok', () => ({ tiktokAvailable: () => fake.desktop, tiktokStatus: fake.status, tiktokFiles: fake.files, tiktokDrafts: fake.drafts, verifyTikTok: fake.verify, tiktokVideos: fake.videos, pickTikTokFile: fake.pick, prepareTikTok: fake.prepare, uploadTikTok: fake.upload, tiktokUploadStatus: fake.uploadStatus, removeTikTokFile: fake.remove, discardTikTok: fake.discard, updateTikTok: fake.update }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { TikTokConnector } from '../TikTokConnector'
const configured = { configured: true, enabled: true, uploading: true, read_videos: false, identity: { open_id: 'account', display_name: 'Test account' } }
const file = { id: 'file', name: 'Selected.mp4', size: 1234, sha256: 'a'.repeat(64), mime: 'video/mp4' }
const draft = { id: 'draft', account: 'account', input: { metadata: { file_id: 'file', note: '<script>local notes</script>' }, file }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => { fake.desktop = true; localStorage.clear(); for (const fn of [fake.status, fake.files, fake.drafts, fake.verify, fake.videos, fake.pick, fake.prepare, fake.upload, fake.uploadStatus, fake.remove, fake.discard, fake.update]) fn.mockReset(); fake.status.mockResolvedValue(configured); fake.files.mockResolvedValue([file]); fake.drafts.mockResolvedValue([]) })
afterEach(cleanup)
function open() { const view = render(<TikTokConnector />); view.getByTestId('tiktok-connector').setAttribute('open', ''); return view }
it('keeps preview credentials, native picker and uploads disabled without fake accounts', () => {
  fake.desktop = false; open()
  for (const label of ['TikTok client key', 'TikTok client secret', 'TikTok refresh token']) expect((screen.getByLabelText(label) as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByText('Select local video') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.files).not.toHaveBeenCalled(); expect(screen.queryByText(/Test account/)).toBeNull()
})
it('clears credentials before verification and preserves previous connection on a refused replacement', async () => {
  fake.verify.mockRejectedValue(new Error('Permissão recusada')); open(); await screen.findByText(/Test account/)
  for (const [label, value] of [['TikTok client key', 'client'], ['TikTok client secret', 'secret'], ['TikTok refresh token', 'refresh']]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  fireEvent.click(screen.getByText('Verify and save'))
  expect((screen.getByLabelText('TikTok refresh token') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('TikTok client secret') as HTMLInputElement).value).toBe('')
  await screen.findByText('Permissão recusada'); expect(screen.getByText(/Test account/)).toBeTruthy(); expect(fake.update).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
})
it('requires review and explains inbox completion before sending only the selected draft ID', async () => {
  fake.drafts.mockResolvedValue([draft]); fake.upload.mockResolvedValue([]); open(); await screen.findByText('Review action')
  expect(fake.upload).not.toHaveBeenCalled(); expect(fake.pick).not.toHaveBeenCalled(); expect(fake.videos).not.toHaveBeenCalled()
  expect(screen.queryByText('Confirm upload to TikTok inbox')).toBeNull()
  fireEvent.click(screen.getByText('Review action'))
  expect(screen.getByText('<script>local notes</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull()
  expect(screen.getByText(/Confirming sends only this video/)).toBeTruthy()
  fireEvent.click(screen.getByText('Confirm upload to TikTok inbox'))
  await waitFor(() => expect(fake.upload).toHaveBeenCalledWith('draft', expect.any(AbortSignal)))
})
it('keeps public-video reading separate from inbox upload permission', async () => {
  open(); await screen.findByText(/Test account/)
  expect((screen.getByText('Read public TikTok videos') as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByLabelText('Enable reading public videos when saving new credentials') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByLabelText('Enable reviewed inbox uploads when saving new credentials') as HTMLInputElement).checked).toBe(true)
  expect(fake.videos).not.toHaveBeenCalled()
})
it('blocks changed accounts, removed snapshots and uncertain transfers without retry buttons', async () => {
  fake.drafts.mockResolvedValue([draft]); fake.status.mockResolvedValue({ ...configured, identity: { ...configured.identity, open_id: 'other' } })
  let view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.status.mockResolvedValue(configured); fake.files.mockResolvedValue([])
  view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.drafts.mockResolvedValue([{ ...draft, phase: 'uncertain' }]); open()
  await screen.findByText(/Uncertain result/); expect(screen.queryByText('Review action')).toBeNull(); expect(fake.upload).not.toHaveBeenCalled()
})
it('distinguishes accepted transfer from inbox delivery and checks status without another upload', async () => {
  fake.drafts.mockResolvedValue([{ ...draft, phase: 'done', remote_id: 'v_inbox_file~v2.123' }]); fake.uploadStatus.mockResolvedValue({ status: 'SEND_TO_USER_INBOX', uploaded_bytes: 1234 })
  open(); await screen.findByText(/Transfer accepted/)
  expect(screen.queryByText('Published by the user through TikTok')).toBeNull()
  fireEvent.click(screen.getByText('Check TikTok upload status'))
  await screen.findByText('Delivered to inbox — open TikTok to finish')
  expect(fake.uploadStatus).toHaveBeenCalledWith('draft', expect.any(AbortSignal)); expect(fake.upload).not.toHaveBeenCalled()
})
