import { useState } from 'react'
import { openExternal } from '../../api/backend'
import { useSettingsStore } from '../../stores/settingsStore'
import { remoteImageUrl } from '../../lib/external-image-preview'

/** This is display only: no generation tools, prompts, attachments or model switches. */
export function ExternalImagePreview({ src, alt }: { src: string; alt: string }) {
  const automatic = useSettingsStore(s => s.settings.externalImagePreviews === true)
  const [consent, setConsent] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = remoteImageUrl(src)
  if (!url) return <span className="text-gray-500">Imagem externa indisponível</span>
  return <span className="my-2 inline-flex w-[500px] max-w-full flex-col gap-1 rounded-lg border border-gray-300 dark:border-white/15 bg-gray-100 dark:bg-black/25 p-2 align-top" data-testid="external-image-preview">
    {(automatic || consent) && !failed
      ? <img src={url} alt={alt || 'Imagem encontrada na internet'} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="block max-h-[360px] w-full rounded-md object-contain" />
      : failed
        ? <span className="flex items-center gap-2 p-2 text-center text-sm text-red-500 dark:text-red-400">
          <span className="font-medium">Fonte:</span> {new URL(url).hostname}
        </span>
        : <span className="flex min-h-24 flex-col items-center justify-center gap-2 p-3 text-center text-sm">
          <span>{alt || 'Imagem externa'}</span>
          <button type="button" className="min-h-8 rounded-md bg-lu-accent px-3 py-1 text-white" onClick={() => { setFailed(false); setConsent(true) }}>Carregar miniatura</button>
          <span className="text-xs text-gray-500">A conexão será feita com {new URL(url).hostname}.</span>
        </span>}
    <button type="button" onClick={() => { void openExternal(url) }} className="min-h-6 self-start text-left text-xs text-blue-600 dark:text-blue-400 hover:underline">Abrir imagem original ↗</button>
  </span>
}
