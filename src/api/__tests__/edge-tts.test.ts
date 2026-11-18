/** @vitest-environment jsdom */
import { beforeEach, it, expect, vi } from 'vitest'
const fake = vi.hoisted(() => ({ native: true, call: vi.fn(), blob: vi.fn((..._args: unknown[]) => 'blob:edge') }))
vi.mock('../backend', () => ({ isTauri: () => fake.native, backendCall: (...args: unknown[]) => fake.call(...args) }))
vi.mock('../voice', () => ({ base64ToBlobUrl: (...args: unknown[]) => fake.blob(...args) }))
vi.mock('../../lib/capabilities', () => ({ hasLocalVoice: () => true }))
import { synthesizeEdge, edgeTtsStatus } from '../edge-tts'
import { EDGE_VOICES, normalizeEdgeVoice } from '../../lib/edge-tts'
beforeEach(() => { fake.native = true; fake.call.mockReset(); fake.blob.mockClear() })

it('offers Thalita and preserves its selection through native synthesis', async () => {
  const voice = 'pt-BR-ThalitaMultilingualNeural'
  expect(EDGE_VOICES.some(item => item.id === voice)).toBe(true)
  expect(normalizeEdgeVoice(voice)).toBe(voice)
  fake.call.mockResolvedValue({ audio_base64: 'audio', mime: 'audio/mpeg' })
  await synthesizeEdge('Olá, eu sou a Thalita.', voice, 100)
  expect(fake.call).toHaveBeenCalledWith('edge_tts_synthesize', expect.objectContaining({ voice }))
})

it('leaves the web preview without native execution', async () => {
  fake.native = false
  expect((await edgeTtsStatus()).available).toBe(false)
  await expect(synthesizeEdge('Olá', 'pt-BR-FranciscaNeural', 100)).rejects.toThrow(/desktop/)
  expect(fake.call).not.toHaveBeenCalled()
})
it('normalizes preferences and passes text only as data', async () => {
  fake.call.mockResolvedValue({ audio_base64: 'audio', mime: 'audio/mpeg' })
  expect(await synthesizeEdge('Olá! "texto"', '../bad', 999)).toBe('blob:edge')
  expect(fake.call).toHaveBeenCalledWith('edge_tts_synthesize', expect.objectContaining({ text: 'Olá! "texto"', voice: 'pt-BR-FranciscaNeural', rate: 100 }))
})
it('cancels native synthesis and never plays an audio response that arrives after Stop', async () => {
  let finish!: (value: unknown) => void
  fake.call.mockImplementation(cmd => cmd === 'edge_tts_synthesize' ? new Promise(resolve => { finish = resolve }) : Promise.resolve())
  const controller = new AbortController()
  const pending = synthesizeEdge('Olá', 'pt-BR-AntonioNeural', 100, controller.signal)
  controller.abort()
  finish({ audio_base64: 'late', mime: 'audio/mpeg' })
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  const requestId = fake.call.mock.calls[0][1].requestId
  expect(fake.call).toHaveBeenCalledWith('edge_tts_cancel', { requestId })
  expect(fake.blob).not.toHaveBeenCalled()
})
it('does not send a request that was canceled before it began', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(synthesizeEdge('Olá', 'pt-BR-AntonioNeural', 100, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
  expect(fake.call).not.toHaveBeenCalled()
})
