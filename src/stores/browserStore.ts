import { create } from 'zustand'
import { useSidePanelStore } from './sidePanelStore'

interface BrowserState {
  open: boolean
  ready: boolean
  url: string
  title: string
  loading: boolean
  error: string | null
  canGoBack: boolean
  canGoForward: boolean
  ownerToken: string | null
  size: number
  tabs: { id: string; title: string }[]
  activeTab: string | null
  addTab: () => void
  selectTab: (id: string) => void
  removeTab: (id: string) => void
  setOpen: (open: boolean) => void
}
const blankPage = {
  ready: false, url: '', title: '', loading: false, error: null,
  canGoBack: false, canGoForward: false, ownerToken: null,
}
// Browser contents/cookies live in their own native profile, never in chat settings.
export const useBrowserStore = create<BrowserState>((set, get) => ({
  open: false, ...blankPage, tabs: [], activeTab: null,
  size: 46,
  addTab: () => {
    const id = crypto.randomUUID()
    set(s => ({ ...blankPage, ownerToken: s.activeTab ? null : s.ownerToken, tabs: [...s.tabs, { id, title: '' }], activeTab: id, open: true }))
    useSidePanelStore.getState().show('browser')
  },
  selectTab: id => set(s => id !== s.activeTab && s.tabs.some(tab => tab.id === id)
    ? { ...blankPage, activeTab: id } : s),
  removeTab: id => {
    const { tabs, activeTab } = get()
    const index = tabs.findIndex(tab => tab.id === id)
    if (index === -1) return
    const remaining = tabs.filter(tab => tab.id !== id)
    if (id !== activeTab) { set({ tabs: remaining }); return }
    const next = remaining[index] ?? remaining[index - 1]
    set({ ...blankPage, tabs: remaining, activeTab: next?.id ?? null, open: !!next })
    if (!next) useSidePanelStore.getState().dismiss('browser')
  },
  setOpen: open => {
    set({ open, ...(open ? {} : { ready: false, ownerToken: null }) })
    if (!open) useSidePanelStore.getState().dismiss('browser')
    else if (!get().activeTab) get().addTab()
    else useSidePanelStore.getState().show('browser')
  },
}))
