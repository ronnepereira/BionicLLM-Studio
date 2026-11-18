export function remoteImageUrl(value: string): string | null {
  try {
    const u = new URL(value)
    return u.protocol === 'https:' && !u.username && !u.password && u.href.length <= 4096 ? u.href : null
  } catch { return null }
}

export function isDirectImageLink(value: string): boolean {
  const url = remoteImageUrl(value)
  return !!url && /\.(png|jpe?g|webp|gif|avif)$/i.test(new URL(url).pathname)
}
