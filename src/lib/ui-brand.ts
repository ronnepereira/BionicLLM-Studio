/** The original attribution is deliberately kept verbatim in About. */
export const ORIGINAL_APP_CREDIT = 'Based on Locally Uncensored, by PurpleDoubleD. Licensed under AGPL-3.0.'

/** Authored interface text only. Call before inserting user values/paths. */
export function brandUiCopy(text: string): string {
  // Preserve links, mail addresses, code snippets and explicit filesystem paths.
  const technical = /(https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|`[^`]*`|(?:[A-Za-z]:[\\/]|\/(?:Users|home|opt|usr|var|mnt|Volumes)\/)[^\r\n"'<>]*)/gi
  const replace = (part: string) => part
    .replace(/\bLocally Uncensored\b/g, 'BionicLLM Studio')
    .replace(/(?<![\w./\\@:-])LU(?![\w/\\@-]|\.[\w]|:\S)/g, 'BU')
  let result = '', start = 0
  for (const match of text.matchAll(technical)) {
    result += replace(text.slice(start, match.index)) + match[0]
    start = match.index! + match[0].length
  }
  return result + replace(text.slice(start))
}
