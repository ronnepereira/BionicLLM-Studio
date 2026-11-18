import { useEffect, useRef, useState } from 'react'
import { Download, Loader2, Play, Square, RefreshCw } from 'lucide-react'
import { isTauri } from '../../api/backend'
import { edgeTtsStatus, installEdgeTts, type EdgeTtsStatus } from '../../api/edge-tts'
import { EDGE_VOICES, normalizeEdgeVoice } from '../../lib/edge-tts'
import { useVoiceStore } from '../../stores/voiceStore'
import { useVoice } from '../../hooks/useVoice'
import { useUiText } from '../../lib/ui-text'

export function EdgeTtsSetting() {
  const text = useUiText()
  const store = useVoiceStore()
  const { speakText, stopSpeaking } = useVoice()
  const [status, setStatus] = useState<EdgeTtsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = useRef(false)
  useEffect(() => {
    let disposed = false
    void edgeTtsStatus().then(value => {
      if (!disposed) { setStatus(value); useVoiceStore.getState().setEdgeTtsAvailable(value.available) }
    }).catch(() => { if (!disposed) setError(text('Could not check EdgeTTS. Try again.')) })
    return () => { disposed = true; if (preview.current) stopSpeaking() }
  }, [text, stopSpeaking])
  const refresh = async (install: boolean) => {
    if (busy || !isTauri()) return
    setBusy(true); setError('')
    try {
      const value = await (install ? installEdgeTts() : edgeTtsStatus())
      setStatus(value); store.setEdgeTtsAvailable(value.available)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const sample = async () => {
    if (store.isSpeaking) { stopSpeaking(); return }
    preview.current = true
    try { await speakText(text('Hello! This is a Brazilian Portuguese voice demonstration in BionicLLM Studio.')) }
    finally { preview.current = false }
  }
  const button = 'lu-control lu-control--outline inline-flex items-center gap-1.5'
  return <div className="space-y-3 rounded-lg border border-gray-200 dark:border-white/10 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">EdgeTTS · {text('Brazilian Portuguese')}</h3><span role="status" className="text-xs text-gray-500">{!isTauri() ? text('Desktop app required') : status?.available ? text('Voice component installed') : text('Voice component not installed')}</span></div>
    <p className="text-xs text-gray-500 dark:text-gray-400">{text('Requires internet. Text selected for read-aloud is sent to Microsoft to generate speech. No API key is needed. Piper remains available for local speech.')}</p>
    {!isTauri() && <p className="text-xs text-gray-500">{text('This web preview saves voice preferences; installation and speech work in the Windows desktop app.')}</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={!isTauri() || busy} onClick={() => void refresh(false)}><RefreshCw size={12} />{text('Check voice component')}</button>
      {!status?.available && <button className={button} disabled={!isTauri() || busy} onClick={() => void refresh(true)}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}{busy ? text('Installing…') : text('Install EdgeTTS')}</button>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="edge-voice" className="text-xs">{text('EdgeTTS voice')}</label><select id="edge-voice" className="rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-2 py-1 text-xs" value={store.edgeVoice} onChange={event => { stopSpeaking(); store.updateVoiceSettings({ edgeVoice: normalizeEdgeVoice(event.target.value) }) }}>{EDGE_VOICES.map(voice => <option key={voice.id} value={voice.id}>{voice.name} · pt-BR</option>)}</select></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor="edge-rate" className="text-xs">{text('Speech speed')}</label><select id="edge-rate" className="rounded border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-2 py-1 text-xs" value={store.edgeRate} onChange={event => { stopSpeaking(); store.updateVoiceSettings({ edgeRate: Number(event.target.value) }) }}>{[50, 75, 90, 100, 110, 125, 150].map(rate => <option key={rate} value={rate}>{rate}%</option>)}</select></div>
    <button className={button} disabled={!store.isSpeaking && (!isTauri() || !status?.available || !store.ttsEnabled || busy)} onClick={() => void sample()}>{store.isSpeaking ? <Square size={12} /> : <Play size={12} />}{store.isSpeaking ? text('Stop speaking') : text('Test voice')}</button>
    {!store.ttsEnabled && <p className="text-xs text-gray-500">{text('Enable read-aloud above to test the selected voice.')}</p>}
    {(error || store.ttsFallbackReason) && <p role="alert" className="text-xs text-red-600 dark:text-red-400 break-words">{error || store.ttsFallbackReason}</p>}
  </div>
}
