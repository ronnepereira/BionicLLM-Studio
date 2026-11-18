import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { normalizeChatBackground, readBackgroundFile } from '../../lib/chat-background'

export function ChatBackground() {
  const raw = useSettingsStore(s => s.settings.chatBackground)
  const update = useSettingsStore(s => s.updateSettings)
  const config = normalizeChatBackground(raw)
  const [loaded, setLoaded] = useState<{ source: string; url: string; error?: string } | null>(null)
  const [visible, setVisible] = useState(() => !document.hidden)
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReduced(media.matches)
    const visibility = () => setVisible(!document.hidden)
    media.addEventListener('change', changed)
    document.addEventListener('visibilitychange', visibility)
    return () => { media.removeEventListener('change', changed); document.removeEventListener('visibilitychange', visibility) }
  }, [])
  useEffect(() => {
    if (config.kind === 'none' || !config.source) return
    let alive = true
    let objectUrl: string | undefined
    const source = config.source
    void (async () => {
      try {
        const url = source.startsWith('local:') ? (objectUrl = URL.createObjectURL(await readBackgroundFile(source))) : source
        if (alive) setLoaded({ source, url })
        else if (objectUrl) URL.revokeObjectURL(objectUrl)
      } catch (e) { if (alive) setLoaded({ source, url: '', error: String(e instanceof Error ? e.message : e) }) }
    })()
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [config.source, config.kind])
  const src = loaded?.source === config.source ? loaded.url : ''
  const playing = visible && !config.paused && !reduced
  useEffect(() => {
    const el = video.current
    if (!el) return
    if (playing) void el.play().catch(() => {})
    else el.pause()
  }, [playing, src])
  if (config.kind === 'none') return null
  const error = loaded?.source === config.source ? loaded.error : undefined
  return <>
    <div data-testid="chat-background" className="absolute inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden="true">
      {src && !error && (config.kind === 'video'
        ? <video key={src} ref={video} src={src} muted loop playsInline preload="metadata" width={1280} height={720} tabIndex={-1} onError={() => setLoaded({ source: config.source, url: src, error: 'Não foi possível abrir o vídeo do fundo.' })} className="h-full w-full object-cover" />
        : <img key={src} src={src} alt="" referrerPolicy="no-referrer" onError={() => setLoaded({ source: config.source, url: src, error: 'Não foi possível abrir a imagem do fundo.' })} className="h-full w-full object-cover" />)}
      <div className="absolute inset-0 bg-black" style={{ opacity: config.dim / 100 }} />
    </div>
    {(config.kind === 'video' || error) && <div className="relative z-20 mx-3 mt-2 mb-1 max-w-full shrink-0 self-end rounded-md bg-black/85 px-2 py-1 text-xs text-gray-200">
      {error ? <span role="status" className="text-xs text-red-400">{error}</span> : reduced
        ? <span className="text-xs text-gray-400">Vídeo pausado: movimento reduzido.</span>
        : <button
        type="button"
        className="min-h-6 min-w-6 hover:bg-white/10"
        onClick={() => update({ chatBackground: { ...config, paused: !config.paused } })}
        aria-label={config.paused ? 'Reproduzir fundo' : 'Pausar fundo'}
        title={config.paused ? 'Reproduzir fundo' : 'Pausar fundo'}
      >
          {config.paused ? <Play size={10} /> : <Pause size={10} />}
        </button>}
    </div>}
  </>
}
