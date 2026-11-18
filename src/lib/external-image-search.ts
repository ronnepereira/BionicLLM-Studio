/** Detects an explicit order to search the WEB for an IMAGE and show it in chat.
 *
 * Narrow on purpose: the order stands at the start of the message and names
 * an image lookup on the web ("buscar imagem de ...", "imagem da web: ...",
 * "pesquisar imagem ...", "imagem web ...", "search image for ...").
 * Missing an order leaves things as they were; taking a plain question for
 * one would search behind the user's back.
 *
 * Pure — no network, no side effects. Returns the image query or null.
 */

const LEAD_IN =
  '(?:(?:hey|hi|ok(?:ay)?|please|pls|bitte|kannst\\s+du|koenntest\\s+du|könntest\\s+du|can\\s+you|could\\s+you|would\\s+you|i\\s+want\\s+you\\s+to|i\\s+need\\s+you\\s+to|mal)[\\s,]+)*'

/** What may stand between the order and what to look for. */
const JOIN = '(?:\\s*[:\\-]\\s*|\\s+(?:for|about|on|nach|zu|ueber|über|de|de|da|em|no|na)\\s+|\\s+)'

const IMAGE_WORD =
  '(?:imagem|imagens|foto|fotos|fotografia|fotografias|picture|pictures|photo|photos|image|images|bild|bilder|grafik|grafiken)'

const WEB_WORD =
  '(?:internet|web|rede|online|rede mundial|mundial)'

/** Orders with the query at the end. Each one names an image + the web. */
const ORDERS_QUERY_LAST: readonly RegExp[] = [
  // buscar imagem de X / buscar imagem X / imagem de X na web
  new RegExp(`^${LEAD_IN}buscar${JOIN}(?:uma\\s+)?${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
  new RegExp(`^${LEAD_IN}${IMAGE_WORD}${JOIN}(?:da|do|na|no|de|del)?${JOIN}?${WEB_WORD}${JOIN}(.+)$`, 'is'),
  new RegExp(`^${LEAD_IN}${IMAGE_WORD}${JOIN}web${JOIN}(.+)$`, 'is'),
  // search image for X / search the web for image X / web image X
  new RegExp(`^${LEAD_IN}search${JOIN}(?:the\\s+)?(?:web|internet)${JOIN}(?:for\\s+)?${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
  new RegExp(`^${LEAD_IN}search${JOIN}${IMAGE_WORD}${JOIN}(?:for|on|in)${JOIN}(?:the\\s+)?(?:web|internet)${JOIN}(.+)$`, 'is'),
  new RegExp(`^${LEAD_IN}web${JOIN}${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
  // pesquisar imagem X / pesquisa de imagem X
  new RegExp(`^${LEAD_IN}pesquisar${JOIN}${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
  new RegExp(`^${LEAD_IN}pesquisa${JOIN}${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
  // google imagem X / google images X
  new RegExp(`^${LEAD_IN}google${JOIN}${IMAGE_WORD}${JOIN}(.+)$`, 'is'),
]

const ADDRESS = /\bhttps?:\/\//i

/** Longest query handed to a search. */
export const IMAGE_SEARCH_QUERY_MAX = 300

function tidy(raw: string): string {
  let q = raw.replace(/\s+/g, ' ').trim()
  q = q.replace(/^[\"'“„«]+|[\"'”“»]+$/g, '').trim()
  q = q.replace(/[\s,]+(?:please|pls|bitte|thanks|thank you|danke|por favor|obrigado)[\s.!]*$/i, '').trim()
  return q
}

/**
 * The query of an explicit order to search the web for an IMAGE, or null when
 * the text is not such an order.
 */
export function explicitImageSearchQuery(text: string): string | null {
  const t = (text || '').trim()
  if (!t || ADDRESS.test(t)) return null
  for (const order of ORDERS_QUERY_LAST) {
    const m = order.exec(t)
    if (!m) continue
    const q = tidy(m[1])
    if (q.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return null
    return q.length > IMAGE_SEARCH_QUERY_MAX ? q.slice(0, IMAGE_SEARCH_QUERY_MAX).trim() : q
  }
  return null
}
