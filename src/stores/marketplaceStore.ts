import { create } from 'zustand'
import { fetchMarketplaceCatalog } from '../api/marketplace'
import { MARKETPLACE_MAX_BYTES, parseMarketplaceCatalog, type MarketplaceCatalog, type MarketplaceSource } from '../lib/marketplace-catalog'

const CACHE_KEYS = { cline: 'bionic-marketplace-cache-v1', hermes: 'bionic-marketplace-hermes-cache-v1' }
const REFRESH_AFTER = 15 * 60_000
interface CatalogState { catalog: MarketplaceCatalog | null; fetchedAt: number; loading: boolean; error: boolean; errorMessage: string | null }
const empty = (): CatalogState => ({ catalog: null, fetchedAt: 0, loading: false, error: false, errorMessage: null })
function cached(source: MarketplaceSource): CatalogState {
  try {
    const raw = localStorage.getItem(CACHE_KEYS[source])
    if (!raw || raw.length > MARKETPLACE_MAX_BYTES) return empty()
    const value = JSON.parse(raw)
    if (!Number.isFinite(value.fetchedAt) || value.fetchedAt <= 0 || value.fetchedAt > Date.now() + 60_000) throw new Error('Invalid cache time')
    // Cache stores normalized records. Reuse the same external boundary parser.
    return { catalog: parseMarketplaceCatalog(value.catalog, source), fetchedAt: value.fetchedAt, loading: false, error: false, errorMessage: null }
  } catch { return empty() }
}

interface MarketplaceState {
  sources: Record<MarketplaceSource, CatalogState>
  refresh: (force?: boolean, source?: MarketplaceSource) => Promise<void>
}
const pending: Partial<Record<MarketplaceSource, Promise<void>>> = {}
export const useMarketplaceStore = create<MarketplaceState>((set, get) => ({
  sources: { cline: cached('cline'), hermes: cached('hermes') },
  refresh: async (force = false, selected) => {
    const update = (source: MarketplaceSource, partial: Partial<CatalogState>) => set(state => ({ sources: { ...state.sources, [source]: { ...state.sources[source], ...partial } } }))
    await Promise.all((selected ? [selected] : ['cline', 'hermes'] as const).map(source => {
      if (pending[source]) return pending[source]
      const current = get().sources[source]
      if (!force && current.catalog && Date.now() - current.fetchedAt < REFRESH_AFTER) return Promise.resolve()
      update(source, { loading: true, error: false })
      pending[source] = (async () => {
        try {
          const catalog = await fetchMarketplaceCatalog(source)
          const fetchedAt = Date.now()
          update(source, { catalog, fetchedAt })
          try {
            // A disposable catalog must never evict or prune user conversations.
            const entries = catalog.entries.map(entry => ({ ...entry, author: { name: entry.author }, install: { args: entry.installArgs } }))
            localStorage.setItem(CACHE_KEYS[source], JSON.stringify({ fetchedAt, catalog: { ...catalog, entries } }))
          } catch { /* Optional cache writes never affect browsing or user content. */ }
        } catch (err) { update(source, { error: true, errorMessage: err instanceof Error ? err.message : String(err) }) }
        finally { update(source, { loading: false }); delete pending[source] }
      })()
      return pending[source]
    }))
  },
}))
