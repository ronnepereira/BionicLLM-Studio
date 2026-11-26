import { useState } from 'react'
import { FileAudio, Link2, Mic } from 'lucide-react'
import { transcribeAudio, transcribeMediaUrl } from '../../api/voice'
import { saveOrShare, saveSucceeded } from '../../lib/save-or-share'
import { useUiText } from '../../lib/ui-text'
import { useVoiceStore } from '../../stores/voiceStore'
import { Modal } from '../ui/Modal'
import { VoiceButton } from './VoiceButton'

const MAX_FILE_BYTES = 25 * 1024 * 1024

export function TranscriptionDialog({ onClose, onUse }: { onClose: () => void; onUse: (text: string) => void }) {
  const text = useUiText()
  const [url, setUrl] = useState('')
  const [transcript, setTranscript] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const recording = useVoiceStore(state => state.isRecording)
  const transcribing = useVoiceStore(state => state.isTranscribing)
  const micError = useVoiceStore(state => state.sttError)
  const locked = busy || recording || transcribing
  const received = (result: string) => {
    if (!result.trim()) {
      setError(text('No speech found in the recording.'))
      return
    }
    setTranscript(result.trim())
  }
  const run = async (read: () => Promise<string>) => {
    if (locked) return
    setError('')
    setStatus('')
    setBusy(true)
    try { received(await read()) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setStatus('')
    setError('')
    setBusy(true)
    try {
      const result = await saveOrShare({ filename: 'transcricao.txt', mime: 'text/plain', text: transcript.trim() })
      if (saveSucceeded(result)) setStatus(text('Transcript saved.'))
      else if (result.status === 'error') setError(result.error)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }

  return <Modal open onClose={onClose} title={text('Transcribe audio')}>
    <div className="space-y-3 text-sm">
      <p className="text-gray-600 dark:text-gray-300">{text('Use the microphone, choose a media file, or paste a direct HTTPS media link. Files and links use local faster-whisper.')}</p>
      <div className="flex flex-wrap gap-2">
        <div className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-2 dark:border-white/15">
          <span className="inline-flex items-center gap-1.5"><Mic size={14} aria-hidden />{text('Microphone')}</span>
          <VoiceButton disabled={busy} onTranscript={received} />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-300 px-3 py-2 focus-within:ring-2 focus-within:ring-blue-500 dark:border-white/15">
          <FileAudio size={15} aria-hidden />{text('Choose audio or video')}
          <input className="sr-only" type="file" accept="audio/*,video/*,.m4a,.mp3,.mp4,.wav,.webm,.ogg,.flac" disabled={locked}
            onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              if (file.size > MAX_FILE_BYTES) { setError(text('The media file must be 25 MB or smaller.')); return }
              void run(() => transcribeAudio(file))
            }} />
        </label>
      </div>
      <form className="flex flex-wrap gap-2" onSubmit={event => {
        event.preventDefault()
        if (url.trim()) void run(() => transcribeMediaUrl(url.trim()))
      }}>
        <input type="url" aria-label={text('Direct media link')} placeholder="https://…" value={url}
          onChange={event => setUrl(event.target.value)} className="min-w-36 flex-1 rounded-md border border-gray-300 bg-transparent px-2 py-2 dark:border-white/15" />
        <button type="submit" className="lu-control" disabled={locked || !url.trim()}><Link2 size={14} />{text('Transcribe link')}</button>
      </form>
      <p className="text-xs text-gray-500 dark:text-gray-400">{text('For YouTube or Vimeo, select an authorized download or enter a direct media link. Video page addresses are not media links.')}</p>
      {(error || micError) && <p role="alert" className="text-red-600 dark:text-red-400">{error || micError}</p>}
      {(busy || transcribing || status) && <p role="status">{status || text(transcribing ? 'Transcribing...' : 'Please wait…')}</p>}
      {transcript && <>
        <textarea aria-label={text('Transcript')} rows={6} className="w-full rounded-md border border-gray-300 bg-transparent p-2 dark:border-white/15"
          value={transcript} onChange={event => setTranscript(event.target.value)} />
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="lu-control" disabled={locked || !transcript.trim()} onClick={() => void save()}>{text('Save as TXT')}</button>
          <button type="button" className="lu-control lu-control--primary" disabled={locked || !transcript.trim()} onClick={() => onUse(transcript.trim())}>{text('Use in chat')}</button>
        </div>
      </>}
    </div>
  </Modal>
}
