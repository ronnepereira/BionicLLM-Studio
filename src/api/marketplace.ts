import { backendCall, isTauri } from './backend'
import { MARKETPLACE_FEEDS, MARKETPLACE_MAX_BYTES, parseMarketplaceCatalog, parseHermesCatalog, type MarketplaceFeed, type MarketplaceSource } from '../lib/marketplace-catalog'

async function fetchFeed(feed: MarketplaceFeed): Promise<string> {
  if (isTauri()) {
    const raw = await backendCall<string>('studio_marketplace_catalog', { feed })
    if (typeof raw !== 'string' || raw.length > MARKETPLACE_MAX_BYTES) throw new Error('Invalid marketplace catalog.')
    return raw
  }
  const response = await fetch(MARKETPLACE_FEEDS[feed], { signal: AbortSignal.timeout(20000), credentials: 'omit', redirect: 'error', cache: 'no-store' })
  if (!response.ok || !response.body) throw new Error('Could not load the online catalog.')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MARKETPLACE_MAX_BYTES) throw new Error('Invalid marketplace catalog.')
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => {}) }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

export async function fetchMarketplaceCatalog(source: MarketplaceSource = 'cline') {
  if (source === 'cline') return parseMarketplaceCatalog(JSON.parse(await fetchFeed('cline')))
  const [plugins, bundled, optional] = await Promise.all([
    fetchFeed('hermes-plugins'), fetchFeed('hermes-bundled-skills'), fetchFeed('hermes-optional-skills'),
  ])
  return parseHermesCatalog(JSON.parse(plugins), bundled, optional)
}
