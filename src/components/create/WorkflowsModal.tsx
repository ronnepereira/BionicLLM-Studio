import { useUiText } from "../../lib/ui-text"
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  FileJson,
  FolderOpen,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Tags,
  Trash2,
  Upload,
  Workflow,
  X,
} from 'lucide-react'
import { v4 as uuid } from 'uuid'
import { parseImportedWorkflow } from '../../api/workflows'
import { readWorkflowText } from '../../api/workflow-import'
import type { ComfyApiGraph } from '../../types/comfy-graph'
import { topLevelFiles } from './experimental/batchFiles'
import { useModels } from '../../hooks/useModels'
import { takesWorkflowTags } from '../../lib/workflow-tag-models'
import {
  useWorkflowStore,
  workflowModelKey,
  type WorkflowTagMode,
} from '../../stores/workflowStore'
import { TagPicker } from '../workflows/TagPicker'
import { MissingNodePacks } from './MissingNodePacks'
import { Modal } from '../ui/Modal'
import { Button } from './ui/Button'
import { EmptyState } from './ui/EmptyState'
import { Segmented } from './ui/Segmented'
import { cn } from './ui/cn'

type PageTab = 'workflows' | 'models' | 'tags'
type ImportOutcome = { ok: true; message: string } | { ok: false; reason: string; missingNodeTypes?: string[] }
type FileResult = { file: string; ok: boolean; message: string }
type ModelFilter = 'all' | WorkflowTagMode

const TABS: Array<{ value: PageTab; label: string }> = [
  { value: 'workflows', label: 'Workflows' },
  { value: 'models', label: 'Models' },
  { value: 'tags', label: 'Tags' },
]

const INPUT =
  'h-[var(--control-h-md)] w-full px-2.5 t-control text-gray-200 placeholder:text-gray-600 ' +
  'rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] ' +
  'outline-none focus:border-white/20 transition-colors'

/** Workflow manager popup, opened from the Create composer. A centered
 *  dialog over the Create surface (2026-08-02: a window, not a page),
 *  on the same house Modal the VHS install prompt uses. */
export function WorkflowsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const uiText = useUiText()

  // Der eigene Escape-Listener ist entfallen: Modal schließt seit Welle 2 selbst
  // auf Escape, und zwar nur den OBERSTEN Dialog. Der Listener hier hing an
  // `window` und lief damit an jedem stopPropagation vorbei — er hätte beim
  // Abbrechen einer Tag-Umbenennung zusätzlich den ganzen Dialog geschlossen.
  return (
    <Modal open={open} onClose={onClose} title={uiText("Workflows & tags")} hideHeader maxWidth="max-w-2xl" panelPad="p-0">
      <WorkflowsModalInner />
    </Modal>
  )
}

function WorkflowsModalInner() {
  const uiText = useUiText()

  const [tab, setTab] = useState<PageTab>('workflows')

  const {
    installedWorkflows,
    tags,
    workflowTags,
    modelTags,
    installWorkflow,
    removeWorkflow,
    createTag,
    renameTag,
    deleteTag,
    setWorkflowTags,
    setModelTags,
  } = useWorkflowStore()

  const { models, fetchModels } = useModels()

  // Fill the model list from here as well, so the manager stands on its own
  // instead of depending on the Models view having refreshed first.
  useEffect(() => { fetchModels().catch(() => {}) }, [fetchModels])

  const [importName, setImportName] = useState('')
  const [importJson, setImportJson] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [importSuccess, setImportSuccess] = useState<string | null>(null)
  const [importBusy, setImportBusy] = useState(false)
  const [fileResults, setFileResults] = useState<FileResult[] | null>(null)
  // Node types the last import found missing in ComfyUI (GitHub wish #14):
  // the panel under the result offers the packs LU knows for them.
  const [missingTypes, setMissingTypes] = useState<string[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const [newTagName, setNewTagName] = useState('')
  const [editingTagId, setEditingTagId] = useState<string | null>(null)
  const [editingTagName, setEditingTagName] = useState('')

  const [modelSearch, setModelSearch] = useState('')
  const [modelFilter, setModelFilter] = useState<ModelFilter>('all')

  // Two-step delete, the same pattern the agent workflow list uses. A raw
  // window.confirm renders as an OS dialog that blocks the whole webview,
  // which is why it was taken out of the codex gate and the RAG panel.
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const armDelete = (id: string, remove: () => void) => {
    if (confirmId === id) {
      remove()
      setConfirmId(null)
      return
    }
    setConfirmId(id)
    setTimeout(() => setConfirmId((c) => (c === id ? null : c)), 3000)
  }

  const comfyModels = useMemo(() => {
    const query = modelSearch.trim().toLowerCase()
    return models
      .filter((model) => {
        if (model.type !== 'image' && model.type !== 'video') return false
        if (model.providerName !== 'ComfyUI') return false
        if (!takesWorkflowTags(model)) return false
        if (modelFilter !== 'all' && model.type !== modelFilter) return false
        if (query && !model.name.toLowerCase().includes(query)) return false
        return true
      })
      .sort((left, right) =>
        left.type !== right.type
          ? left.type.localeCompare(right.type)
          : left.name.localeCompare(right.name),
      )
  }, [models, modelFilter, modelSearch])

  // Re-importing under the same name updates in place, which also keeps the
  // tags that workflow already carries. Read from the store itself, so a
  // folder of files sees the ones installed a moment ago.
  const installGraph = (name: string, graph: ComfyApiGraph): 'installed' | 'updated' => {
    const parsed = parseImportedWorkflow(name, graph, 'manual')
    const existing = useWorkflowStore.getState().installedWorkflows.find(
      (workflow) =>
        workflow.source === 'manual' &&
        workflow.name.toLowerCase() === name.toLowerCase(),
    )
    installWorkflow({
      ...parsed,
      id: existing?.id ?? uuid(),
      installedAt: existing?.installedAt ?? Date.now(),
    })
    return existing ? 'updated' : 'installed'
  }

  const importOne = async (rawText: string, name: string): Promise<ImportOutcome> => {
    try {
      const read = await readWorkflowText(rawText)
      if (!read.ok) return read
      const verb = installGraph(name, read.graph) === 'updated' ? 'Updated' : 'Installed'
      const converted = read.format === 'ui'
        ? ` Converted from the regular ComfyUI format${read.notes.length ? ` (${read.notes.join(', ')})` : ''}.`
        : ''
      return { ok: true, message: `${verb} "${name}".${converted}` }
    } catch (error) {
      return { ok: false, reason: `Import failed: ${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const resetMessages = () => {
    setImportError(null)
    setImportSuccess(null)
    setFileResults(null)
    setMissingTypes([])
  }

  const importSingle = async (rawText: string, suggestedName?: string) => {
    resetMessages()
    setImportBusy(true)
    const name = importName.trim() || suggestedName?.trim() || 'Imported Workflow'
    const outcome = await importOne(rawText, name)
    setImportBusy(false)
    if (!outcome.ok) {
      setImportError(outcome.reason)
      setMissingTypes(outcome.missingNodeTypes ?? [])
      return false
    }
    setImportName('')
    setImportSuccess(outcome.message)
    return true
  }

  const fileBaseName = (file: File) => file.name.replace(/\.json$/i, '')

  // One file after the other, each with its own line: installed, updated or
  // the reason it was not.
  const importMany = async (files: File[]) => {
    resetMessages()
    setImportBusy(true)
    const results: FileResult[] = []
    const missing = new Set<string>()
    for (const file of files) {
      let outcome: ImportOutcome
      try {
        outcome = await importOne(await file.text(), fileBaseName(file))
      } catch (error) {
        outcome = { ok: false, reason: `Could not read that file: ${error instanceof Error ? error.message : String(error)}` }
      }
      results.push({ file: file.name, ok: outcome.ok, message: outcome.ok ? outcome.message : outcome.reason })
      if (!outcome.ok) for (const type of outcome.missingNodeTypes ?? []) missing.add(type)
      setFileResults([...results])
    }
    setMissingTypes([...missing].sort())
    setImportBusy(false)
  }

  const handleFileImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    if (files.length > 1) {
      await importMany(files)
      return
    }
    let rawText: string
    try {
      rawText = await files[0].text()
    } catch (error) {
      resetMessages()
      setImportError(uiText("Could not read that file: {v0}", { v0: error instanceof Error ? error.message : String(error) }))
      return
    }
    await importSingle(rawText, fileBaseName(files[0]))
  }

  const handleFolderImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = topLevelFiles(Array.from(event.target.files ?? []))
      .filter((file) => /\.json$/i.test(file.name))
      .sort((a, b) => a.name.localeCompare(b.name))
    event.target.value = ''
    if (files.length === 0) {
      resetMessages()
      setImportError(uiText("That folder has no .json files."))
      return
    }
    await importMany(files)
  }

  const handlePasteImport = async () => {
    if (await importSingle(importJson)) setImportJson('')
  }

  const handleCreateTag = () => {
    if (createTag(newTagName)) setNewTagName('')
  }

  const finishRenameTag = () => {
    if (!editingTagId) return
    renameTag(editingTagId, editingTagName)
    setEditingTagId(null)
    setEditingTagName('')
  }


  return (
    <div className="flex flex-col">
      {/* The Modal's floating X sits top-right, the help button right beside
          it; the tab switcher is centered on its own row so it never fights
          the title for the middle. */}

      <div className="px-5 pt-4 pb-3 border-b border-gray-200 dark:border-white/[0.06] space-y-3">
        <div className="flex items-center gap-2">
          <Workflow size={15} className="text-lu-accent shrink-0" />
          <span className="t-title text-gray-900 dark:text-gray-200">{uiText("Workflows & tags")}</span>
        </div>
        <div className="flex justify-center">
          <Segmented
            size="sm"
            layoutId="workflows-tab"
            value={tab}
            onChange={setTab}
            options={TABS}
            ariaLabel={uiText("Workflow manager section")}
          />
        </div>
      </div>

      <div className="max-h-[calc(62vh/var(--ui-scale))] overflow-y-auto scrollbar-thin">
        <div className="px-5 py-4">
          {tab === 'workflows' && (
            <div className="space-y-4">
              <section className="rounded-[var(--radius-panel)] bg-white/[0.03] border border-white/[0.06] p-4">
                <div className="flex items-center gap-1.5">
                  <Upload size={13} className="text-gray-500" />
                  <span className="t-label text-gray-400">{uiText("Install a workflow")}</span>
                </div>
                <p className="mt-1.5 t-body text-gray-500">{uiText("Import a ComfyUI workflow JSON, saved normally or with Save (API Format). A normal save is read through the running ComfyUI, so start it first.")}</p>

                <div className="mt-3 flex gap-2">
                  <div className="flex-1 min-w-0">
                    <input
                      value={importName}
                      onChange={(e) => setImportName(e.target.value)}
                      placeholder={uiText("Workflow name (optional)")}
                      className={INPUT}
                    />
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    multiple
                    onChange={handleFileImport}
                    className="hidden"
                    data-testid="workflow-files-input"
                  />
                  <input
                    ref={folderInputRef}
                    type="file"
                    multiple
                    onChange={handleFolderImport}
                    className="hidden"
                    data-testid="workflow-folder-input"
                    {...{ webkitdirectory: '' }}
                  />
                  <div className="shrink-0 whitespace-nowrap flex gap-2">
                    <Button
                      variant="secondary"
                      icon={FileJson}
                      disabled={importBusy}
                      onClick={() => fileInputRef.current?.click()}
                    >{uiText("Choose files")}</Button>
                    <Button
                      variant="secondary"
                      icon={FolderOpen}
                      disabled={importBusy}
                      onClick={() => folderInputRef.current?.click()}
                    >{uiText("Choose folder")}</Button>
                  </div>
                </div>

                <textarea
                  value={importJson}
                  onChange={(e) => setImportJson(e.target.value)}
                  placeholder={uiText("Or paste the workflow JSON here")}
                  className="mt-2 h-28 w-full resize-y px-2.5 py-2 t-mono text-gray-300 placeholder:text-gray-600 rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] outline-none focus:border-white/20 transition-colors scrollbar-thin"
                />
                <div className="mt-2">
                  <Button
                    variant="primary"
                    disabled={!importJson.trim() || importBusy}
                    onClick={() => void handlePasteImport()}
                  >
                    {importBusy ? uiText("Importing…") : uiText("Install pasted workflow")}
                  </Button>
                </div>

                {importError && (
                  <div className="mt-2.5 rounded-[var(--radius-control)] bg-red-500/10 border border-red-500/20 px-2.5 py-1.5 t-body text-red-300">
                    {importError}
                  </div>
                )}
                {importSuccess && (
                  <div className="mt-2.5 rounded-[var(--radius-control)] bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1.5 t-body text-emerald-300">
                    {importSuccess}
                  </div>
                )}
                {fileResults && (
                  <div className="mt-2.5 space-y-1" data-testid="workflow-import-results">
                    <p className="t-label text-gray-400">{uiText("Imported ")}{fileResults.filter((r) => r.ok).length}{uiText(" of ")}{fileResults.length}
                      {importBusy ? uiText(", reading the next file…") : ''}
                    </p>
                    {fileResults.map((result, i) => (
                      <div
                        key={`${result.file}-${i}`}
                        className={cn(
                          'flex gap-2 rounded-[var(--radius-control)] border px-2.5 py-1.5 t-body',
                          result.ok
                            ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                            : 'bg-red-500/10 border-red-500/20 text-red-300',
                        )}
                      >
                        {result.ok
                          ? <Check size={13} className="shrink-0 mt-0.5" />
                          : <X size={13} className="shrink-0 mt-0.5" />}
                        <span className="min-w-0 break-words">
                          <span className="font-medium">{result.file}</span>: {result.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {missingTypes.length > 0 && !importBusy && (
                  <MissingNodePacks key={missingTypes.join(',')} types={missingTypes} />
                )}
              </section>

              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Workflow size={13} className="text-gray-500" />
                  <span className="t-label text-gray-400">{uiText("Installed")}</span>
                  <span className="t-label text-gray-600">{installedWorkflows.length}</span>
                </div>

                {installedWorkflows.length === 0 ? (
                  <div className="py-12">
                    <EmptyState
                      icon={Workflow}
                      title={uiText("No workflows installed")}
                      description={uiText("Import a ComfyUI workflow above, then tag it so a model can find it.")}
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {installedWorkflows.map((workflow) => (
                      <article
                        key={workflow.id}
                        className="rounded-[var(--radius-panel)] bg-white/[0.03] border border-white/[0.06] p-3.5"
                      >
                        <div className="flex gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate t-title text-gray-200">{workflow.name}</span>
                              <Chip>{workflow.mode}</Chip>
                              <Chip>{workflow.source}</Chip>
                            </div>
                            {workflow.description && (
                              <p className="mt-1 line-clamp-2 t-body text-gray-500">
                                {workflow.description}
                              </p>
                            )}
                            <div className="mt-3">
                              <p className="mb-1.5 t-label text-gray-500">{uiText("Compatibility tags")}</p>
                              <TagPicker
                                tags={tags}
                                selectedIds={workflowTags[workflow.id] ?? []}
                                onChange={(tagIds) => setWorkflowTags(workflow.id, tagIds)}
                              />
                            </div>
                          </div>
                          <DeleteButton
                            armed={confirmId === workflow.id}
                            label={uiText("workflow")}
                            onClick={() => armDelete(workflow.id, () => removeWorkflow(workflow.id))}
                          />
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'models' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Search
                    size={13}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600"
                  />
                  <input
                    value={modelSearch}
                    onChange={(e) => setModelSearch(e.target.value)}
                    placeholder={uiText("Search installed models")}
                    className={cn(INPUT, 'pl-8')}
                  />
                </div>
                <Segmented
                  size="sm"
                  layoutId="workflows-model-filter"
                  value={modelFilter}
                  onChange={setModelFilter}
                  ariaLabel={uiText("Model kind")}
                  options={[
                    { value: 'all', label: uiText("All") },
                    { value: 'image', label: uiText("Image") },
                    { value: 'video', label: uiText("Video") },
                  ]}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  icon={RefreshCw}
                  iconOnly
                  title={uiText("Refresh the model list")}
                  onClick={() => void fetchModels()}
                />
              </div>

              {comfyModels.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={Search}
                    title={uiText("No ComfyUI models found")}
                    description={uiText("Make sure ComfyUI is running, then refresh.")}
                  />
                </div>
              ) : (
                <div className="space-y-2">
                  {comfyModels.map((model) => {
                    const mode = model.type as WorkflowTagMode
                    const key = workflowModelKey(model.name, mode)
                    return (
                      <article
                        key={key}
                        className="rounded-[var(--radius-panel)] bg-white/[0.03] border border-white/[0.06] p-3.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="min-w-0 flex-1 break-all t-title text-gray-200">
                            {model.name}
                          </span>
                          <Chip>{mode}</Chip>
                        </div>
                        <div className="mt-3">
                          <p className="mb-1.5 t-label text-gray-500">{uiText("Model tags")}</p>
                          <TagPicker
                            tags={tags}
                            selectedIds={modelTags[key] ?? []}
                            onChange={(tagIds) => setModelTags(model.name, mode, tagIds)}
                          />
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {tab === 'tags' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <div className="flex-1 min-w-0">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleCreateTag() }}
                    placeholder={uiText("New tag, for example Wan 2.2")}
                    className={INPUT}
                  />
                </div>
                <div className="shrink-0 whitespace-nowrap">
                  <Button
                    variant="primary"
                    icon={Plus}
                    disabled={!newTagName.trim()}
                    onClick={handleCreateTag}
                  >{uiText("Create")}</Button>
                </div>
              </div>

              {tags.length === 0 ? (
                <div className="py-12">
                  <EmptyState
                    icon={Tags}
                    title={uiText("No tags yet")}
                    description={uiText("A tag on a model and on a workflow is what pairs the two.")}
                  />
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tags.map((tag) => (
                    <div
                      key={tag.id}
                      className="flex items-center gap-2 rounded-[var(--radius-panel)] bg-white/[0.03] border border-white/[0.06] px-3 py-2"
                    >
                      {editingTagId === tag.id ? (
                        <>
                          <input
                            value={editingTagName}
                            onChange={(e) => setEditingTagName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') finishRenameTag()
                              if (e.key === 'Escape') {
                                // Escape bricht ERST das Umbenennen ab, nicht
                                // gleich den ganzen Dialog mit. Modal hört auf
                                // `document`; stopPropagation hält das Ereignis
                                // hier fest, sonst verlöre man zwei Ebenen auf
                                // einen Tastendruck.
                                e.stopPropagation()
                                setEditingTagId(null)
                              }
                            }}
                            autoFocus
                            className={INPUT}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Check}
                            iconOnly
                            title={uiText("Save")}
                            onClick={finishRenameTag}
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={X}
                            iconOnly
                            title={uiText("Cancel")}
                            onClick={() => setEditingTagId(null)}
                          />
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 flex-1 truncate t-body text-gray-200">
                            {tag.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={Pencil}
                            iconOnly
                            title={uiText("Rename")}
                            onClick={() => { setEditingTagId(tag.id); setEditingTagName(tag.name) }}
                          />
                          <DeleteButton
                            armed={confirmId === tag.id}
                            label={uiText("tag")}
                            onClick={() => armDelete(tag.id, () => deleteTag(tag.id))}
                          />
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}


function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="t-label text-gray-500 rounded bg-white/[0.06] px-1.5 py-0.5">{children}</span>
  )
}

function DeleteButton({
  armed,
  label,
  onClick,
}: {
  armed: boolean
  label: string
  onClick: () => void
}) {
  const uiText = useUiText()

  return (
    <Button
      variant={armed ? 'danger' : 'ghost'}
      size="sm"
      icon={Trash2}
      iconOnly
      onClick={onClick}
      title={armed ? uiText("Click again to remove this {v0}", { v0: label }) : uiText("Remove {v0}", { v0: label })}
    />
  )
}
