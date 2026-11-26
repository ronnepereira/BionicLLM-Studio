import type { Root } from 'mdast'
import type { InlineMath } from 'mdast-util-math'
import type {} from 'micromark-extension-math'
import type { Code, Construct, Extension, State } from 'micromark-util-types'
import type { Plugin } from 'unified'

const DOLLAR = 36
const BACKSLASH = 92
const OPEN_PAREN = 40
const CLOSE_PAREN = 41
const OPEN_BRACKET = 91
const CLOSE_BRACKET = 93

const digit = (code: Code) => code !== null && code >= 48 && code <= 57
const lineEnding = (code: Code) => code === -5 || code === -4 || code === -3
const space = (code: Code) => code === 32 || code === -2 || code === -1 || lineEnding(code)

// Emit remark-math's existing tokens so code spans, fenced code, escaped
// delimiters and Markdown containers retain their normal parser precedence.
const chatMath: Construct = {
  previous(code) {
    return code !== DOLLAR || this.events.at(-1)?.[1].type === 'characterEscape'
  },
  tokenize(effects, ok, nok) {
    let closing: Code
    let dollar = false
    let hasValue = false
    let last: Code = null

    return start

    function start(code: Code): State | undefined {
      dollar = code === DOLLAR
      effects.enter('mathText')
      effects.enter('mathTextSequence')
      effects.consume(code)
      if (!dollar) return backslashOpen
      effects.exit('mathTextSequence')
      return dollarOpen
    }

    function dollarOpen(code: Code): State | undefined {
      // Leave double-dollar syntax to remark-math. A single-dollar opener
      // needs non-whitespace, and the closer cannot be followed by a digit.
      if (code === null || code === DOLLAR || space(code)) return nok(code)
      return body(code)
    }

    function backslashOpen(code: Code): State | undefined {
      if (code !== OPEN_PAREN && code !== OPEN_BRACKET) return nok(code)
      closing = code === OPEN_PAREN ? CLOSE_PAREN : CLOSE_BRACKET
      effects.consume(code)
      effects.exit('mathTextSequence')
      return body
    }

    function body(code: Code): State | undefined {
      if (code === null || (dollar && lineEnding(code))) return nok(code)
      if (dollar && code === DOLLAR) {
        if (!hasValue || space(last)) return nok(code)
        effects.enter('mathTextSequence')
        effects.consume(code)
        effects.exit('mathTextSequence')
        return dollarClose
      }
      if (code === BACKSLASH) {
        effects.enter('mathTextData')
        effects.consume(code)
        return afterBackslash
      }
      if (lineEnding(code)) {
        effects.enter('lineEnding')
        effects.consume(code)
        effects.exit('lineEnding')
        return body
      }
      effects.enter('mathTextData')
      return data(code)
    }

    function data(code: Code): State | undefined {
      if (code === null || lineEnding(code) || code === BACKSLASH || (dollar && code === DOLLAR)) {
        effects.exit('mathTextData')
        return body(code)
      }
      last = code
      if (!space(code)) hasValue = true
      effects.consume(code)
      return data
    }

    function afterBackslash(code: Code): State | undefined {
      if (!dollar && code === closing) {
        if (!hasValue) return nok(code)
        const delimiter = effects.exit('mathTextData')
        delimiter.type = 'mathTextSequence'
        effects.enter('mathTextSequence')
        effects.consume(code)
        effects.exit('mathTextSequence')
        effects.exit('mathText')
        return ok
      }
      hasValue = true
      last = BACKSLASH
      if (code === BACKSLASH || (dollar && code === DOLLAR)) {
        last = code
        effects.consume(code)
        return data
      }
      return data(code)
    }

    function dollarClose(code: Code): State | undefined {
      if (code === DOLLAR || digit(code)) return nok(code)
      effects.exit('mathText')
      return ok(code)
    }
  },
}

const extension: Extension = { text: { [DOLLAR]: chatMath, [BACKSLASH]: chatMath } }

export const remarkChatMath: Plugin<[], Root> = function () {
  const extensions = this.data('micromarkExtensions') ?? []
  this.data('micromarkExtensions', [...extensions, extension])

  return (tree, file) => {
    const source = String(file)
    function visit(node: Root | Root['children'][number] | InlineMath) {
      if (node.type === 'inlineMath') {
        const start = node.position?.start.offset
        if (start !== undefined && source.startsWith('\\[', start) && node.data?.hProperties) {
          node.data.hProperties.className = ['language-math', 'math-display']
        }
      }
      if ('children' in node) node.children.forEach(visit)
    }
    visit(tree)
  }
}
