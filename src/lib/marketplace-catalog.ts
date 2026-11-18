/** The Cline feed is external data, never installation instructions to execute. */
import { log } from './logger'
export const MARKETPLACE_URL = 'https://cline.github.io/marketplace/catalog.json'
export const MARKETPLACE_MAX_BYTES = 10 * 1024 * 1024
// The Cline catalog is small; Hermes' public plugin catalog legitimately holds thousands of entries,
// so it gets a much higher entry ceiling. The 10 MiB byte cap above still bounds every payload.
export const MARKETPLACE_MAX_ENTRIES = 2000
export const HERMES_MAX_ENTRIES = 50000
export const MARKETPLACE_FEEDS = {
  cline: MARKETPLACE_URL,
  'hermes-plugins': 'https://nousresearch.github.io/hermes-agent/docs/api/plugin-catalog.json',
  'hermes-bundled-skills': 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/skills-catalog.md',
  'hermes-optional-skills': 'https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/reference/optional-skills-catalog.md',
} as const
export type MarketplaceSource = 'cline' | 'hermes'
export type MarketplaceFeed = keyof typeof MARKETPLACE_FEEDS
export type MarketplaceType = 'skill' | 'mcp' | 'plugin'
export interface MarketplaceEntry {
  source: MarketplaceSource
  id: string
  type: MarketplaceType
  name: string
  description: string
  author: string
  tags: string[]
  license: string
  verified: boolean
  homepage: string | null
  repo: string | null
  installArgs: string[]
  tier: 'official' | 'verified' | 'community' | 'listed'
  revision: string
  requiresHost: string
}
export interface MarketplaceCatalog { version: 1; generatedAt: string; entries: MarketplaceEntry[] }

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown, max: number): string => typeof value === 'string' ? [...value].filter(char => {
  const code = char.charCodeAt(0)
  return (code >= 32 && code !== 127) || code === 9 || code === 10
}).join('').trim().slice(0, max) : ''

export function marketplaceLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /\s/.test(value) || [...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || url.hostname.includes(':')
      || /^(?:\d+\.){3}\d+$/.test(url.hostname)
      || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname)
      || url.hostname.endsWith('.localhost') || url.hostname.endsWith('.local')) return null
    return url.href
  } catch { return null }
}

export function parseMarketplaceCatalog(value: unknown, source: MarketplaceSource = 'cline'): MarketplaceCatalog {
  const maxEntries = source === 'hermes' ? HERMES_MAX_ENTRIES : MARKETPLACE_MAX_ENTRIES
  if (!record(value) || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > maxEntries
    || typeof value.generatedAt !== 'string' || value.generatedAt.length > 64 || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('Invalid marketplace catalog.')
  const entries: MarketplaceEntry[] = []
  const ids = new Set<string>()
  for (const raw of value.entries) {
    if (!record(raw) || !['skill', 'mcp', 'plugin'].includes(String(raw.type))) continue
    const type = raw.type as MarketplaceType, id = text(raw.id, 160), name = text(raw.name, 160)
    const key = `${type}:${id}`
    if (!id || !name || ids.has(key)) continue
    ids.add(key)
    const install = record(raw.install) ? raw.install : {}
    const tier = ['official', 'verified', 'community'].includes(String(raw.tier)) ? raw.tier as MarketplaceEntry['tier'] : 'listed'
    entries.push({ source, id, type, name, description: text(raw.description || raw.tagline, 8000),
      author: record(raw.author) ? text(raw.author.name, 160) : '',
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 20).map(v => text(v, 80)).filter(Boolean) : [],
      license: text(raw.license, 160), verified: source === 'hermes' ? tier === 'verified' : raw.verified === true,
      tier: source === 'hermes' ? tier : 'listed',
      revision: typeof raw.revision === 'string' && /^[a-f0-9]{40}$/.test(raw.revision) ? raw.revision : '',
      requiresHost: text(raw.requiresHost, 80),
      homepage: marketplaceLink(raw.homepage), repo: marketplaceLink(raw.repo),
      installArgs: Array.isArray(install.args) && install.args.length <= 100 && install.args.every(v => typeof v === 'string' && v.length <= 4096)
        ? install.args as string[] : [],
    })
  }
  if (value.entries.length && !entries.length) throw new Error('Invalid marketplace catalog.')
  return { version: 1, generatedAt: value.generatedAt, entries }
}

/** State the required integration, without claiming an untested entry works. */
export function marketplaceCompatibility(entry: MarketplaceEntry): 'instructions' | 'stdio' | 'remote' | 'adaptation' | 'hermes-adaptation' | 'manual' {
  if (entry.type === 'skill') return 'instructions'
  if (entry.type === 'plugin') return entry.source === 'hermes' ? 'hermes-adaptation' : 'adaptation'
  const args = entry.installArgs
  if (args.includes('--transport')) return 'remote'
  const separator = args.indexOf('--')
  return separator >= 0 && ['npx', 'uvx'].includes(args[separator + 1]) ? 'stdio' : 'manual'
}

/** Hermes publishes plugin JSON and two small official Markdown skill indexes. */
export function parseHermesCatalog(plugins: unknown, bundled: string, optional: string): MarketplaceCatalog {
  if (!record(plugins) || !Array.isArray(plugins.entries)) throw new Error('Invalid Hermes catalog.')
  if (plugins.entries.length > HERMES_MAX_ENTRIES) throw new Error('Invalid Hermes catalog.')
  const removed = Array.isArray(plugins.removed) ? plugins.removed : []
  const removedNames = new Set(removed.filter(record).map(item => text(item.name, 160)).filter(Boolean))
  const removedRepos = new Set(removed.filter(record).map(item => marketplaceLink(item.repo)).filter(Boolean))
  const entries: Record<string, unknown>[] = []
  let rejected = 0
  let rejectedNoSha = 0
  let rejectedBadSha = 0
  let rejectedNoRepo = 0
  let rejectedNoId = 0
  for (const raw of plugins.entries) {
    if (!record(raw)) { rejected++; continue }
    const id = text(raw.name, 160), repo = marketplaceLink(raw.repo)
    if (!id) { rejectedNoId++; rejected++; continue }
    if (!repo) { rejectedNoRepo++; rejected++; continue }
    if (removedNames.has(id) || removedRepos.has(repo)) { rejected++; continue }
    if (typeof raw.sha !== 'string') { rejectedNoSha++; rejected++; continue }
    const sha = raw.sha.toLowerCase()
    if (!/^[a-f0-9]+$/.test(sha)) { rejectedBadSha++; rejected++; continue }
    entries.push({ id, type: 'plugin', name: raw.title || raw.name, description: raw.description,
      author: { name: raw.maintainer }, repo, homepage: raw.docs_url, license: raw.license,
      tags: [raw.category, ...(Array.isArray(raw.platforms) ? raw.platforms : [])], tier: raw.tier,
      revision: sha, requiresHost: raw.requires_hermes,
    })
  }
  log.warn('[marketplace] Hermes plugin catalog parsed', { total: plugins.entries.length, accepted: entries.length, rejected, rejectedNoId, rejectedNoRepo, rejectedNoSha, rejectedBadSha })
  for (const [kind, markdown] of [['bundled', bundled], ['optional', optional]] as const) {
    if (markdown.length > MARKETPLACE_MAX_BYTES) throw new Error('Invalid Hermes skills index.')
    let category = '', count = 0
    for (const line of markdown.split('\n')) {
      const heading = /^## ([a-z0-9_/-]+)\s*$/.exec(line)
      if (heading) category = heading[1]
      const row = /^\|\s*\[(?:`([^`]+)`|\*\*([^*]+)\*\*)\]\(([^)]+)\)\s*\|\s*(.*?)\s*\|(?:\s*`([^`]+)`\s*\|)?\s*$/.exec(line)
      if (!row) continue
      const name = row[1] || row[2], relative = row[3]
      if (!/^[a-z0-9_-]+$/.test(name) || !category || category.includes('..')
        || !new RegExp(`^\\.\\./user-guide/skills/${kind}/[a-z0-9_/-]+\\.md$`).test(relative)) continue
      const path = row[5] || `${category}/${name}`
      if (!/^[a-z0-9_/-]+$/.test(path) || path.includes('..')) continue
      entries.push({ id: `${kind}/${path}`, type: 'skill', name, description: row[4].replace(/\\\|/g, '|'),
        author: { name: 'Nous Research' }, tier: 'official', tags: [category, kind],
        homepage: new URL(relative.replace(/\.md$/, ''), 'https://hermes-agent.nousresearch.com/docs/reference/catalog').href,
        repo: `https://github.com/NousResearch/hermes-agent/tree/main/${kind === 'bundled' ? 'skills' : 'optional-skills'}/${path}`,
      })
      count++
      if (count > 1000) throw new Error('Invalid Hermes skills index.')
    }
    if (!count) throw new Error('Invalid Hermes skills index.')
  }
  if (!entries.length) {
    throw new Error(`Invalid Hermes catalog: ${plugins.entries.length} entries rejected (noId=${rejectedNoId}, noRepo=${rejectedNoRepo}, noSha=${rejectedNoSha}, badSha=${rejectedBadSha})`)
  }
  return parseMarketplaceCatalog({ version: 1, generatedAt: plugins.generated_at, entries }, 'hermes')
}
