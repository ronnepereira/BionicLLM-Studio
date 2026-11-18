export const BROWSER_TOOL_NAMES = ['browser_open', 'browser_read', 'browser_action'] as const
export const BROWSER_KEYWORDS = ['navegador', 'browser', 'webview', 'clique', 'clicar', 'digite', 'digitar', 'scroll', 'role a página', 'role a pagina']

export function hasBrowserInteraction(text: string): boolean {
  return /\b(clique|clicar|click|digite|digitar|type|scroll|role|rolar|preencha|selecione|pressione)\b/i.test(text)
}
export function asksForInternalBrowser(text: string): boolean {
  return /\b(navegador|browser|webview)\b/i.test(text) && /\b(abra|abre|abrir|acesse|acessa|visite|navegue|open|browse|visit|navigate|clique|click|digite|type|scroll|role|preencha|selecione|pesquise|pesquisar|busque|buscar|procure|procurar|search|exiba|mostre|continue|continuar)\b/i.test(text)
}

/** Keep browser tools available for a follow-up to a recent browser request. */
export function browserRoutingText(message: string, earlierUserTexts: readonly string[]): string {
  if (asksForInternalBrowser(message)) return message
  const followUp = hasBrowserInteraction(message) || /\b(pesquise|pesquisar|busque|buscar|procure|procurar|search|continue|continuar|avance|volte|pr[oó]xim[oa]|aguarde)\b/i.test(message)
  if (followUp && earlierUserTexts.slice(-4).some(asksForInternalBrowser)) return `${message}\nContinue no navegador interno (browser).`
  return message
}

