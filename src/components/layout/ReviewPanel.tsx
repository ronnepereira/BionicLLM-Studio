import { useState } from 'react'
import { RefreshCw, GitBranch } from 'lucide-react'
import { useChatStore } from '../../stores/chatStore'
import { useCodexStore } from '../../stores/codexStore'
import { useStagedChangesStore } from '../../stores/stagedChangesStore'
import { StagedChangesPanel } from '../chat/StagedChangesPanel'
import { backendCall } from '../../api/backend'
import { DiffView } from '../chat/DiffView'

export function ReviewPanel() {
  const chatId = useChatStore(s => s.activeConversationId)
  const count = useStagedChangesStore(s => chatId ? s.byChat[chatId]?.length ?? 0 : 0)
  const folder = useCodexStore(s => s.workingDirectory)
  const [mode, setMode] = useState('staged')
  const [diff, setDiff] = useState('')
  const [status, setStatus] = useState('')
  const [loadedFolder, setLoadedFolder] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => {
    if (!folder || busy) return
    setBusy(true); setError('')
    try {
      const result = await backendCall<{ stdout: string; stderr: string; exitCode: number }>('shell_execute', { command: 'git --no-pager -c core.quotePath=false status --short; git --no-pager diff --no-ext-diff --no-textconv --no-color HEAD', cwd: folder, workingDirectory: folder, timeout: 15000 })
      if (result.exitCode !== 0) throw new Error(result.stderr || 'Não foi possível ler o Git desta pasta.')
      const index = result.stdout.indexOf('diff --git ')
      setStatus(index < 0 ? result.stdout : result.stdout.slice(0, index)); setDiff(index < 0 ? '' : result.stdout.slice(index)); setLoadedFolder(folder)
    } catch (e) { setError(String(e)); setLoadedFolder(''); setDiff(''); setStatus('') }
    finally { setBusy(false) }
  }
  return <div className="h-full min-h-0 overflow-y-auto p-3 text-sm">
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1"><label htmlFor="side-review-mode" className="mb-1 block text-xs">Alterações para revisar</label><select id="side-review-mode" value={mode} onChange={e => setMode(e.target.value)} className="w-full rounded-md border border-gray-300 bg-white p-2 dark:border-white/15 dark:bg-neutral-900"><option value="staged">Preparadas nesta conversa ({count})</option><option value="git">Git da pasta selecionada</option></select></div>
      {mode === 'git' && <button type="button" disabled={busy || !folder} onClick={() => { void refresh() }} className="flex min-h-9 items-center gap-1 rounded-md border border-gray-300 px-3 disabled:opacity-40 dark:border-white/15"><RefreshCw size={14} className={busy ? 'animate-spin' : ''} />Consultar Git</button>}
    </div>
    {mode === 'staged' ? count ? <StagedChangesPanel chatId={chatId} /> : <div className="py-12 text-center text-gray-500"><GitBranch size={26} className="mx-auto mb-3 text-blue-400" /><p>Nenhuma alteração preparada nesta conversa.</p><p className="mt-2 text-xs">As mudanças que aguardam revisão do modo Código aparecerão aqui.</p></div> : <>
      <p className="my-3 break-all text-xs text-gray-500">{folder || 'Escolha uma pasta em Abrir arquivo para consultar o Git.'}</p>
      {error && <p role="alert" className="text-red-500">{error}</p>}
      {loadedFolder === folder && <>{status && <pre className="my-3 overflow-x-auto whitespace-pre-wrap break-all text-xs">{status}</pre>}{diff ? <DiffView diff={diff} /> : loadedFolder && <p className="py-6 text-gray-500">Nenhum diff em arquivos rastreados. Arquivos novos aparecem na lista acima.</p>}</>}
    </>}
  </div>
}
