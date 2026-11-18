export const DEFAULT_BUTTON_COLOR = '#1f6feb'

/** Only opaque, six-digit hex colors enter settings or CSS variables. */
export function normalizeButtonColor(value: unknown): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase() : DEFAULT_BUTTON_COLOR
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
}

function luminance(hex: string): number {
  return channels(hex).reduce((sum, channel, index) => {
    const c = channel / 255
    return sum + (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
  }, 0)
}

function contrast(a: string, b: string): number {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (values[0] + 0.05) / (values[1] + 0.05)
}

function mix(color: string, target: string, amount: number): string {
  const end = channels(target)
  return '#' + channels(color).map((c, i) => Math.round(c + (end[i] - c) * amount).toString(16).padStart(2, '0')).join('')
}

function readable(color: string, background: string, target: string): string {
  for (let step = 0; step <= 100; step++) {
    const candidate = mix(color, target, step / 100)
    if (contrast(candidate, background) >= 4.5) return candidate
  }
  return target
}

export function buttonColorTokens(value: unknown): Record<string, string> {
  const color = normalizeButtonColor(value)
  const foreground = contrast(color, '#ffffff') >= contrast(color, '#000000') ? '#ffffff' : '#000000'
  return {
    '--color-lu-accent': color,
    '--color-lu-on-accent': foreground,
    '--color-lu-accent-hover': mix(color, foreground === '#ffffff' ? '#000000' : '#ffffff', 0.12),
    '--color-lu-accent-soft': `rgba(${channels(color).join(', ')}, 0.14)`,
    '--color-lu-accent-ring': `rgba(${channels(color).join(', ')}, 0.55)`,
    '--color-lu-accent-edge': readable(color, '#ffffff', '#000000'),
    // Conservative surfaces cover the strongest tonal fills in either theme.
    '--color-lu-accent-ink': readable(color, '#bfbfbf', '#000000'),
    '--color-lu-accent-text': readable(color, '#555555', '#ffffff'),
  }
}
