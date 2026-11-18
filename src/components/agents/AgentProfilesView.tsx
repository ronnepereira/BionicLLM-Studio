import { useState } from 'react'
import { Plus, Bot, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { useUiText } from '../../lib/ui-text'
import { useAgentProfileStore } from '../../stores/agentProfileStore'
import { useModelStore } from '../../stores/modelStore'
import { useUIStore } from '../../stores/uiStore'
import { openAgentConversation } from '../../lib/open-agent-conversation'
import { displayModelName } from '../../api/providers/model-name'
import { type StudioAgentProfile } from '../../lib/agent-profiles'

const field = 'w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm text-gray-900 dark:text-gray-100'
const button = 'studio-action inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5'

export function AgentProfilesView() {
  const text = useUiText()
  const { profiles, add, update, remove } = useAgentProfileStore()
  const models = useModelStore(s => s.models)
  const setView = useUIStore(s => s.setView)
  const openSettings = useUIStore(s => s.openSettingsAt)
  const [editing, setEditing] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState(false)
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const chatModels = models.filter(entry => entry.provider !== 'lu-cloud' && entry.type !== 'image' && entry.type !== 'video')
  const act = (work: () => void) => { try { work(); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) } }
  const deleteProfile = async (id: string) => {
    if (removing) return
    setRemoving(true)
    try { await remove(id); setPendingRemoval(null); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setRemoving(false) }
  }
  const edit = (profile?: StudioAgentProfile) => {
    setEditing(profile?.id ?? null); setName(profile?.name ?? '')
    setInstructions(profile?.instructions ?? ''); setModel(profile?.model ?? '')
    setError(''); setPendingRemoval(null)
  }
  const save = () => act(() => {
    if (editing) update(editing, name, instructions, model)
    else add(name, instructions, model)
    setEditing(undefined)
  })

  return <div className="studio-form h-full overflow-auto text-gray-800 dark:text-gray-200">
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold">{text('Dedicated agents')}</h1><p className="text-sm text-gray-500 mt-1">{text('Create agents with their own instructions and preferred model.')}</p></div>
        <button className={button} onClick={() => edit()}><Plus size={15} />{text('New agent')}</button>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400">{text('Each new agent conversation uses an isolated workspace. Existing tool permissions and confirmations remain in effect.')}</p>
      <div className="flex flex-wrap gap-2"><button className={button} onClick={() => setView('skills')}>{text('Manage skills')}</button><button className={button} onClick={() => openSettings({ tab: 'agent' })}>{text('Configure permissions')}</button></div>
      {error && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      {editing !== undefined && <form className="rounded-xl border border-gray-200 dark:border-white/10 p-4 space-y-3" onSubmit={e => { e.preventDefault(); save() }}>
        <label className="block text-sm">{text('Agent name')}<input className={`${field} mt-1`} value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
        <label className="block text-sm">{text('Preferred model')}<select className={`${field} mt-1`} value={model} onChange={e => setModel(e.target.value)}><option value="">{text('Use the currently selected model')}</option>{model && !chatModels.some(entry => entry.name === model) && <option value={model}>{displayModelName(model)} · {text('Not available right now')}</option>}{chatModels.map(entry => <option key={entry.name} value={entry.name}>{displayModelName(entry.name)}</option>)}</select></label>
        <label className="block text-sm">{text('Agent instructions')}<textarea className={`${field} mt-1 min-h-48`} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={16_000} placeholder={text('Describe the role, the tasks and the expected result.')} required /></label>
        <p className="text-xs text-gray-500">{text('Changes apply to new conversations. Existing conversations keep their original instructions.')}</p>
        <div className="flex gap-2"><button type="submit" className={button}>{text('Save agent')}</button><button type="button" className={button} onClick={() => setEditing(undefined)}>{text('Cancel')}</button></div>
      </form>}
      {!profiles.length && editing === undefined && <div className="rounded-xl border border-dashed border-gray-300 dark:border-white/15 p-8 text-center space-y-2"><Bot className="mx-auto text-gray-500" size={28} /><p className="text-sm text-gray-500">{text('No agents yet. Create one for research, writing, code or another task.')}</p></div>}
      <div className="grid gap-4 md:grid-cols-2">{profiles.map(profile => <article key={profile.id} className="rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] p-4 space-y-3">
        <h2 className="font-semibold break-words">{profile.name}</h2>
        <p className="text-xs text-gray-500 break-all">{profile.model ? displayModelName(profile.model) : text('Use the currently selected model')}</p>
        <p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap line-clamp-4">{profile.instructions}</p>
        <div className="flex flex-wrap gap-2">
          <button className={button} onClick={() => act(() => { openAgentConversation(profile) })} aria-label={text('Open conversation with {v0}', { v0: profile.name })}><MessageSquare size={14} />{text('New conversation')}</button>
          <button className={button} onClick={() => edit(profile)} aria-label={text('Edit {v0}', { v0: profile.name })}><Pencil size={14} />{text('Edit')}</button>
          <button className={button} disabled={removing} onClick={() => pendingRemoval === profile.id ? void deleteProfile(profile.id) : setPendingRemoval(profile.id)} aria-label={text('Remove {v0}', { v0: profile.name })}><Trash2 size={14} />{pendingRemoval === profile.id ? text('Confirm removal') : text('Remove')}</button>
          {pendingRemoval === profile.id && <button className={button} onClick={() => setPendingRemoval(null)}>{text('Cancel')}</button>}
        </div>
        {pendingRemoval === profile.id && <p className="text-xs text-gray-500">{text('This agent and its linked schedules will be removed. Running scheduled tasks will be cancelled. Conversations are preserved.')}</p>}
      </article>)}</div>
    </div>
  </div>
}
