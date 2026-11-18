/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const fake = vi.hoisted(() => ({ desktop: true, status: vi.fn(), files: vi.fn(), drafts: vi.fn(), videos: vi.fn(), pick: vi.fn(), prepare: vi.fn(), upload: vi.fn(), remove: vi.fn(), discard: vi.fn(), connect: vi.fn(), update: vi.fn(), text: (source: string) => source }))
vi.mock('../../../api/studio-youtube', () => ({ youtubeAvailable: () => fake.desktop, youtubeStatus: fake.status, youtubeFiles: fake.files, youtubeDrafts: fake.drafts, youtubeVideos: fake.videos, pickYouTubeFile: fake.pick, prepareYouTube: fake.prepare, uploadYouTube: fake.upload, removeYouTubeFile: fake.remove, discardYouTube: fake.discard }))
vi.mock('../../../api/studio-google', () => ({ connectGoogle: fake.connect, updateGoogle: fake.update }))
vi.mock('../../../lib/ui-text', () => ({ useUiText: () => fake.text }))
import { YouTubeConnector } from '../YouTubeConnector'
const configured = { configured: true, enabled: true, publishing: true, email: 'test@example.com', channel: { id: 'UCabcdefghijklmnopqrstuv', title: 'Test channel', uploads: 'UUabcdefghijklmnopqrstuv' } }
const file = { id: 'file', name: 'Selected.mp4', size: 1234, sha256: 'a'.repeat(64), mime: 'video/mp4' }
const metadata = { file_id: 'file', title: 'Video title', description: '<script>inert content</script>', category_id: '22', privacy: 'private', made_for_kids: false, contains_synthetic_media: true, intended_short: true }
const draft = { id: 'draft', account: configured.channel.id, input: { metadata, file }, phase: 'pending', created_at: 1, remote_id: null }
beforeEach(() => { fake.desktop = true; localStorage.clear(); for (const fn of [fake.status, fake.files, fake.drafts, fake.videos, fake.pick, fake.prepare, fake.upload, fake.remove, fake.discard, fake.connect, fake.update]) fn.mockReset(); fake.status.mockResolvedValue(configured); fake.files.mockResolvedValue([file]); fake.drafts.mockResolvedValue([]) })
afterEach(cleanup)
function open() { const view = render(<YouTubeConnector />); view.getByTestId('youtube-connector').setAttribute('open', ''); return view }
it('keeps native picker and authorization disabled in preview with no fake account', () => {
  fake.desktop = false; open()
  for (const label of ['Connect with Google', 'Select local video', 'Prepare local draft']) expect((screen.getByText(label) as HTMLButtonElement).disabled).toBe(true)
  expect(fake.status).not.toHaveBeenCalled(); expect(fake.files).not.toHaveBeenCalled(); expect(screen.queryByText(/Test channel/)).toBeNull()
})
it('requires channel, selected copy and review of inert metadata before upload', async () => {
  fake.drafts.mockResolvedValue([draft]); fake.upload.mockResolvedValue([]); open(); await screen.findByText('Review action')
  expect(fake.upload).not.toHaveBeenCalled(); expect(fake.videos).not.toHaveBeenCalled(); expect(fake.pick).not.toHaveBeenCalled()
  expect(screen.queryByText('Confirm YouTube upload')).toBeNull()
  fireEvent.click(screen.getByText('Review action')); expect(screen.getByText('<script>inert content</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull()
  fireEvent.click(screen.getByText('Confirm YouTube upload'))
  await waitFor(() => expect(fake.upload).toHaveBeenCalledWith('draft', expect.any(AbortSignal)))
  expect(localStorage.length).toBe(0)
})
it('defaults to private and demands both classification answers before preparing', async () => {
  fake.prepare.mockResolvedValue(draft); open(); await screen.findByText(/Test channel/)
  expect((screen.getByLabelText('Requested visibility') as HTMLSelectElement).value).toBe('private')
  fireEvent.change(screen.getByLabelText('Video to upload'), { target: { value: 'file' } })
  fireEvent.change(screen.getByLabelText('Video title'), { target: { value: 'Title' } })
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Is this video made for kids?'), { target: { value: 'no' } })
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Contains realistic altered or synthetic content?'), { target: { value: 'yes' } })
  fireEvent.click(screen.getByText('Prepare local draft'))
  await waitFor(() => expect(fake.prepare).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'file', privacy: 'private', made_for_kids: false, contains_synthetic_media: true, intended_short: false }), expect.any(AbortSignal)))
  expect(fake.upload).not.toHaveBeenCalled()
})
it('blocks old channels, missing snapshots and uncertain transfers', async () => {
  fake.drafts.mockResolvedValue([draft]); fake.status.mockResolvedValue({ ...configured, channel: { ...configured.channel, id: 'other' } })
  let view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.status.mockResolvedValue(configured); fake.files.mockResolvedValue([])
  view = open(); await screen.findByText('Review action'); expect((screen.getByText('Review action') as HTMLButtonElement).disabled).toBe(true)
  view.unmount(); fake.drafts.mockResolvedValue([{ ...draft, phase: 'uncertain' }]); open()
  await screen.findByText(/Uncertain result/); expect(screen.queryByText('Review action')).toBeNull(); expect(fake.upload).not.toHaveBeenCalled()
})
it('preserves an existing channel after refused authorization and requests upload permission only by opt-in', async () => {
  fake.status.mockResolvedValue({ ...configured, publishing: false }); fake.connect.mockRejectedValue(new Error('Acesso recusado'))
  open(); await screen.findByText(/Test channel/)
  expect((screen.getByLabelText('Request video uploads with mandatory review when authorizing') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByText('Authorize again')); await screen.findByText('Acesso recusado')
  expect(fake.connect).toHaveBeenCalledWith('youtube', expect.any(AbortSignal), false); expect(screen.getByText(/Test channel/)).toBeTruthy()
  expect(fake.update).not.toHaveBeenCalled(); expect(fake.upload).not.toHaveBeenCalled()
})
it('checks the UTF-8 description limit before allowing a local draft', async () => {
  open(); await screen.findByText(/Test channel/)
  for (const [label, value] of [['Video to upload', 'file'], ['Video title', 'Title'], ['Is this video made for kids?', 'no'], ['Contains realistic altered or synthetic content?', 'no'], ['Video description', 'ç'.repeat(2501)]]) fireEvent.change(screen.getByLabelText(label), { target: { value } })
  expect((screen.getByText('Prepare local draft') as HTMLButtonElement).disabled).toBe(true)
  expect(fake.prepare).not.toHaveBeenCalled()
})
