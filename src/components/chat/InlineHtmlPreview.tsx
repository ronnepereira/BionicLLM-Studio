import { useMemo } from 'react'
import { CodeBlock } from './CodeBlock'
import { HtmlPreviewFrame } from './HtmlPreviewFrame'

/** Static visual markup runs in an isolated document, with local CSS only. */
export function InlineHtmlPreview({ code, language }: { code: string; language?: string }) {
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"><style>body{margin:12px;font:14px system-ui;color:#171717;overflow-wrap:anywhere}img,svg{max-width:100%}*{box-sizing:border-box}</style></head><body>${code}</body></html>`, [code])
  return <div className="my-2 min-w-0 overflow-hidden rounded-lg border border-gray-200 dark:border-white/15">
    <HtmlPreviewFrame doc={doc} viewport="desktop" allowScripts={false} title="Elemento visual HTML e CSS" className="w-full h-[280px] border-0 bg-white" />
    <details className="px-2 py-1 text-sm"><summary className="cursor-pointer text-gray-500">Ver código HTML/CSS</summary><CodeBlock code={code} language={language} /></details>
  </div>
}
