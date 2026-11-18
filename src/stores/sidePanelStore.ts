import { create } from 'zustand'

export type SidePanelTab = 'review' | 'browser' | 'terminal' | 'files'
interface SidePanelState {
  open: boolean
  active: SidePanelTab | null
  visited: SidePanelTab[]
  size: number
  show: (tab?: SidePanelTab) => void
  close: () => void
  resize: (size: number) => void
}
export const useSidePanelStore = create<SidePanelState>(set => ({
  open: false, active: null, visited: [], size: 50,
  show: tab => set(s => ({ open: true, active: tab ?? s.active, visited: tab && !s.visited.includes(tab) ? [...s.visited, tab] : s.visited })),
  close: () => set({ open: false }),
  resize: size => set({ size: Number.isFinite(size) ? Math.max(25, Math.min(75, size)) : 50 }),
}))
