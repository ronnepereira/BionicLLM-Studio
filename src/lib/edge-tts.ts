export const EDGE_VOICES = [
  { id: 'pt-BR-FranciscaNeural', name: 'Francisca' },
  { id: 'pt-BR-AntonioNeural', name: 'Antônio' },
  { id: 'pt-BR-ThalitaMultilingualNeural', name: 'Thalita Multilingual' },
] as const
export function normalizeEdgeVoice(value: unknown): string {
  return EDGE_VOICES.some(voice => voice.id === value) ? value as string : EDGE_VOICES[0].id
}
export function normalizeEdgeRate(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 50 && value <= 150 ? value : 100
}
