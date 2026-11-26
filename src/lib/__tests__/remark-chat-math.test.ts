import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import { visit } from 'unist-util-visit'
import { MATH_OPTIONS, chatContentNeedsKatex } from '../markdown-math'
import { remarkChatMath } from '../remark-chat-math'

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, MATH_OPTIONS)
  .use(remarkChatMath)
  .use(remarkRehype)
  .use(rehypeKatex)

async function formulas(source: string) {
  const tree = await processor.run(processor.parse(source), source)
  const tex: string[] = []
  let displays = 0
  visit(tree, 'element', node => {
    if (Array.isArray(node.properties.className) && node.properties.className.includes('katex-display')) displays++
    if (node.tagName === 'annotation' && node.properties.encoding === 'application/x-tex') {
      tex.push(node.children.map(child => child.type === 'text' ? child.value : '').join('').trim())
    }
  })
  return { tex, displays }
}

describe('chat Markdown math', () => {
  it('supports standard inline and display delimiters and math fences inside quotes', async () => {
    const source = [
      'Inline $x^2$ and \\(\\alpha+1\\).',
      '',
      '\\[',
      '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}',
      '\\]',
      '',
      '$$',
      '\\frac{1}{2}',
      '$$',
      '',
      '> ~~~math',
      '> y=4',
      '> ~~~',
    ].join('\n')
    expect(chatContentNeedsKatex(source)).toBe(true)
    expect(await formulas(source)).toEqual({
      tex: ['x^2', '\\alpha+1', '\\begin{aligned} a &= b \\\\ c &= d \\end{aligned}', '\\frac{1}{2}', 'y=4'],
      displays: 3,
    })
    expect(chatContentNeedsKatex('> ~~~math\n> x\n> ~~~')).toBe(true)
  })

  it('preserves prices, escaped delimiters, code and ordinary Markdown', async () => {
    const tick = String.fromCharCode(96)
    const source = [
      'Split the $30 bill. Each pays $10. Formula: **$2+3=5$**.',
      'R\\$ 100 and $20 with a $5 fee. Escaped \\$a\\$.',
      tick + '$code$ \\(x\\)' + tick,
      '',
      '    \\(literal\\)',
    ].join('\n')
    expect(await formulas(source)).toEqual({ tex: ['2+3=5'], displays: 0 })
  })
})
