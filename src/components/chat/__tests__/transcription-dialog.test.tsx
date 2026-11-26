// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TranscriptionDialog } from '../TranscriptionDialog'
import { transcribeMediaUrl } from '../../../api/voice'
import { saveOrShare } from '../../../lib/save-or-share'

vi.mock('../../../api/voice', () => ({ transcribeAudio: vi.fn(), transcribeMediaUrl: vi.fn() }))
vi.mock('../VoiceButton', () => ({ VoiceButton: () => <button type="button">Microfone</button> }))
vi.mock('../../../lib/save-or-share', () => ({
  saveOrShare: vi.fn(async () => ({ status: 'saved' })),
  saveSucceeded: (outcome: { status: string }) => outcome.status === 'saved',
}))

afterEach(cleanup)

it('reviews a transcript before exporting or using it in the message', async () => {
  vi.mocked(transcribeMediaUrl).mockResolvedValue('Texto capturado.')
  const onUse = vi.fn()
  render(<TranscriptionDialog onClose={vi.fn()} onUse={onUse} />)
  const url = 'https://example.com/audio.mp3'
  fireEvent.change(screen.getByRole('textbox', { name: 'Link direto da mídia' }), { target: { value: url } })
  fireEvent.click(screen.getByRole('button', { name: 'Transcrever link' }))
  const result = await screen.findByRole('textbox', { name: 'Transcrição' })
  expect(transcribeMediaUrl).toHaveBeenCalledWith(url)
  expect(onUse).not.toHaveBeenCalled()
  fireEvent.change(result, { target: { value: 'Texto revisado.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Salvar em TXT' }))
  await screen.findByText('Transcrição salva.')
  expect(saveOrShare).toHaveBeenCalledWith({ filename: 'transcricao.txt', mime: 'text/plain', text: 'Texto revisado.' })
  fireEvent.click(screen.getByRole('button', { name: 'Usar na mensagem' }))
  expect(onUse).toHaveBeenCalledExactlyOnceWith('Texto revisado.')
})
