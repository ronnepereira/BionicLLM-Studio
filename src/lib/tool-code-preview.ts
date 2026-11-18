/** A bounded, passive view of code arriving in file-tool arguments. */
export function toolCodePreview(name: string, raw: string): string | undefined {
  if (!/^(?:file_write|file_edit|write_file|edit_file)$/.test(name)) return undefined
  const match = /"(?:content|new_string|newText)"\s*:\s*"((?:\\.|[^"\\])*)/.exec(raw)
  if (!match) return undefined
  try {
    const text: unknown = JSON.parse('"' + match[1].replace(/\\$/, '') + '"')
    return typeof text === 'string' ? text.split('\n').slice(-8).join('\n').slice(-1200) : undefined
  } catch { return undefined } // An incomplete Unicode escape waits for its next delta.
}
