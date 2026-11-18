import { useRef, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { backgroundFileKind, backgroundUrl, normalizeChatBackground, removeBackgroundFile, saveBackgroundFile, type ChatBackground } from '../../lib/chat-background'

export function ChatBackgroundSetting() {
  const settings = useSettingsStore(s => s.settings)
  const update = useSettingsStore(s => s.updateSettings)
  const config = normalizeChatBackground(settings.chatBackground)
  const [url, setUrl] = useState(config.source.startsWith('https:') ? config.source : '')
  const [kind, setKind] = useState<'image' | 'video'>(config.kind === 'video' ? 'video' : 'image')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const replace = (next: ChatBackground) => {
    update({ chatBackground: next })
    if (config.source !== next.source) void removeBackgroundFile(config.source).catch(() => {})
    setError('')
  }
  const button = 'min-h-8 rounded-md border border-gray-300 dark:border-white/15 px-3 py-1 text-xs hover:bg-gray-200 dark:hover:bg-white/10 disabled:opacity-50'
  return <fieldset className="min-w-0 space-y-3 rounded-lg border border-gray-200 dark:border-white/10 p-3 text-gray-800 dark:text-gray-200">
    <legend className="px-1 text-sm font-semibold">Fundo do chat</legend>
    <p id="chat-background-hint" className="text-xs text-gray-600 dark:text-gray-400">Arquivo local de imagem ou vídeo curto de até 30 MB. O fundo fica escurecido e o texto do chat fica claro para preservar a leitura. Arquivos locais são guardados apenas neste dispositivo, separados do histórico.</p>
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={busy} className={button} onClick={() => input.current?.click()}>{busy ? 'Guardando fundo…' : 'Escolher arquivo local'}</button>
      <button type="button" disabled={busy || config.kind === 'none'} className={button} onClick={() => { replace({ ...config, kind: 'none', source: '', name: '' }); setUrl('') }}>Remover fundo</button>
      <span className="min-w-0 break-all text-xs text-gray-500">{config.kind === 'none' ? 'Sem fundo personalizado' : config.name || 'Fundo por URL'}</span>
    </div>
    <input ref={input} type="file" aria-label="Arquivo do fundo do chat" accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm" hidden onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ''
      if (!file) return
      setBusy(true)
      try { const fileKind = backgroundFileKind(file); const source = await saveBackgroundFile(file); replace({ ...config, kind: fileKind, source, name: file.name, paused: false }); setUrl('') }
      catch (err) { setError(err instanceof Error ? err.message : String(err)) }
      finally { setBusy(false) }
    }} />
    <div className="flex flex-wrap gap-2 items-end">
      <div className="flex-1 min-w-40"><label className="block text-xs mb-1" htmlFor="chat-background-url">URL direta do fundo</label><input id="chat-background-url" type="url" value={url} onChange={e => setUrl(e.target.value)} aria-describedby="chat-background-url-hint" placeholder="https://…" className="w-full rounded-md border border-gray-300 dark:border-white/15 bg-transparent px-2 py-1.5 text-xs" /></div>
      <div><label htmlFor="chat-background-kind" className="block text-xs mb-1">Tipo</label><select id="chat-background-kind" value={kind} onChange={e => setKind(e.target.value as 'image' | 'video')} className="rounded-md border border-gray-300 dark:border-white/15 bg-white dark:bg-neutral-900 p-1.5 text-xs"><option value="image">Imagem</option><option value="video">Vídeo</option></select></div>
      <button type="button" className={button} disabled={busy || !url.trim()} onClick={() => { try { replace({ ...config, kind, source: backgroundUrl(url), name: '', paused: false }) } catch (err) { setError(err instanceof Error ? err.message : 'Informe uma URL HTTPS válida.') } }}>Aplicar URL</button>
    </div>
    <p id="chat-background-url-hint" className="text-xs text-gray-500">Use o endereço HTTPS do arquivo, não de uma página. O servidor receberá a conexão. Vídeos reproduzem sem som; você pode pausá-los no chat.</p>
    <div className="flex items-center gap-3"><label htmlFor="chat-background-dim" className="text-xs">Escurecimento: {config.dim}%</label><input id="chat-background-dim" type="range" min={60} max={95} step={5} value={config.dim} onChange={e => update({ chatBackground: { ...config, dim: Number(e.target.value) } })} className="min-w-0 flex-1 accent-lu-accent" /></div>
    {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
    <div className="border-t border-gray-200 dark:border-white/10 pt-3">
      <label htmlFor="chat-remote-thumbnails" className="flex gap-2 items-start text-xs"><input id="chat-remote-thumbnails" type="checkbox" checked={settings.externalImagePreviews === true} onChange={e => update({ externalImagePreviews: e.target.checked })} className="mt-0.5 accent-lu-accent" /><span>Carregar miniaturas externas automaticamente no chat</span></label>
      <p className="mt-1 text-xs text-gray-500">Desativado: cada imagem externa oferece “Carregar miniatura”. Ativado: os servidores das imagens recebem a conexão ao exibir a mensagem. A geração de imagens mantém o comportamento atual.</p>
    </div>
  </fieldset>
}
