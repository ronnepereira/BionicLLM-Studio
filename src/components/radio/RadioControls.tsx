import { useEffect, useRef, useState } from 'react'
import { Radio, Play, Pause, SkipForward, Volume2, VolumeX, Plus, Trash2, X, Download } from 'lucide-react'
import { RADIO_STATIONS, useRadioStore } from '../../stores/radioStore'
import { useUiText } from '../../lib/ui-text'
import { RadioSpectrum } from './RadioSpectrum'
import { searchOnlineRadios, type OnlineRadioStation } from '../../lib/radio-search'

export function RadioControls() {
  const text = useUiText()
  const state = useRadioStore()
  const stations = [...RADIO_STATIONS, ...state.custom]
  const selected = stations.find(station => station.id === state.selected) || stations[0]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  // Pesquisa online (igual ao plugin webradio do Hermes) — automática enquanto digita
  const [searching, setSearching] = useState(false)
  const [onlineResults, setOnlineResults] = useState<OnlineRadioStation[]>([])
  const [searchError, setSearchError] = useState('')
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  const icon = 'flex items-center justify-center rounded p-1 hover:bg-gray-200 dark:hover:bg-white/10 text-gray-500'
  const next = () => state.select(stations[(stations.findIndex(station => station.id === state.selected) + 1) % stations.length].id)

  // Debounce automático: pesquisa online assim que digita, sem botão de lupa
  useEffect(() => {
    const q = query.trim()
    setOnlineResults([])
    setSearchError('')
    if (!open || q.length < 2) { setSearching(false); return }
    setSearching(true)
    // Tauri invoke cannot be aborted here. Invalidate every obsolete effect so
    // late results, errors and finally handlers cannot overwrite the new query.
    let active = true
    const timer = setTimeout(async () => {
      try {
        const results = await searchOnlineRadios(q)
        if (active) setOnlineResults(results.slice(0, 20))
      } catch {
        if (active) {
          setSearchError('Não foi possível pesquisar rádios online. Tente novamente.')
          setOnlineResults([])
        }
      } finally {
        if (active) setSearching(false)
      }
    }, 400)
    return () => { active = false; clearTimeout(timer) }
  }, [query, open])

  const addOnlineStation = (station: OnlineRadioStation) => {
    try {
      state.add(station.name, station.url)
      setOnlineResults(onlineResults.filter(r => r.url !== station.url))
      setQuery('')
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const isOnlineSelected = (station: OnlineRadioStation) =>
    state.custom.some(c => c.url === station.url) || stations.some(s => s.url === station.url)

  const clearSearch = () => {
    setQuery('')
    setOnlineResults([])
    setSearchError('')
    setSearching(false)
  }

  return <div ref={root} className="relative flex min-w-0 items-center gap-1">
    <button type="button" aria-label={text('Webradio')} aria-expanded={open} onClick={() => setOpen(value => !value)} className="flex min-w-0 items-center gap-1.5 rounded px-1 py-1 hover:bg-gray-200 dark:hover:bg-white/10"><Radio size={12} className="text-orange-600 dark:text-orange-400" /><span className="max-w-28 truncate">{state.status === 'stopped' ? text('Webradio') : selected.name}</span></button>
    <RadioSpectrum />
    {state.muted && <span title="Webradio silenciada na bandeja"><VolumeX size={12} className="text-amber-500" /></span>}
    <button type="button" className={icon} onClick={state.toggle} aria-label={state.requested ? text('Pause radio') : text('Play radio')}>{state.requested ? <Pause size={12} className="text-amber-600 dark:text-amber-400" /> : <Play size={12} className="text-emerald-600 dark:text-emerald-400" />}</button>
    <button type="button" className={icon} onClick={next} aria-label={text('Next station')}><SkipForward size={12} className="text-blue-600 dark:text-blue-400" /></button>
    {open && <section aria-label={text('Radio stations')} className="lu-elevated studio-form absolute bottom-full left-0 z-[130] mb-2 w-[380px] max-w-[calc(100vw-40px)] max-h-[70vh] overflow-auto rounded-xl border border-gray-300 dark:border-white/15 bg-white dark:bg-lu-panel p-3 text-sm shadow-xl space-y-3">
      <div className="flex justify-between items-center"><h2 className="text-sm font-semibold">{text('Webradio')}</h2><button type="button" className={icon} onClick={() => setOpen(false)} aria-label={text('Close radio panel')}><X size={14} /></button></div>
      {/* Único campo de pesquisa: filtra estações salvas e pesquisa online automaticamente */}
      <div className="relative w-full">
        <input aria-label={text('Find a station')} placeholder={text('Pesquisar estação…')} className="w-full rounded-lg border border-gray-300 dark:border-white/15 bg-transparent px-2 py-1.5 pr-8" value={query} onChange={event => setQuery(event.target.value)} />
        {query.trim().length > 0 && (
          <button type="button" className="absolute right-2 top-1/2 -mt-0.5 p-1 hover:bg-gray-200 dark:hover:bg-white/10" onClick={clearSearch} aria-label={text('Clear search')}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="space-y-1">{stations.filter(station => station.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(station => <div key={station.id} className="flex items-center gap-1"><button type="button" className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-left truncate ${station.id === selected.id ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`} onClick={() => state.select(station.id)}>{station.name}</button>{state.custom.some(custom => custom.id === station.id) && <button type="button" className={icon} onClick={() => state.remove(station.id)} aria-label={text('Remove {v0}', { v0: station.name })}><Trash2 size={12} /></button>}</div>)}</div>
      {/* Pesquisa online automática (igual ao plugin webradio do Hermes) */}
      <div className="space-y-2 border-t border-gray-200 dark:border-white/10 pt-2">
        <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-400">{text('Pesquisar rádios online')}</label>
        <p role="status" className="text-[10px] text-gray-500">{searching ? text('Buscando…') : onlineResults.length === 0 && query.trim().length >= 2 && !searchError ? text('Nenhuma rádio encontrada') : ''}</p>
        {searchError && <p role="alert" className="text-[10px] text-red-500">{searchError}</p>}
        {onlineResults.length > 0 && (
          <div className="space-y-1 max-h-[200px] overflow-y-auto">
            {onlineResults.map(station => (
              <div key={station.url} className="flex items-center gap-1">
                <button type="button" className={`flex-1 min-w-0 rounded-lg px-2 py-1.5 text-left truncate ${isOnlineSelected(station) ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-white/5'}`} onClick={() => {
                  if (!state.custom.some(c => c.url === station.url)) {
                    try { state.add(station.name, station.url); setOnlineResults(onlineResults.filter(r => r.url !== station.url)); setError('') } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
                  } else {
                    const existing = [...stations].find(s => s.url === station.url)
                    if (existing) state.select(existing.id)
                  }
                }}>{station.name}</button>
                {!isOnlineSelected(station) && (
                  <button type="button" className={icon} onClick={() => addOnlineStation(station)} aria-label={text('Add station')}>
                    <Download size={11} />
                  </button>
                )}
                {station.country && <span className="text-[10px] text-gray-500">{station.country}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2"><Volume2 size={14} className="text-blue-600 dark:text-blue-400" /><input type="range" min={0} max={1} step={0.01} value={state.volume} aria-label={text('Radio volume')} className="min-w-0 flex-1 accent-blue-500" onChange={event => state.setVolume(Number(event.target.value))} /><span className="text-xs tabular-nums">{Math.round(state.volume * 100)}%</span></div>
      <RadioSpectrum expanded />
      {state.status === 'playing' && state.analysisUnavailable && <p className="text-xs text-gray-500">{text('This station does not provide audio analysis. Playback continues without the spectrum.')}</p>}
      <p role="status" className="text-xs text-gray-500">{text({ stopped: 'Radio stopped', loading: 'Connecting to station...', playing: 'Live radio', error: 'Radio unavailable' }[state.status])}</p>
      {(state.error || error) && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error || state.error}</p>}
      <button type="button" className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-500" onClick={() => setAdding(value => !value)}><Plus size={13} />{text('Add a station')}</button>
      {adding && <form className="space-y-2" onSubmit={event => {
        event.preventDefault()
        try { state.add(name, url); setAdding(false); setName(''); setUrl(''); setError('') }
        catch (error) { setError(error instanceof Error ? error.message : String(error)) }
      }}><label className="block text-xs">{text('Station name')}<input required maxLength={80} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded border border-gray-300 dark:border-white/15 bg-transparent p-1.5" /></label><label className="block text-xs">{text('HTTPS audio stream URL')}<input required type="url" value={url} onChange={event => setUrl(event.target.value)} className="mt-1 w-full rounded border border-gray-300 dark:border-white/15 bg-transparent p-1.5" /></label><button type="submit" className="rounded border border-gray-300 dark:border-white/15 px-2 py-1 text-xs">{text('Save station')}</button></form>}
      <p className="text-[11px] text-gray-500">{text('Playback connects directly to the selected station and requires internet. It never starts automatically on app launch.')}</p>
    </section>}
  </div>
}
