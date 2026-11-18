/** @vitest-environment jsdom */
import { beforeEach, it, expect, vi } from 'vitest'
import { parseMarketplaceCatalog } from '../../lib/marketplace-catalog'
const fake = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../api/marketplace', () => ({ fetchMarketplaceCatalog: (source: string) => fake.fetch(source) }))
import { useMarketplaceStore } from '../marketplaceStore'

const catalog = parseMarketplaceCatalog({ version: 1, generatedAt: '2026-09-18T20:15:28Z', entries: [{ id: 'skill', type: 'skill', name: 'Example', description: 'Instructions', author: { name: 'Author' }, install: { args: ['author/repo', '--skill', 'example'] } }] })
beforeEach(() => {
  localStorage.clear()
  fake.fetch.mockReset(); fake.fetch.mockResolvedValue(catalog)
  const empty = () => ({ catalog: null, fetchedAt: 0, loading: false, error: false, errorMessage: null })
  useMarketplaceStore.setState({ sources: { cline: empty(), hermes: empty() } })
})
it('loads only on request and caches a list that the boundary can validate again', async () => {
  expect(fake.fetch).not.toHaveBeenCalled()
  await useMarketplaceStore.getState().refresh(false, 'cline')
  const cached = JSON.parse(localStorage.getItem('bionic-marketplace-cache-v1')!)
  expect(parseMarketplaceCatalog(cached.catalog)).toEqual(catalog)
  await useMarketplaceStore.getState().refresh(false, 'cline')
  expect(fake.fetch).toHaveBeenCalledTimes(1)
})
it('deduplicates simultaneous requests and keeps the last good list after an error', async () => {
  let finish!: (value: typeof catalog) => void
  fake.fetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const a = useMarketplaceStore.getState().refresh(false, 'cline'), b = useMarketplaceStore.getState().refresh(true, 'cline')
  expect(fake.fetch).toHaveBeenCalledTimes(1)
  finish(catalog); await Promise.all([a, b])
  fake.fetch.mockRejectedValueOnce(new Error('Offline'))
  await useMarketplaceStore.getState().refresh(true, 'cline')
  expect(useMarketplaceStore.getState().sources.cline).toMatchObject({ catalog, error: true, loading: false })
})
it('does not discard user data when a disposable cache cannot be saved', async () => {
  localStorage.setItem('user-content', 'keep me')
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Quota exceeded') })
  try {
    await useMarketplaceStore.getState().refresh(false, 'cline')
    expect(useMarketplaceStore.getState().sources.cline).toMatchObject({ catalog, error: false })
    expect(localStorage.getItem('user-content')).toBe('keep me')
  } finally { write.mockRestore() }
})

it('loads both sources independently so one failure does not hide the other catalog', async () => {
  fake.fetch.mockImplementation(source => source === 'hermes' ? Promise.reject(new Error('Offline')) : Promise.resolve(catalog))
  await useMarketplaceStore.getState().refresh()
  expect(useMarketplaceStore.getState().sources.cline).toMatchObject({ catalog, error: false })
  expect(useMarketplaceStore.getState().sources.hermes).toMatchObject({ catalog: null, error: true, loading: false })
})
