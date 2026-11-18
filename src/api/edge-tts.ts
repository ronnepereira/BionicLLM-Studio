import { backendCall, isTauri } from './backend'
import { base64ToBlobUrl } from './voice'
import { normalizeEdgeRate, normalizeEdgeVoice } from '../lib/edge-tts'
import { hasLocalVoice } from '../lib/capabilities'

export interface EdgeTtsStatus { available: boolean; version: string }
export async function edgeTtsStatus(): Promise<EdgeTtsStatus> {
  if (!isTauri() || !hasLocalVoice()) return { available: false, version: '7.3.1' }
  return backendCall<EdgeTtsStatus>('edge_tts_status')
}
export async function installEdgeTts(): Promise<EdgeTtsStatus> {
  if (!isTauri() || !hasLocalVoice()) throw new Error('A instalação do EdgeTTS funciona no aplicativo desktop.')
  return backendCall<EdgeTtsStatus>('edge_tts_install')
}
export async function synthesizeEdge(text: string, voice: string, rate: number, signal?: AbortSignal): Promise<string> {
  if (!isTauri() || !hasLocalVoice()) throw new Error('O EdgeTTS funciona no aplicativo desktop, não nesta prévia web.')
  const aborted = () => new DOMException('Leitura cancelada.', 'AbortError')
  if (signal?.aborted) throw aborted()
  const requestId = crypto.randomUUID()
  const cancel = () => { void backendCall('edge_tts_cancel', { requestId }).catch(() => {}) }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const result = await backendCall<{ audio_base64: string; mime: string }>('edge_tts_synthesize', {
      text, voice: normalizeEdgeVoice(voice), rate: normalizeEdgeRate(rate), requestId,
    })
    if (signal?.aborted) throw aborted()
    if (!result?.audio_base64 || result.mime !== 'audio/mpeg') throw new Error('O EdgeTTS não retornou áudio válido.')
    return base64ToBlobUrl(result.audio_base64, result.mime)
  } finally { signal?.removeEventListener('abort', cancel) }
}
