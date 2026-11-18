import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { useUiText } from "../../lib/ui-text"
/**
 * Preview of ONE file inside the Explorer panel (2.6.6 C3).
 *
 * Text and code go through `fs_read` and the existing CodeBlock highlighter,
 * images through the jailed byte read as a blob URL, HTML through the shared
 * sandboxed frame.
 *
 * SECURITY:
 *   - Every read carries `workingDirectory: root`, so the Rust jail
 *     (resolve_path / contain_within) is the same one the agent runs under, and
 *     a path outside the root is refused here before the backend is asked.
 *   - HTML renders WITHOUT allow-scripts. Clicking a file means "show me this",
 *     not "execute this repository's JavaScript". Scripts are a deliberate
 *     per-file opt-in and reset when another file is opened.
 *   - Images do not use a static Tauri asset scope. That scope knows nothing
 *     about the jail, so a home-wide one would be a read surface right next to
 *     the jail instead of inside it.
 *   - There is no "open in browser": it would need a data URL, which the
 *     backend's openExternal refuses on purpose.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, X, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { backendCall } from '../../api/backend'
import { CodeBlock } from './CodeBlock'
import { HtmlPreviewFrame, ViewportSwitcher } from './HtmlPreviewFrame'
import { buildDocument, type Viewport } from '../../lib/html-preview'
import {
  capPreviewText,
  imageMimeFor,
  previewKindFor,
  previewLanguageFor,
} from '../../lib/file-preview'
import { isWithinRoot, type ExplorerNode } from '../../lib/explorer-tree'
import { formatCount } from '../../lib/formatters'
import { Hinweis } from '../ui/Hinweis'

interface Props {
  node: ExplorerNode
  root: string
  onClose: () => void
  onTrashed: (path: string) => void
  deleteLocked?: string | null
}

type PreviewState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'text'; text: string; truncated: boolean }
  | { status: 'html'; doc: string }
  | { status: 'image'; url: string }
  | { status: 'binary'; bytes: number }

export function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: mime }))
}

export function FilePreview({ node, root, onClose, onTrashed, deleteLocked }: Props) {
  const uiText = useUiText()

  const [state, setState] = useState<PreviewState>({ status: 'loading' })
  const [viewport, setViewport] = useState<Viewport>('desktop')
  // Off, per file. The panel mounts this component keyed on the path, so
  // opening another file starts a fresh component with scripts off again:
  // an opt-in can never leak from one file to the next.
  const [allowScripts, setAllowScripts] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const sendToTrash = async () => {
    if (deleting || deleteLocked || !isWithinRoot(root, node.path)) return
    setDeleting(true); setDeleteError('')
    try {
      const result = await backendCall<{ trashed: boolean }>('fs_trash', { path: node.path, workingDirectory: root })
      if (!result?.trashed) throw new Error('A exclusão não foi confirmada. O arquivo permanece na prévia.')
      setConfirmDelete(false)
      onTrashed(node.path)
    } catch (error) { setDeleteError(error instanceof Error ? error.message : String(error)) }
    finally { setDeleting(false) }
  }


  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null

    const run = async () => {
      if (!isWithinRoot(root, node.path)) {
        setState({ status: 'error', message: 'This file sits outside the workspace root.' })
        return
      }
      const kind = previewKindFor(node.name)
      try {
        if (kind === 'binary') {
          setState({ status: 'binary', bytes: node.size ?? 0 })
          return
        }
        if (kind === 'image') {
          const data = await backendCall<{ base64?: string; bytes?: number }>('fs_read_bytes', {
            path: node.path,
            workingDirectory: root,
          })
          if (cancelled) return
          if (!data?.base64) {
            setState({ status: 'error', message: 'The image could not be read.' })
            return
          }
          objectUrl = base64ToBlobUrl(data.base64, imageMimeFor(node.name))
          setState({ status: 'image', url: objectUrl })
          return
        }
        const data = await backendCall<{ content?: string; encoding?: string; bytes?: number }>(
          'fs_read',
          { path: node.path, workingDirectory: root },
        )
        if (cancelled) return
        if (data?.encoding === 'binary' || typeof data?.content !== 'string') {
          setState({ status: 'binary', bytes: data?.bytes ?? node.size ?? 0 })
          return
        }
        if (kind === 'html') {
          setState({ status: 'html', doc: buildDocument(data.content) })
          return
        }
        const capped = capPreviewText(data.content)
        setState({ status: 'text', text: capped.text, truncated: capped.truncated })
      } catch (e) {
        if (cancelled) return
        setState({ status: 'error', message: e instanceof Error ? e.message : 'Preview failed' })
      }
    }

    run()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [node.path, node.name, node.size, root])

  return (
    <div className="flex flex-col min-h-0 flex-1 border-t border-gray-200 dark:border-white/[0.06]">
      <div className="flex flex-wrap items-center gap-1 px-1.5 py-1 border-b border-gray-200 dark:border-white/[0.04] bg-gray-100/60 dark:bg-white/[0.02]">
        <span
          className="text-[0.55rem] font-mono text-gray-700 dark:text-gray-300 truncate flex-1"
          title={node.path}
        >
          {node.name}
        </span>
        {state.status === 'html' && <ViewportSwitcher viewport={viewport} onChange={setViewport} compact />}
        <div className="flex items-center gap-1">
        {state.status === 'html' && (
          <>
            {/* Der Ein-Zustand traegt Gruen, wie jeder Ein-Zustand in der App
                (`lib/hinweis.ts`). Vorher war er gelb und behauptete damit
                einen Zwischenfall: eingeschaltete Skripte sind aber genau
                das, was der Nutzer hier eben angeklickt hat, und das Symbol
                daneben sagt schon, dass die Seite jetzt ausgefuehrt wird. */}
            <button
              onClick={() => setAllowScripts((v) => !v)}
              title={
                allowScripts
                  ? uiText("Scripts are running for this file. Click to turn them off.")
                  : uiText("Scripts are off. This page is only rendered, not executed. Click to allow scripts for this file.")
              }
              className={`flex items-center gap-0.5 px-1 py-0.5 rounded text-[0.5rem] border transition-colors ${
                allowScripts
                  ? 'border-emerald-500/40 text-emerald-500 bg-emerald-500/[0.08]'
                  : 'border-gray-200 dark:border-white/10 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
              data-testid="explorer-scripts-toggle"
            >
              {allowScripts ? <ShieldAlert size={9} /> : <ShieldCheck size={9} />}
              <span>{allowScripts ? uiText("Scripts on") : uiText("Enable scripts")}</span>
            </button>
          </>
        )}
        <button type="button" disabled={!!deleteLocked || deleting || !isWithinRoot(root, node.path)} onClick={() => { setDeleteError(''); setConfirmDelete(true) }}
          title={deleteLocked || 'Enviar este arquivo para a Lixeira'} data-testid="explorer-delete-file"
          className="inline-flex shrink-0 items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-1 text-[0.6rem] text-red-600 hover:bg-red-500/20 disabled:opacity-40 dark:text-red-400">
          <Trash2 size={11} />Excluir arquivo
        </button>
        </div>
        <button
          onClick={onClose}
          title={uiText("Close the preview")}
          className="flex items-center justify-center w-4 h-4 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/5 transition-colors shrink-0"
        >
          <X size={10} />
        </button>
      </div>

      <Modal open={confirmDelete} title="Excluir arquivo?" onClose={() => { if (!deleting) setConfirmDelete(false) }}>
        <p className="text-sm text-gray-600 dark:text-gray-400">O arquivo será enviado para a Lixeira do Windows. Você poderá restaurá-lo por lá.</p>
        <p className="mt-3 break-all rounded-lg bg-gray-100 p-3 font-mono text-xs dark:bg-white/5">{node.path}</p>
        {deleteLocked && <p role="status" className="mt-2 text-sm text-amber-500">{deleteLocked}</p>}
        {deleteError && <p role="alert" className="mt-2 text-sm text-red-500">{deleteError}</p>}
        <ModalActions>
          <ModalButton disabled={deleting} onClick={() => setConfirmDelete(false)} data-autofocus>Cancelar</ModalButton>
          <ModalButton disabled={deleting || !!deleteLocked} onClick={() => { void sendToTrash() }} className="!bg-red-600 !text-white hover:!bg-red-700">{deleting ? 'Enviando à Lixeira…' : 'Excluir arquivo'}</ModalButton>
        </ModalActions>
      </Modal>
      <div className="flex-1 min-h-0 overflow-auto scrollbar-thin">
        {state.status === 'loading' && (
          <div className="flex items-center gap-1 px-2 py-2 text-[0.55rem] text-gray-400 dark:text-gray-600">
            <Loader2 size={10} className="animate-spin" />{uiText(" Reading...")}</div>
        )}

        {state.status === 'error' && (
          <div className="flex items-start gap-1 px-2 py-2 text-[0.55rem] text-red-500/90">
            <AlertTriangle size={10} className="mt-[1px] shrink-0" />
            <span className="break-words">{state.message}</span>
          </div>
        )}

        {state.status === 'binary' && (
          <p className="px-2 py-2 text-[0.55rem] text-gray-400 dark:text-gray-600">{uiText("Binary file")}{state.bytes ? uiText(", {v0} bytes", { v0: formatCount(state.bytes) }) : ''}{uiText(". Not previewed.")}</p>
        )}

        {state.status === 'text' && (
          <div className="p-1">
            <CodeBlock code={state.text} language={previewLanguageFor(node.name)} />
            {state.truncated && (
              <Hinweis className="px-1 pb-1">{uiText("Shortened for the preview. Open the file to see the rest.")}</Hinweis>
            )}
          </div>
        )}

        {state.status === 'image' && (
          <div className="flex items-center justify-center p-2 h-full">
            <img
              src={state.url}
              alt={node.name}
              className="max-w-full max-h-full object-contain rounded border border-gray-200 dark:border-white/10"
            />
          </div>
        )}

        {state.status === 'html' && (
          <div className="flex items-center justify-center h-full p-1">
            <HtmlPreviewFrame
              doc={state.doc}
              viewport={viewport}
              allowScripts={allowScripts}
              title={uiText("Preview of {v0}", { v0: node.name })}
              className="w-full h-full bg-white border border-gray-200 dark:border-white/10 rounded"
            />
          </div>
        )}
      </div>

      {state.status === 'html' && (
        <p className="px-1.5 py-0.5 text-[0.45rem] text-gray-400 dark:text-gray-600 border-t border-gray-200 dark:border-white/[0.04]">{uiText("Rendered in a sandbox: sibling css and js files do not load.")}</p>
      )}
    </div>
  )
}
