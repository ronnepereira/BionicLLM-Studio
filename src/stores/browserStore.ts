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
  setOpen: (open: boolean) => void
}
// Browser contents/cookies live in their own native profile, never in chat settings.
export const useBrowserStore = create<BrowserState>(set => ({
  open: false, ready: false, url: '', title: '', loading: false, error: null,
  canGoBack: false, canGoForward: false, ownerToken: null,
  size: 46,
  setOpen: open => {
    if (open) useSidePanelStore.getState().show('browser')
    else if (useSidePanelStore.getState().active === 'browser') useSidePanelStore.getState().close()
    set({ open, ...(open ? {} : { ready: false, ownerToken: null }) })
  },
}))
