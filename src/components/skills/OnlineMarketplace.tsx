import { useEffect, useState } from 'react'
import { BookOpen, Cable, Plug, ExternalLink, RefreshCw, BadgeCheck, ChevronLeft, ChevronRight } from 'lucide-react'
import { useMarketplaceStore } from '../../stores/marketplaceStore'
import { marketplaceCompatibility, type MarketplaceType, type MarketplaceSource } from '../../lib/marketplace-catalog'
import { openExternal } from '../../api/backend'
import { useUiText } from '../../lib/ui-text'
import { useSettingsStore } from '../../stores/settingsStore'

const PAGE_SIZE = 12
const typeLabel = { skill: 'Skills', mcp: 'MCP servers', plugin: 'Plugins' } as const
const compatibilityLabel = { instructions: 'Review SKILL.md', stdio: 'Manual MCP configuration', remote: 'HTTP transport not supported yet', adaptation: 'Requires Cline adaptation', 'hermes-adaptation': 'Review Hermes integration', manual: 'Review setup documentation' } as const
const compatibilityNote = {
  instructions: 'Instructions can be reviewed and imported as Markdown. Supporting scripts and tools may require separate setup.',
  stdio: 'Configure the command, arguments and credentials in Connectors. Availability depends on the server and its requirements.',
  remote: 'This item uses a remote transport that BionicLLM does not support yet.',
  adaptation: 'This plugin depends on Cline features and cannot be installed directly in BionicLLM.',
  'hermes-adaptation': 'This package is distributed for Hermes and is not installed automatically in BionicLLM. Review its tools, MCP configuration, hooks and Desktop features; adaptation may be needed.',
  manual: 'This installation format needs manual review before it can be configured in BionicLLM.',
} as const
const button = 'inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 dark:border-white/15 px-3 py-2 text-sm hover:bg-gray-100 dark:hover:bg-white/5 disabled:opacity-50'

export function OnlineMarketplace({ query, onConfigureMcp, onManageSkills }: { query: string; onConfigureMcp: () => void; onManageSkills: () => void }) {
  const text = useUiText()
  const language = useSettingsStore(state => state.settings.language)
  const { sources, refresh } = useMarketplaceStore()
  const [origin, setOrigin] = useState<MarketplaceSource | 'all'>('all')
  const [kind, setKind] = useState<MarketplaceType | 'all'>('all')
  const [paging, setPaging] = useState({ query, page: 0 })
  const [linkError, setLinkError] = useState(false)
  useEffect(() => { void refresh() }, [refresh])
  const needle = query.trim().toLocaleLowerCase()
  const origins = (['cline', 'hermes'] as const).filter(source => origin === 'all' || source === origin)
  const catalogEntries = origins.flatMap(source => sources[source].catalog?.entries ?? [])
  const loading = origins.some(source => sources[source].loading)
  const hasCatalog = origins.some(source => sources[source].catalog)
  const entries = catalogEntries.filter(entry => (kind === 'all' || entry.type === kind)
    && (!needle || [entry.name, entry.description, entry.author, entry.source, ...entry.tags].some(value => value.toLocaleLowerCase().includes(needle))))
  const pages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE))
  const current = Math.min(paging.query === query ? paging.page : 0, pages - 1)
  const setPage = (page: number) => setPaging({ query, page })
  const chooseKind = (next: MarketplaceType | 'all') => { setKind(next); setPage(0) }
  const chooseOrigin = (next: MarketplaceSource | 'all') => { setOrigin(next); setPage(0) }
  const open = async (url: string) => {
    setLinkError(false)
    try { await openExternal(url) } catch { setLinkError(true) }
  }

  return <section aria-label={text('Online catalogs')} className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h2 className="text-lg font-semibold">{text('Online catalogs')} · Cline + Hermes</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">{text('Browse public skills, MCP servers and plugins. Catalog verification does not guarantee BionicLLM compatibility.')}</p>
        <p className="text-xs text-gray-500">{text('Names and descriptions are provided by their authors in the original language. No catalog installation commands run automatically.')}</p>
      </div>
      <button className={button} disabled={loading} onClick={() => void refresh(true, origin === 'all' ? undefined : origin)}><RefreshCw size={14} className={loading ? 'animate-spin' : ''} />{text('Refresh catalog')}</button>
    </div>
    {loading && <p role="status" className="text-sm text-gray-500">{text('Loading online catalog…')}</p>}
    {origins.filter(source => sources[source].error).map(source => <p key={source} role="alert" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-300"><strong>{source === 'cline' ? 'Cline' : 'Hermes'}: </strong>{sources[source].catalog ? text('The online catalog is unavailable. Showing the last saved list; use Refresh catalog to try again.') : sources[source].errorMessage ? text('{v0}: {v1}', { v0: source === 'cline' ? 'Cline' : 'Hermes', v1: sources[source].errorMessage }) : text('The online catalog is unavailable. You can retry or continue using local skills below.')}</p>)}
    {linkError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{text('Could not open the project page.')}</p>}
    <div role="group" aria-label={text('Filter catalog by source')} className="flex flex-wrap gap-2">{(['all', 'cline', 'hermes'] as const).map(source => <button key={source} className={`${button} ${origin === source ? 'bg-lu-accent-soft ring-1 ring-lu-accent-edge' : ''}`} aria-pressed={origin === source} onClick={() => chooseOrigin(source)}>{source === 'all' ? text('All sources') : source === 'cline' ? 'Cline' : 'Hermes'}</button>)}</div>
    <p className="text-xs text-gray-500">{text('Hermes includes its plugin catalog and official bundled/optional skills. External skills aggregated by Hermes remain available in its full hub.')}</p>
    {hasCatalog && <>
      <div className="space-y-1 text-xs text-gray-500"><p>{text('{v0} catalog items', { v0: catalogEntries.length })}</p>{origins.map(source => {
        const { catalog, fetchedAt } = sources[source]
        return catalog && <p key={source}>{source === 'cline' ? 'Cline' : 'Hermes'} · {catalog.entries.length} · {text(source === 'hermes' ? 'Plugin catalog published: {v0}' : 'Catalog published: {v0}', { v0: new Date(catalog.generatedAt).toLocaleDateString(language === 'en' ? 'en-US' : 'pt-BR') })} · {text('Last retrieved: {v0}', { v0: new Date(fetchedAt).toLocaleString(language === 'en' ? 'en-US' : 'pt-BR') })}</p>
      })}</div>
      <div role="group" aria-label={text('Filter catalog by type')} className="flex flex-wrap gap-2">
        {(['all', 'skill', 'mcp', 'plugin'] as const).map(value => <button key={value} aria-pressed={kind === value} className={`${button} ${kind === value ? 'bg-lu-accent-soft ring-1 ring-lu-accent-edge' : ''}`} onClick={() => chooseKind(value)}>{text(value === 'all' ? 'All items' : typeLabel[value])} <span className="text-xs text-gray-500">{value === 'all' ? catalogEntries.length : catalogEntries.filter(entry => entry.type === value).length}</span></button>)}
      </div>
      <p role="status" className="text-xs text-gray-500">{text('{v0} results', { v0: entries.length })}</p>
      <div className="grid gap-3 md:grid-cols-2">
        {entries.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE).map(entry => {
          const compatibility = marketplaceCompatibility(entry)
          const Icon = { skill: BookOpen, mcp: Cable, plugin: Plug }[entry.type]
          const url = entry.homepage ?? entry.repo
          return <article key={`${entry.source}:${entry.type}:${entry.id}`} className="flex min-w-0 flex-col gap-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.02] p-4">
            <div className="flex items-start gap-2"><Icon size={17} aria-hidden="true" className="mt-0.5 shrink-0 text-lu-accent-ink dark:text-lu-accent-text" /><div className="min-w-0 flex-1"><h3 className="font-semibold break-words">{entry.name}</h3><p className="text-xs text-gray-500">{text(typeLabel[entry.type])}{entry.author && ` · ${entry.author}`}</p></div>{entry.verified && <span title={text(entry.source === 'hermes' ? 'Marked as verified by the Hermes catalog' : 'Marked as verified by the Cline catalog')} className="inline-flex shrink-0 items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400"><BadgeCheck size={14} />{text('Catalog verified')}</span>}</div>
            <p className="text-xs text-gray-500">{text('Source')}: {entry.source === 'hermes' ? 'Hermes' : 'Cline'}{entry.source === 'hermes' && ` · ${text({ official: 'Official catalog item', verified: 'Verified catalog item', community: 'Community catalog item', listed: 'Listed catalog item' }[entry.tier])}`}</p>
            <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-3 break-words">{entry.description}</p>
            <p className="text-xs font-medium text-lu-accent-ink dark:text-lu-accent-text">{text(compatibilityLabel[compatibility])}</p>
            <details className="text-sm text-gray-500 dark:text-gray-400"><summary className="cursor-pointer">{text('Compatibility and details')}</summary><div className="mt-2 space-y-2 break-words"><p>{text(compatibilityNote[compatibility])}</p><p>{entry.description}</p>{entry.license && <p>{text('License')}: {entry.license}</p>}{entry.tags.length > 0 && <p>{entry.tags.join(' · ')}</p>}{entry.requiresHost && <p>{text('Requires Hermes {v0}', { v0: entry.requiresHost })}</p>}{entry.revision && <p className="font-mono text-xs">{text('Catalog revision')}: {entry.revision}</p>}{entry.installArgs.length > 0 && <><p>{text('Cline installation arguments (reference only)')}</p><pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-black/5 dark:bg-white/5 p-2 text-xs">{JSON.stringify(entry.installArgs, null, 2)}</pre></>}</div></details>
            <div className="mt-auto flex flex-wrap gap-2">{url && <button className={button} onClick={() => void open(url)} aria-label={text('View source for {v0}', { v0: entry.name })}><ExternalLink size={13} />{text('View project')}</button>}{compatibility === 'stdio' && <button className={button} onClick={onConfigureMcp}>{text('Configure MCP manually')}</button>}</div>
          </article>
        })}
      </div>
      {!entries.length && <p className="py-4 text-sm text-gray-500">{text('No catalog items match this search.')}</p>}
      {pages > 1 && <nav aria-label={text('Catalog pages')} className="flex flex-wrap items-center justify-center gap-3"><button className={button} disabled={current === 0} onClick={() => setPage(current - 1)}><ChevronLeft size={14} />{text('Previous page')}</button><span className="text-sm">{text('Page {v0} of {v1}', { v0: current + 1, v1: pages })}</span><button className={button} disabled={current === pages - 1} onClick={() => setPage(current + 1)}>{text('Next page')}<ChevronRight size={14} /></button></nav>}
    </>}
    <div className="flex flex-wrap gap-2 border-b border-gray-200 dark:border-white/10 pb-4"><button className={button} onClick={onManageSkills}>{text('Manage my skills')}</button><button className={button} onClick={() => void open('https://github.com/cline/marketplace')}><ExternalLink size={13} />{text('Catalog source and license')} · Cline</button><button className={button} onClick={() => void open('https://github.com/NousResearch/hermes-agent/tree/main/plugin-catalog')}><ExternalLink size={13} />{text('Catalog source and license')} · Hermes</button><button className={button} onClick={() => void open('https://hermes-agent.nousresearch.com/docs/skills')}><ExternalLink size={13} />{text('Full Hermes skills hub')}</button></div>
  </section>
}
