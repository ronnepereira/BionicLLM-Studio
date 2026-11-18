import { describe, expect, it } from 'vitest'
import { backgroundFileKind, backgroundUrl, normalizeChatBackground, DEFAULT_CHAT_BACKGROUND, BACKGROUND_MAX_BYTES } from '../chat-background'
import { isDirectImageLink, remoteImageUrl } from '../external-image-preview'

describe('chat background preferences', () => {
  it('keeps old profiles without a background and bounds imported preferences', () => {
    expect(normalizeChatBackground(undefined)).toEqual(DEFAULT_CHAT_BACKGROUND)
    expect(normalizeChatBackground({ kind: 'video', source: 'https://example.com/a.mp4', dim: 0, paused: true })).toMatchObject({ kind: 'video', dim: 60, paused: true })
    expect(normalizeChatBackground({ kind: 'image', source: 'https://example.com/a.jpg', dim: 200 })).toMatchObject({ kind: 'image', dim: 95 })
    expect(normalizeChatBackground({ kind: 'image', source: 'local:bc425f9d-406f-439d-bacf-86b4b9208793' }).kind).toBe('image')
  })
  it('refuses executable URLs, embedded credentials and oversized cosmetic files', () => {
    for (const source of ['file:///C:/secret.txt', 'javascript:alert(1)', 'http://example.com/a.jpg', 'https://user:pass@example.com/a', 'data:image/png;base64,a']) {
      expect(() => backgroundUrl(source)).toThrow()
      expect(normalizeChatBackground({ kind: 'image', source }).kind).toBe('none')
    }
    expect(() => backgroundFileKind({ type: 'text/html', size: 80 })).toThrow()
    expect(() => backgroundFileKind({ type: 'video/mp4', size: BACKGROUND_MAX_BYTES + 1 })).toThrow()
    expect(() => backgroundFileKind({ type: 'image/png', size: 0 })).toThrow()
    expect(backgroundFileKind({ type: 'video/webm', size: 100 })).toBe('video')
    expect(backgroundFileKind({ type: 'image/avif', size: 100 })).toBe('image')
  })
})

describe('external preview URLs', () => {
  it('only recognizes direct HTTPS image links, leaving articles and generated local URLs alone', () => {
    expect(isDirectImageLink('https://example.com/a.JPG?size=500')).toBe(true)
    expect(isDirectImageLink('https://example.com/article')).toBe(false)
    expect(isDirectImageLink('http://127.0.0.1:8188/view?filename=a.png')).toBe(false)
    for (const source of ['javascript:a', 'data:image/png;base64,a', 'file:///C:/a.jpg', 'https://u:p@example.com/a.png']) expect(remoteImageUrl(source)).toBeNull()
  })
})
