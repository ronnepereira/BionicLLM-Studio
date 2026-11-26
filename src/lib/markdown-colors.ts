import type { Element, Root, RootContent, Text } from 'hast'

// Only color literals become styles. Never interpolate arbitrary model output.
const COLOR = /(?<![\w#])(?:#[\da-f]{8}|#[\da-f]{6}|#[\da-f]{4}|#[\da-f]{3})(?![\w])|\b(?:rgba?|hsla?)\(\s*[-+\d.%\s,/]+\)/gi

export function remarkVisualHtml() {
  // CommonMark already identifies block HTML. Keep inline prose tags alone.
  return (tree: { children: { type: string; value?: string; lang?: string }[] }) => {
    for (const node of tree.children) {
      if (node.type === 'html' && /^\s*<(?:!doctype\s+html|html\b|div\b|section\b|article\b|style\b|svg\b|table\b|button\b|form\b)/i.test(node.value ?? '')) {
        node.type = 'code'
        node.lang = 'html'
      }
    }
  }
}

/** Decorate prose and inline literals while leaving source blocks untouched. */
export function rehypeColorSwatches() {
  return (tree: Root) => {
    function visit(parent: Root | Element) {
      if (parent.type === 'element' && ['pre', 'script', 'style', 'svg'].includes(parent.tagName)) return
      const children: RootContent[] = []
      for (const child of parent.children) {
        if (child.type !== 'text') {
          if (child.type === 'element') visit(child)
          children.push(child)
          continue
        }
        let offset = 0
        for (const match of child.value.matchAll(COLOR)) {
          const color = match[0]
          if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', color)) continue
          const at = match.index!
          if (at > offset) children.push({ type: 'text', value: child.value.slice(offset, at) } as Text)
          children.push({ type: 'element', tagName: 'span', properties: { className: ['chat-color-swatch'], style: `background-color:${color}`, title: color, role: 'img', ariaLabel: `Cor ${color}` }, children: [] })
          children.push({ type: 'text', value: color })
          offset = at + color.length
        }
        if (offset < child.value.length) children.push({ type: 'text', value: child.value.slice(offset) })
      }
      parent.children = children as typeof parent.children
    }
    visit(tree)
  }
}
