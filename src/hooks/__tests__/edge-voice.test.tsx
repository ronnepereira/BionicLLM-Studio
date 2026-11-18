/** @vitest-environment jsdom */
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { act, renderHook, cleanup } from '@testing-library/react'
import { standOn } from '../../test-support/devices'
const speech = vi.hoisted(() => ({ edge: vi.fn(), play: vi.fn(async (..._args: unknown[]) => {}), piper: vi.fn(), external: vi.fn(), browser: vi.fn() }))
vi.mock('../../api/edge-tts', () => ({ synthesizeEdge: (...args: unknown[]) => speech.edge(...args) }))
vi.mock('../../api/voice', async original => ({ ...await original<typeof import('../../api/voice')>(), playNeuralAudio: (...args: unknown[]) => speech.play(...args), synthesizeNeural: (...args: unknown[]) => speech.piper(...args), synthesizeExternal: (...args: unknown[]) => speech.external(...args), speak: (...args: unknown[]) => speech.browser(...args), speakStreaming: (...args: unknown[]) => speech.browser(...args) }))
import { useVoice, stopSpeechPlayback } from '../useVoice'
import { useVoiceStore } from '../../stores/voiceStore'
beforeEach(() => {
  standOn('windows')
  for (const mock of Object.values(speech)) mock.mockClear()
  speech.edge.mockReset(); speech.edge.mockResolvedValue('blob:edge')
  useVoiceStore.setState({ ttsMode: 'edge', ttsEnabled: true, edgeVoice: 'pt-BR-FranciscaNeural', edgeRate: 100, ttsFallbackReason: null, isSpeaking: false })
})
afterEach(() => { cleanup(); stopSpeechPlayback(); vi.unstubAllGlobals() })
it('uses Edge for selected read-aloud without invoking Piper or a configured external provider', async () => {
  const { result } = renderHook(() => useVoice())
  await act(async () => { await result.current.speakText('Olá, Brasil!') })
  expect(speech.edge).toHaveBeenCalledWith('Olá, Brasil!', 'pt-BR-FranciscaNeural', 100, expect.any(AbortSignal))
  expect(speech.play).toHaveBeenCalledWith('blob:edge')
  expect(speech.piper).not.toHaveBeenCalled(); expect(speech.external).not.toHaveBeenCalled()
  expect(useVoiceStore.getState().isSpeaking).toBe(false)
})
it('shows a failure instead of silently changing providers', async () => {
  speech.edge.mockRejectedValue(new Error('Sem conexão'))
  const { result } = renderHook(() => useVoice())
  await act(async () => { await result.current.speakText('Olá') })
  expect(useVoiceStore.getState().ttsFallbackReason).toContain('Sem conexão')
  expect(speech.piper).not.toHaveBeenCalled(); expect(speech.browser).not.toHaveBeenCalled()
})
it('does not send text while read-aloud is disabled', async () => {
  useVoiceStore.setState({ ttsEnabled: false })
  const { result } = renderHook(() => useVoice())
  await act(async () => { await result.current.speakText('Privado') })
  expect(speech.edge).not.toHaveBeenCalled()
})
