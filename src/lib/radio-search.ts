/** Pesquisa de rádios online via radio-browser.info (API pública, sem chave).
 *
 * O BionicLLM Studio só listava rádios fixas (RADIO_STATIONS) ou rádios
 * adicionadas manualmente pelo usuário (nome + URL). Este módulo adiciona
 * a mesma ideia do Hermes: buscar estações disponíveis na internet,
 * escolher uma e salvar para usar quando quiser.
 *
 * O radio-browser.info mantém um diretório público de milhares de estações
 * de rádio por streaming (Icecast/Shoutcast). A consulta é feita por nome
 * e devolve name + url (endereço do stream) para cada resultado.
 */

import { backendCall } from '../api/backend'

export interface OnlineRadioStation {
  name: string
  url: string
  country?: string
  language?: string
  tags?: string
}

/** Pesquisa estações de rádio online por nome/termo via backend Tauri (evita bloqueio do navegador). Devolve até 20 resultados. */
export async function searchOnlineRadios(query: string): Promise<OnlineRadioStation[]> {
  if (!query || query.trim().length < 2) return []
  const data = await backendCall<OnlineRadioStation[]>('search_online_radios', {
    req: { name: query.trim(), limit: 20 },
  })
  // A transport/contract failure is not a successful search with zero matches.
  if (!Array.isArray(data)) throw new Error('Resposta inválida do diretório de rádios')
  return data
}
