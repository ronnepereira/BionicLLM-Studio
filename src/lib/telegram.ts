export function parseTelegramChats(input: string): number[] {
  const parts = input.trim().split(/[\s,;]+/)
  if (!input.trim() || parts.length > 50 || parts.some(part => !/^-?[1-9]\d{0,15}$/.test(part))) throw new Error('Informe de 1 a 50 IDs numéricos de chats, separados por vírgula ou linha.')
  const ids = [...new Set(parts.map(Number))]
  if (ids.some(id => !Number.isSafeInteger(id) || Math.abs(id) > 4_503_599_627_370_495)) throw new Error('Um dos IDs de chat está fora do intervalo permitido.')
  return ids
}
