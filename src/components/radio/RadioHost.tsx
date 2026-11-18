import { useEffect, useRef } from 'react'
import { RADIO_STATIONS, useRadioStore } from '../../stores/radioStore'

/** One audio owner and one lazily-created audio context for the app. */
export function RadioHost() {
  const audio = useRef<HTMLAudioElement | null>(null)
  const context = useRef<AudioContext | null>(null)
  const { custom, selected, requested, volume, muted } = useRadioStore()
  const url = [...RADIO_STATIONS, ...custom].find(station => station.id === selected)?.url
  useEffect(() => {
    let off: (() => void) | undefined
    let disposed = false
    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      if (!(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) return
      const stop = await listen<boolean>('radio:set-muted', event => {
        useRadioStore.setState({ muted: event.payload })
      })
      if (disposed) stop(); else off = stop
    }).catch(() => {})
    return () => {
      disposed = true; off?.()
      void context.current?.close().catch(() => {})
      context.current = null
    }
  }, [])
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])
  useEffect(() => { if (audio.current) audio.current.muted = muted }, [muted])
  useEffect(() => {
    useRadioStore.setState({ analyser: null, analysisUnavailable: false })
    if (!requested || !url) {
      if (useRadioStore.getState().status !== 'error') useRadioStore.setState({ status: 'stopped' })
      return
    }
    let disposed = false
    let cleanPlayer = () => {}
    const start = (analyse: boolean) => {
      cleanPlayer()
      if (disposed) return
      const player = new Audio()
      audio.current = player
      player.preload = 'none'
      player.volume = useRadioStore.getState().volume
      player.muted = useRadioStore.getState().muted
      if (analyse) player.crossOrigin = 'anonymous'
      let source: MediaElementAudioSourceNode | null = null
      let meter: AnalyserNode | null = null
      const current = () => !disposed && audio.current === player
      const fail = (message: string) => {
        if (current()) useRadioStore.setState({ requested: false, status: 'error', analyser: null, error: message })
      }
      const failed = () => {
        if (!current() || !useRadioStore.getState().requested) return
        if (analyse) start(false)
        else fail('Não foi possível reproduzir esta rádio. Confira a conexão ou escolha outra transmissão.')
      }
      const playing = () => { if (current() && useRadioStore.getState().requested) useRadioStore.setState({ status: 'playing', error: null }) }
      const waiting = () => { if (current() && useRadioStore.getState().requested) useRadioStore.setState({ status: 'loading' }) }
      cleanPlayer = () => {
        player.removeEventListener('playing', playing); player.removeEventListener('waiting', waiting); player.removeEventListener('error', failed)
        if (audio.current === player) audio.current = null
        player.pause(); player.removeAttribute('src'); player.load()
        source?.disconnect(); meter?.disconnect()
      }
      player.addEventListener('playing', playing); player.addEventListener('waiting', waiting); player.addEventListener('error', failed)
      if (analyse) {
        try {
          const ctx = context.current ?? new AudioContext()
          context.current = ctx
          meter = ctx.createAnalyser(); meter.fftSize = 512; meter.smoothingTimeConstant = 0.75
          source = ctx.createMediaElementSource(player)
          source.connect(meter); meter.connect(ctx.destination)
          useRadioStore.setState({ analyser: meter, analysisUnavailable: false })
          void ctx.resume().catch(() => { if (current()) start(false) })
        } catch { start(false); return }
      } else useRadioStore.setState({ analyser: null, analysisUnavailable: true })
      useRadioStore.setState({ status: 'loading' })
      player.src = url
      void player.play().catch(error => {
        if (!current() || error?.name === 'AbortError') return
        if (analyse && error?.name !== 'NotAllowedError') start(false)
        else fail('A reprodução não pôde começar. Clique em reproduzir novamente ou escolha outra rádio.')
      })
    }
    start(typeof AudioContext !== 'undefined')
    return () => {
      disposed = true; cleanPlayer()
      useRadioStore.setState({ analyser: null })
      void context.current?.suspend().catch(() => {})
    }
  }, [requested, url])
  return null
}
