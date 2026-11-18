import { Modal } from '../ui/Modal'
import { SkillCategoryFilters } from './SkillCategoryFilters'
import { SKILL_CATEGORIES, skillCategoryFor, skillCategoryCounts, skillCategoryLabel, isSkillCategory, type SkillCategoryFilter, type SkillCategory } from '../../lib/skill-categories'
import { ConnectorSection } from './ConnectorSection'
import { GoogleConnector } from './GoogleConnector'
import { FacebookConnector } from './FacebookConnector'
import { InstagramConnector } from './InstagramConnector'
import { LinkedInConnector } from './LinkedInConnector'
import { YouTubeConnector } from './YouTubeConnector'
import { TikTokConnector } from './TikTokConnector'
import { useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Upload, Pencil, Trash2, BookOpen, Plug, Cable, Wrench, Store } from 'lucide-react'
import { LocalSkillsDiscovery } from './LocalSkillsDiscovery'
import { useUiText } from '../../lib/ui-text'
import { ReaInstallation } from './ReaInstallation'
import { OnlineMarketplace } from './OnlineMarketplace'
import { TelegramConnector } from './TelegramConnector'
import { WhatsappConnector } from './WhatsappConnector'
import { MetaWhatsappConnector } from './MetaWhatsappConnector'
import { useSkillStore } from '../../stores/skillStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useMCPStore } from '../../stores/mcpStore'
import { useComputerStore } from '../../stores/computerStore'
import { usePermissionStore } from '../../stores/permissionStore'
import { useUIStore } from '../../stores/uiStore'
import { SKILL_TEXT_LIMIT, SKILL_FILE_LIMIT, SKILL_TEMPLATES, parseSkillMarkdown, type StudioSkill } from '../../lib/skills'
import { toolRegistry } from '../../api/mcp'
import { isTauri } from '../../api/backend'
import { MCPServerSettings } from '../settings/MCPServerSettings'
import { ReaPluginRow } from '../chat/ReaPluginRow'
import { REA_PLUGIN } from '../../lib/plugins/rea'
import { useReaRuntime } from '../../lib/plugins/rea-runtime'

const TABS = [
  { id: 'skills', label: 'Skills', Icon: BookOpen },
  { id: 'plugins', label: 'Plugins', Icon: Plug },
  { id: 'connectors', label: 'Connectors', Icon: Cable },
  { id: 'tools', label: 'Tools', Icon: Wrench },
  { id: 'marketplace', label: 'Marketplace', Icon: Store },
] as const
type Tab = typeof TABS[number]['id']
const field = 'w-full rounded-lg border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel px-3 py-2 text-sm text-gray-900 dark:text-gray-100'
const button = 'studio-action inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50'
const panel = 'rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] p-4'

export function SkillsView() {
  const text = useUiText()
  const { skills, add, install, update, setEnabled, setCategory, remove } = useSkillStore()
  const { settings, updateSettings } = useSettingsStore()
  const { servers, connectedServers } = useMCPStore()
  useReaRuntime(s => s.phase)
  useComputerStore(s => s.enabled)
  const permissions = usePermissionStore(s => s.globalPermissions)
  const openSettings = useUIStore(s => s.openSettingsAt)
  const [tab, setTab] = useState<Tab>('skills')
  const [query, setQuery] = useState('')
  const [category, selectCategory] = useState<SkillCategoryFilter>('all')
  const [editCategory, setEditCategory] = useState<SkillCategory | 'auto'>('auto')
  const [readingId, setReadingId] = useState<string | null>(null)
  const reading = skills.find(skill => skill.id === readingId)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [instructions, setInstructions] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])
  // The MCP store changes when a server connects or its tools are refreshed.
  // The registry remains the source of truth, including dynamic native tools.
  const tools = toolRegistry.getAll()
  const externalServerCount = new Set(tools.filter(tool => tool.source === 'external' && tool.serverId).map(tool => tool.serverId)).size
  const needle = query.trim().toLocaleLowerCase()
  const matches = (...values: string[]) => !needle || values.some(value => value.toLocaleLowerCase().includes(needle))
  const skillName = (skill: StudioSkill) => {
    const template = SKILL_TEMPLATES.find(t => t.id === skill.templateId)
    return template?.name === skill.name ? text(skill.name) : skill.name
  }
  const act = (work: () => void) => {
    try { work(); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const edit = (skill?: StudioSkill) => {
    setEditing(skill?.id ?? null)
    setName(skill ? skillName(skill) : '')
    setInstructions(skill?.instructions ?? '')
    setEditCategory(skill?.category ?? 'auto')
    setError('')
  }
  const save = () => act(() => {
    let id = editing
    if (id) update(id, name, instructions)
    else id = add(name, instructions)
    setCategory(id, editCategory === 'auto' ? undefined : editCategory)
    setEditing(undefined)
  })
  const importFile = async (file?: File) => {
    if (!file) return
    try {
      if (!/\.md$/i.test(file.name) || file.size > SKILL_FILE_LIMIT) throw new Error('Escolha um arquivo Markdown de até 16 MB.')
      const input = parseSkillMarkdown(await file.text(), file.name)
      add(input.name, input.instructions)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    if (fileRef.current) fileRef.current.value = ''
  }
  const changeTab = (next: Tab) => { setTab(next); setQuery(''); setError(''); setPendingRemoval(null) }
  const onTabKey = (event: KeyboardEvent, index: number) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length
    else if (event.key === 'ArrowLeft') next = (index + TABS.length - 1) % TABS.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = TABS.length - 1
    else return
    event.preventDefault()
    changeTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }
  const installedMatches = skills.filter(s => matches(s.name, skillName(s), s.description || '', s.instructions))
  const installed = installedMatches.filter(skill => category === 'all' || skillCategoryFor(skill) === category)
  const availableSkills = <>
    <h2 className="text-base font-semibold">{text('Available skills')}</h2>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{SKILL_TEMPLATES.filter(t => matches(t.name, text(t.name), text(t.description)) && (category === 'all' || skillCategoryFor(t) === category)).map(template => {
      const present = skills.some(s => s.templateId === template.id)
      return <article key={template.id} className={`${panel} flex flex-col gap-3`}><h3 className="font-medium">{text(template.name)}</h3><p className="text-sm text-gray-500 dark:text-gray-400 flex-1">{text(template.description)}</p><button className={button} disabled={present} onClick={() => act(() => { install(template.id) })} aria-label={text('Install {v0}', { v0: text(template.name) })}>{present ? text('Skill installed') : text('Install')}</button></article>
    })}</div>
  </>

  return <div className="studio-form h-full overflow-auto text-gray-800 dark:text-gray-200">
    <div className="mx-auto max-w-5xl p-4 sm:p-6 space-y-5">
      <header className="flex flex-wrap justify-between items-start gap-3"><div className="space-y-1">
        <h1 className="text-xl font-semibold">{text('Skills and integrations')}</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">{text('Manage the instructions, plugins and tools available to your assistants.')}</p>
      </div><button className={button} onClick={() => changeTab('marketplace')}><Store size={15} />{text('Marketplace')}</button></header>
      <div role="tablist" aria-label={text('Capabilities')} className="flex flex-wrap gap-1 border-b border-gray-200 dark:border-white/10 pb-2">
        {TABS.map(({ id, label, Icon }, index) => <button key={id} ref={el => { tabRefs.current[index] = el }} role="tab" id={`cap-tab-${id}`} aria-controls={`cap-panel-${id}`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={e => onTabKey(e, index)} onClick={() => changeTab(id)} className={`${button} ${tab === id ? 'bg-lu-accent-soft border-lu-accent-edge dark:border-lu-accent text-gray-900 dark:text-white' : 'border-transparent'}`}><Icon size={15} />{text(label)}</button>)}
      </div>
      {error && <p role="alert" className="rounded-lg border border-red-400/40 p-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      <section role="tabpanel" id={`cap-panel-${tab}`} aria-labelledby={`cap-tab-${tab}`} className="space-y-4">
        {(tab === 'skills' || tab === 'tools' || tab === 'marketplace') && <input className={field} value={query} onChange={e => setQuery(e.target.value)} aria-label={text('Search capabilities')} placeholder={text('Search by name or description...')} />}
        {tab === 'skills' && <>
          <div className="flex flex-wrap items-center gap-2">
            <button className={button} onClick={() => edit()}><Plus size={15} />{text('New skill')}</button>
            <button className={button} onClick={() => fileRef.current?.click()}><Upload size={15} />{text('Import Markdown')}</button>
            <input type="file" accept=".md,text/markdown" className="sr-only" ref={fileRef} onChange={e => { void importFile(e.target.files?.[0]) }} aria-label={text('Import skill file')} />
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400">{text('Active skills guide new Chat, Agent and Code turns. Tool permissions and confirmations still apply.')} Na nuvem, o orçamento acompanha o contexto do modelo; no modo local, as instruções ativas usam até 32.000 caracteres. Se não couberem, o app avisa antes de enviar.</p>
          {editing !== undefined && <form className={`${panel} space-y-3`} onSubmit={e => { e.preventDefault(); save() }}>
            <label className="block text-sm">{text('Name')}<input className={`${field} mt-1`} value={name} onChange={e => setName(e.target.value)} maxLength={80} required /></label>
            <label className="block text-sm">Categoria<select aria-label="Categoria" className={`${field} mt-1`} value={editCategory} onChange={event => setEditCategory(isSkillCategory(event.target.value) ? event.target.value : 'auto')}><option value="auto">Automática</option>{SKILL_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="block text-sm">{text('Instructions')}<textarea className={`${field} mt-1 min-h-40`} value={instructions} onChange={e => setInstructions(e.target.value)} maxLength={SKILL_TEXT_LIMIT} required /></label>
            <div className="flex gap-2"><button className={button} type="submit">{text('Save')}</button><button className={button} type="button" onClick={() => setEditing(undefined)}>{text('Cancel')}</button></div>
          </form>}
          <h2 className="text-base font-semibold">{text('Installed skills')} · {skills.length}</h2>
          <p className="text-xs text-gray-500">{text('{v0} active · {v1} installed', { v0: skills.filter(skill => skill.enabled).length, v1: skills.length })}</p>
          {!installed.length && <p className="text-sm text-gray-500">{skills.length ? text('No matches') : text('No skills installed. Import your instructions or install a template below.')}</p>}
          <SkillCategoryFilters value={category} onChange={selectCategory} counts={skillCategoryCounts(installedMatches)} label="Categorias das habilidades instaladas" />
          <div className="grid gap-3 md:grid-cols-2">{installed.map(skill => <article key={skill.id} className="min-w-0 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/[0.02]" data-testid="installed-skill-card">
            <div className="flex items-start justify-between gap-2">
              <button type="button" onClick={() => setReadingId(skill.id)} className="min-w-0 text-left text-sm font-semibold hover:text-blue-500 break-words">{skillName(skill)}</button>
              <button role="switch" aria-checked={skill.enabled} aria-label={text('Activate {v0}', { v0: skillName(skill) })} title={skill.enabled ? 'Desativar habilidade' : 'Ativar habilidade'} className="inline-flex shrink-0 items-center gap-1.5 rounded px-1 py-0.5 text-[0.65rem] focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => act(() => setEnabled(skill.id, !skill.enabled))}>
                <span>{skill.enabled ? text('Skill active') : text('Inactive')}</span><span aria-hidden="true" className={`relative inline-block h-5 w-9 rounded-full ${skill.enabled ? 'bg-[#1f6feb]' : 'bg-gray-300 dark:bg-white/20'}`}><span className={`absolute left-0 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${skill.enabled ? 'translate-x-[18px]' : 'translate-x-[2px]'}`} /></span>
              </button>
            </div>
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-gray-500">{skill.description || skill.instructions.slice(0, 300)}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="mr-auto rounded-full bg-blue-500/10 px-2 py-0.5 text-[0.65rem] text-blue-600 dark:text-blue-400">{skillCategoryLabel(skillCategoryFor(skill))}</span>
              <button className="text-xs text-blue-500 hover:underline" onClick={() => setReadingId(skill.id)} aria-label={'Ler ' + skillName(skill)}>Ver detalhes</button>
              <button className="rounded p-1 text-gray-500 hover:bg-blue-500/10 hover:text-blue-500" onClick={() => edit(skill)} aria-label={text('Edit {v0}', { v0: skillName(skill) })} title={text('Edit')}><Pencil size={14} /></button>
              <button className="rounded p-1 text-red-500 hover:bg-red-500/10" onClick={() => pendingRemoval === skill.id ? act(() => { remove(skill.id); setPendingRemoval(null) }) : setPendingRemoval(skill.id)} aria-label={text('Remove {v0}', { v0: skillName(skill) })} title={text('Remove')}><Trash2 size={14} />{pendingRemoval === skill.id && <span className="ml-1 text-xs">{text('Confirm removal')}</span>}</button>
              {pendingRemoval === skill.id && <button className="text-xs text-gray-500" onClick={() => setPendingRemoval(null)}>{text('Cancel')}</button>}
            </div>
          </article>)}</div>
          <Modal open={!!reading} title={reading ? skillName(reading) : 'Habilidade'} onClose={() => setReadingId(null)} maxWidth="max-w-2xl">
            {reading && <div className="space-y-3">
              <p className="text-xs text-blue-500">{skillCategoryLabel(skillCategoryFor(reading))} · {reading.category ? 'Categoria definida por você' : 'Categoria automática'}</p>
              {reading.sourcePath && <p className="break-all text-xs text-gray-500">{reading.sourcePath}</p>}
              <div className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-100 p-3 text-sm leading-relaxed dark:bg-white/5">{reading.instructions}</div>
              <button role="switch" aria-checked={reading.enabled} aria-label={text('Activate {v0}', { v0: skillName(reading) })} onClick={() => act(() => setEnabled(reading.id, !reading.enabled))} className="rounded-lg bg-[#1f6feb] px-3 py-2 text-sm text-white">{reading.enabled ? 'Desativar habilidade' : 'Ativar habilidade'}</button>
              {error && <p role="alert" className="text-sm text-red-500">{error}</p>}
            </div>}
          </Modal>
          {availableSkills}
        </>}
        {tab === 'marketplace' && <><OnlineMarketplace query={query} onConfigureMcp={() => changeTab('connectors')} onManageSkills={() => changeTab('skills')} /><p className="text-sm text-gray-500">{text('Local catalog: ready-to-install skill templates and libraries found on your PC. Plugins, MCP connectors and registered tools remain available in their own tabs.')}</p>{availableSkills}</>}
        {tab === 'plugins' && <>
          <article className={panel}><h2 className="font-medium">{REA_PLUGIN.title}</h2><p className="text-xs text-gray-500 my-2">{REA_PLUGIN.version} · {REA_PLUGIN.license}</p>{isTauri() ? <ReaPluginRow /> : <p className="text-sm text-gray-500">{text('Plugin installation and execution require the desktop app.')}</p>}<ReaInstallation /></article>
          <article className={`${panel} space-y-3`}><h2 className="font-medium">{text('Caveman mode')}</h2><p className="text-sm text-gray-500">{text('Native response brevity control. No additional installation is needed.')}</p><label className="block text-sm">{text('Level')}<select className={`${field} mt-1`} value={settings.cavemanMode ?? 'off'} onChange={e => updateSettings({ cavemanMode: e.target.value as 'off' | 'lite' | 'full' | 'ultra' })}>{(['off', 'lite', 'full', 'ultra'] as const).map(level => <option key={level} value={level}>{text({ off: 'Off', lite: 'Lite', full: 'Full', ultra: 'Ultra' }[level])}</option>)}</select></label></article>
        </>}
        {tab === 'connectors' && <>
          <h2 className="text-base font-semibold">{text('Native integrations')}</h2>
          <TelegramConnector />
          <WhatsappConnector />
          <MetaWhatsappConnector />
          <GoogleConnector />
          <FacebookConnector />
          <InstagramConnector />
          <LinkedInConnector />
          <YouTubeConnector />
          <TikTokConnector />
          <ConnectorSection testId="mcp-connectors" title={text('MCP connectors')} status={text('{v0} configured · {v1} connected', { v0: servers.length, v1: connectedServers.length })}>
          <p className="text-sm text-gray-500 dark:text-gray-400">{text('Connect services through MCP servers. Configure the command and credentials required by your chosen server.')}</p>
          <MCPServerSettings />
          </ConnectorSection>
        </>}
        {tab === 'tools' && <>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-gray-500">{text('{v0} registered tools · {v1} external servers', { v0: tools.length, v1: externalServerCount })}</p><button className={button} onClick={() => openSettings({ tab: 'agent' })}>{text('Configure permissions')}</button></div>
          <div className="grid gap-3 md:grid-cols-2">{tools.filter(tool => matches(tool.name, tool.description, tool.source === 'builtin' ? text(tool.description) : '')).map(tool => <article key={`${tool.serverId ?? 'native'}:${tool.name}`} className={`${panel} space-y-2`}><h3 className="font-mono text-sm break-all">{tool.name}</h3><p className="text-sm text-gray-500 dark:text-gray-400 whitespace-pre-wrap">{tool.source === 'builtin' ? text(tool.description) : tool.description}</p><p className="text-xs text-gray-500">{tool.source === 'builtin' ? text('Native') : text('External')} · {text({ blocked: 'Blocked', confirm: 'Ask First', auto: 'Auto' }[permissions[tool.category]])}</p></article>)}</div>
        </>}
        {(tab === 'skills' || tab === 'marketplace') && <LocalSkillsDiscovery query={query} />}
      </section>
    </div>
  </div>
}
