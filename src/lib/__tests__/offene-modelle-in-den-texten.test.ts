import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const WURZEL = resolve(__dirname, '..', '..', '..')
const lies = (pfad: string) => readFileSync(resolve(WURZEL, pfad), 'utf8')

const nenntSechsModelle = (text: string) =>
  /\bsix\b[^.]{0,40}\b(?:video|image)(?:-to-video)?\s+(?:models|endpoints)/i.test(text)
  || /\bthese six\b/i.test(text)
  || /the six models/i.test(text)

describe('die Zahl der offenen Modelle', () => {
  it('und das Blatt liest die Zahl, statt sie zu tippen', () => {
    const blatt = lies('src/lib/release-notes.ts')
    expect(blatt, 'das Blatt tippt die offene Videozahl').toContain(
      '${CLOUD_PITCH.openVideoModels} video models and ${CLOUD_PITCH.openImageModels} image models',
    )
    expect(nenntSechsModelle(blatt), 'das Blatt zaehlt noch sechs').toBe(false)
  })

  /**
   * NEGATIVKONTROLLE. Ohne sie waere dieser Waechter auch dann gruen, wenn er
   * gar nichts erkennt: die drei Seiten sagen "six" naemlich weiterhin, nur
   * nicht ueber Modelle.
   */
})
