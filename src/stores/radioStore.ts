import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import { isRecord } from '../types/json-guards'

export interface RadioStation { id: string; name: string; url: string }
export const RADIO_STATIONS: RadioStation[] = [
  { id: 'nightride', name: 'Nightride FM', url: 'https://stream.nightride.fm/nightride.mp3' },
  { id: 'chillsynth', name: 'Chillsynth', url: 'https://stream.nightride.fm/chillsynth.mp3' },
  { id: 'darksynth', name: 'Darksynth', url: 'https://stream.nightride.fm/darksynth.mp3' },
  { id: 'spacesynth', name: 'Spacesynth', url: 'https://stream.nightride.fm/spacesynth.mp3' },
]
export function radioInput(name: string, raw: string): Pick<RadioStation, 'name' | 'url'> {
  const title = name.trim()
  if (!title || title.length > 80) throw new Error('Informe um nome de até 80 caracteres para a rádio.')
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('Informe o endereço HTTPS de uma transmissão de áudio.') }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || raw.length > 2000) throw new Error('Use uma transmissão HTTPS, sem credenciais no endereço.')
  return { name: title, url: url.href }
}
interface RadioState {
  custom: RadioStation[]
  selected: string
  muted: boolean
  volume: number
  requested: boolean
  status: 'stopped' | 'loading' | 'playing' | 'error'
  error: string | null
  analyser: AnalyserNode | null
  analysisUnavailable: boolean
  select: (id: string) => void
  toggle: () => void
  setVolume: (value: number) => void
  add: (name: string, url: string) => void
  remove: (id: string) => void
}
export const useRadioStore = create<RadioState>()(persist((set, get) => ({
  muted: false, custom: [], selected: RADIO_STATIONS[0].id, volume: 0.35, requested: false, status: 'stopped', error: null, analyser: null, analysisUnavailable: false,
  select: id => { if ([...RADIO_STATIONS, ...get().custom].some(station => station.id === id)) set({ selected: id, requested: true, error: null }) },
  toggle: () => set(state => ({ requested: !state.requested, error: null })),
  setVolume: value => { if (Number.isFinite(value)) set({ volume: Math.min(1, Math.max(0, value)) }) },
  add: (name, url) => {
    const input = radioInput(name, url)
    if (get().custom.length >= 30) throw new Error('Limite de 30 rádios personalizadas atingido.')
    if ([...RADIO_STATIONS, ...get().custom].some(station => station.url === input.url)) throw new Error('Esta transmissão já está na lista.')
    set(state => ({ custom: [...state.custom, { ...input, id: crypto.randomUUID() }] }))
  },
  remove: id => set(state => ({ custom: state.custom.filter(station => station.id !== id), ...(state.selected === id ? { selected: RADIO_STATIONS[0].id, requested: false } : {}) })),
}), {
  name: 'bionic-radio-v1', storage: safeJSONStorage(), partialize: state => ({ custom: state.custom, selected: state.selected, volume: state.volume }),
  merge: (saved, current) => {
    const raw = isRecord(saved) ? saved : {}
    const custom: RadioStation[] = []
    for (const row of Array.isArray(raw.custom) ? raw.custom.slice(0, 30) : []) {
      if (!isRecord(row) || typeof row.id !== 'string' || !/^[\w-]{1,80}$/.test(row.id) || RADIO_STATIONS.some(station => station.id === row.id) || custom.some(station => station.id === row.id) || typeof row.name !== 'string' || typeof row.url !== 'string') continue
      try { custom.push({ id: row.id, ...radioInput(row.name, row.url) }) } catch { /* Invalid stations never trigger network requests. */ }
    }
    const selected = [...RADIO_STATIONS, ...custom].some(station => station.id === raw.selected) ? raw.selected as string : current.selected
    return { ...current, muted: false, custom, selected, volume: typeof raw.volume === 'number' && Number.isFinite(raw.volume) ? Math.max(0, Math.min(1, raw.volume)) : current.volume, requested: false, status: 'stopped' as const, error: null, analyser: null, analysisUnavailable: false }
  },
}))
