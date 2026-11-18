/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest'
import { RADIO_STATIONS, radioInput, useRadioStore } from '../radioStore'

beforeEach(() => { localStorage.clear(); useRadioStore.setState({ custom: [], selected: RADIO_STATIONS[0].id, volume: 0.35, requested: false, status: 'stopped', error: null }) })
describe('Webradio preferences and playback intent', () => {
  it('persists stations and volume without auto-playing after restart', async () => {
    const radio = useRadioStore.getState()
    radio.add('Minha rádio', 'https://example.com/live.mp3')
    const id = useRadioStore.getState().custom[0].id
    radio.select(id); radio.setVolume(0.6)
    expect(useRadioStore.getState().requested).toBe(true)
    await useRadioStore.persist.rehydrate()
    expect(useRadioStore.getState()).toMatchObject({ selected: id, volume: 0.6, requested: false, status: 'stopped' })
    radio.remove(id)
    expect(useRadioStore.getState()).toMatchObject({ selected: RADIO_STATIONS[0].id, requested: false })
  })
  it('rejects executable addresses and secrets embedded in station URLs', () => {
    for (const url of ['javascript:alert(1)', 'file:///C:/sound.mp3', 'http://example.com/live', 'https://name:password@example.com/live']) expect(() => radioInput('Rádio', url)).toThrow()
    useRadioStore.getState().setVolume(5)
    expect(useRadioStore.getState().volume).toBe(1)
    expect(() => useRadioStore.getState().add('Duplicada', RADIO_STATIONS[0].url)).toThrow('já está')
  })
})

it('tray mute never changes playback intent or the remembered volume', async () => {
  useRadioStore.setState({ requested: true, volume: 0.42, muted: true })
  expect(useRadioStore.getState()).toMatchObject({ requested: true, volume: 0.42, muted: true })
  await useRadioStore.persist.rehydrate()
  expect(useRadioStore.getState()).toMatchObject({ requested: false, volume: 0.42, muted: false })
})
