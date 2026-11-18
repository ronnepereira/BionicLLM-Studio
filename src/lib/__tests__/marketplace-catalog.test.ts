import { describe, it, expect } from 'vitest'
import { marketplaceLink, parseMarketplaceCatalog, parseHermesCatalog, marketplaceCompatibility } from '../marketplace-catalog'

const raw = { id: 'example', type: 'mcp', name: 'Example', description: 'A server', verified: true, author: { name: 'Author' }, tags: ['tools'], homepage: 'https://example.com', repo: 'https://github.com/author/example', install: { args: ['example', '--', 'npx', '-y', '@author/server'], command: 'DO NOT EXECUTE' } }
const catalog = (entries: unknown[] = [raw]) => ({ version: 1, generatedAt: '2026-09-18T20:15:28Z', entries })

describe('external catalog boundary', () => {
  it('normalizes external data and never retains an executable command string', () => {
    const entry = parseMarketplaceCatalog(catalog()).entries[0]
    expect(entry.author).toBe('Author')
    expect(entry.verified).toBe(true)
    expect(entry).not.toHaveProperty('install')
    expect(JSON.stringify(entry)).not.toContain('DO NOT EXECUTE')
    expect(marketplaceCompatibility(entry)).toBe('stdio')
  })
  it('rejects invalid versions, timestamps and excessive inventories', () => {
    for (const value of [null, {}, { ...catalog(), version: 2 }, { ...catalog(), generatedAt: 'garbage' }, catalog(Array(2001).fill(raw))]) expect(() => parseMarketplaceCatalog(value)).toThrow()
  })
  it('skips unusable entries and duplicates, and treats verification strictly', () => {
    const result = parseMarketplaceCatalog(catalog([raw, raw, { ...raw, type: 'unknown' }, { ...raw, id: 'second', verified: 'true', homepage: 'javascript:alert(1)' }]))
    expect(result.entries).toHaveLength(2)
    expect(result.entries[1].verified).toBe(false)
    expect(result.entries[1].homepage).toBeNull()
    expect(() => parseMarketplaceCatalog(catalog([{ ...raw, name: '' }]))).toThrow()
  })
  it('states actual integration requirements without promising compatibility', () => {
    const entry = parseMarketplaceCatalog(catalog()).entries[0]
    expect(marketplaceCompatibility({ ...entry, type: 'skill' })).toBe('instructions')
    expect(marketplaceCompatibility({ ...entry, type: 'plugin' })).toBe('adaptation')
    expect(marketplaceCompatibility({ ...entry, installArgs: ['x', '--transport', 'http', 'https://example.com/mcp'] })).toBe('remote')
    expect(marketplaceCompatibility({ ...entry, installArgs: ['x'] })).toBe('manual')
  })
  it('never opens script, credential, app or local addresses from the feed', () => {
    for (const url of ['javascript:alert(1)', 'file:///a', 'http://example.com', 'https://user:secret@example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://10.1.1.1', 'https://example.com:8443', 'https://exa\nmple.com']) expect(marketplaceLink(url)).toBeNull()
    expect(marketplaceLink('https://github.com/cline/skills')).toBe('https://github.com/cline/skills')
  })
})

const bundled = '## tools\n| [`example`](../user-guide/skills/bundled/tools/tools-example.md) | Uses a script. | `tools/example` |'
const optional = '## writing\n| [**example**](../user-guide/skills/optional/writing/writing-example.md) | Helps with writing. |'
const hermes = (entries: unknown[], removed: unknown[] = []) => ({ generated_at: '2026-11-02T20:00:00Z', entries, removed })
const plugin = { name: 'example', title: 'Example plugin', repo: 'https://github.com/author/plugin', sha: 'a'.repeat(40), tier: 'community', requires_hermes: '>=0.21.5', description: 'A Hermes plugin', verified: true }
describe('Hermes catalog adapter', () => {
  it('keeps origin, pinned revision and Hermes-specific compatibility without endorsing community items', () => {
    const result = parseHermesCatalog(hermes([plugin]), bundled, optional)
    expect(result.entries).toHaveLength(3)
    expect(result.entries.every(entry => entry.source === 'hermes')).toBe(true)
    expect(result.entries[0]).toMatchObject({ revision: 'a'.repeat(40), requiresHost: '>=0.21.5', verified: false, tier: 'community' })
    expect(marketplaceCompatibility(result.entries[0])).toBe('hermes-adaptation')
    expect(result.entries[1].id).not.toBe(result.entries[2].id)
    expect(result.entries[2].homepage).toBe('https://hermes-agent.nousresearch.com/docs/user-guide/skills/optional/writing/writing-example')
  })
  it('honors removals and rejects unpinned plugin entries', () => {
    const result = parseHermesCatalog(hermes([plugin, { ...plugin, name: 'other', sha: 'main' }], [{ name: 'example' }]), bundled, optional)
    expect(result.entries.every(entry => entry.type === 'skill')).toBe(true)
    const byRepo = parseHermesCatalog(hermes([plugin], [{ repo: plugin.repo }]), bundled, optional)
    expect(byRepo.entries.every(entry => entry.type === 'skill')).toBe(true)
  })
  it('does not evaluate Markdown or accept a changed index as an empty valid catalog', () => {
    expect(() => parseHermesCatalog(hermes([]), 'Run this command instead', optional)).toThrow()
    const injected = bundled + '\n| [`evil`](javascript:alert) | Execute something. | `../evil` |'
    expect(parseHermesCatalog(hermes([]), injected, optional).entries).toHaveLength(2)
  })
  it('preserves official versus verified tiers when cache data is revalidated', () => {
    const result = parseHermesCatalog(hermes([{ ...plugin, tier: 'verified' }]), bundled, optional)
    expect(result.entries[0].verified).toBe(true)
    expect(result.entries[1]).toMatchObject({ tier: 'official', verified: false })
    const cached = { ...result, entries: result.entries.map(entry => ({ ...entry, author: { name: entry.author }, install: { args: entry.installArgs } })) }
    expect(parseMarketplaceCatalog(cached, 'hermes')).toEqual(result)
  })
  it('does not fail when all plugin entries are rejected, still returns skill entries', () => {
    // All plugins rejected (bad sha), but skills from Markdown still load
    const badPlugin = { ...plugin, sha: 'not-hex' }
    const result = parseHermesCatalog(hermes([badPlugin]), bundled, optional)
    expect(result.entries.length).toBe(2)
    expect(result.entries.every(entry => entry.type === 'skill')).toBe(true)
  })
  it('fails only when both plugins and skills are empty', () => {
    expect(() => parseHermesCatalog(hermes([]), '', '')).toThrow()
  })
})
