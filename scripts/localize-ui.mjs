// Extract only authored UI copy. Never rewrite user messages, model IDs,
// commands, paths, styles, API payloads, or enum values.
import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const mode = process.argv[2] ?? 'inventory'
const catalogPath = resolve(root, 'src/lib/locales/pt-BR.json')
const catalog = existsSync(catalogPath) ? JSON.parse(readFileSync(catalogPath, 'utf8')) : {}
const inventoryFile = resolve(root, 'docs/localization/inventory.json')
const inventory = new Map(existsSync(inventoryFile) ? Object.entries(JSON.parse(readFileSync(inventoryFile, 'utf8'))) : [])
const files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (path.endsWith('.tsx') && !path.endsWith('LanguageSetting.tsx')) files.push(path)
  }
}
walk(resolve(root, 'src/components'))

const attrs = new Set(['title', 'placeholder', 'alt', 'aria-label', 'aria-description', 'aria-valuetext', 'ariaLabel', 'tooltip', 'label', 'description', 'hint', 'subtitle', 'emptyText', 'emptyLabel', 'helperText', 'confirmLabel', 'cancelLabel'])
const translatable = (s) => /[a-zA-Z]{2}/.test(s) && !/^(https?:|\/|[A-Z]:\\|--|#[\da-f]+$)/i.test(s) && !/^[\w.-]+\.(gguf|safetensors|json|py|exe|dll|png|jpg|mp4)$/i.test(s)
function jsxText(text) {
  const lines = text.split(/\r\n|\n|\r/)
  let last = 0
  lines.forEach((line, i) => { if (/[^ \t]/.test(line)) last = i })
  return lines.map((line, i) => {
    let value = line.replace(/\t/g, ' ')
    if (i !== 0) value = value.replace(/^ +/, '')
    if (i !== lines.length - 1) value = value.replace(/ +$/, '')
    return value ? value + (i !== last ? ' ' : '') : ''
  }).join('').replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
    return entity[0] === '#' ? String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1))) : named[entity]
  })
}

let changed = 0
for (const file of files) {
  if (file.endsWith('UiText.tsx')) continue
  const source = readFileSync(file, 'utf8')
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const edits = []
  const owners = new Set()
  function ownerOf(node) {
    for (let p = node.parent; p; p = p.parent) {
      if (ts.isFunctionDeclaration(p) && p.name && /^[A-Z]/.test(p.name.text) && p.body) return p
      if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isBlock(p.body)) {
        let parent = p.parent
        while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent
        if (parent && ts.isVariableDeclaration(parent) && /^[A-Z]/.test(parent.name.getText(sf))) return p
      }
    }
    return null
  }
  function add(node, value, replacement) {
    if (!translatable(value)) return
    const owner = ownerOf(node)
    if (!owner) return
    if (!inventory.has(value)) inventory.set(value, [])
    inventory.get(value).push(relative(root, file))
    if (mode !== 'apply' || !Object.hasOwn(catalog, value)) return
    edits.push({ start: node.getStart(sf), end: node.end, value: replacement(value) })
    owners.add(owner)
  }
  function expression(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      add(node, node.text, s => `uiText(${JSON.stringify(s)})`)
    } else if (ts.isConditionalExpression(node)) {
      expression(node.whenTrue); expression(node.whenFalse)
    } else if (ts.isParenthesizedExpression(node)) expression(node.expression)
    else if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(node.operatorToken.kind)) {
      if (node.operatorToken.kind === ts.SyntaxKind.BarBarToken) expression(node.left)
      expression(node.right)
    } else if (ts.isTemplateExpression(node)) {
      let text = node.head.text
      const params = []
      node.templateSpans.forEach((span, i) => {
        text += `{v${i}}` + span.literal.text
        params.push(`v${i}: ${span.expression.getText(sf)}`)
      })
      add(node, text, s => `uiText(${JSON.stringify(s)}, { ${params.join(', ')} })`)
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ['uiText', 'text'].includes(node.expression.getText(sf)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && source.includes('useUiText')) {
      const value = node.arguments[0].text
      if (!inventory.has(value)) inventory.set(value, [])
      inventory.get(value).push(relative(root, file))
    }
    if (ts.isJsxText(node)) {
      const text = jsxText(node.text)
      // getStart skips leading JSX whitespace; replace the entire text node.
      const owner = ownerOf(node)
      if (owner && translatable(text)) {
        if (!inventory.has(text)) inventory.set(text, [])
        inventory.get(text).push(relative(root, file))
        if (mode === 'apply' && Object.hasOwn(catalog, text)) {
          edits.push({ start: node.pos, end: node.end, value: `{uiText(${JSON.stringify(text)})}` })
          owners.add(owner)
        }
      }
      return
    }
    if (ts.isJsxAttribute(node)) {
      const name = node.name.getText(sf)
      // Section uses its original title as a stable navigation anchor.
      const sectionTitle = name === 'title' && node.parent.parent.tagName?.getText(sf) === 'Section'
      if (sectionTitle && node.initializer && ts.isStringLiteral(node.initializer)) {
        const text = node.initializer.text
        if (!inventory.has(text)) inventory.set(text, [])
        inventory.get(text).push(relative(root, file))
      }
      if (attrs.has(name) && !sectionTitle && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text, s => `{uiText(${JSON.stringify(s)})}`)
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) expression(node.initializer.expression)
      }
      // A prop can itself contain rendered JSX (toolbar, catalogue, actions).
      // Traverse that JSX only; never treat className or event code as copy.
      function embedded(child) {
        if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) visit(child)
        else ts.forEachChild(child, embedded)
      }
      if (node.initializer) embedded(node.initializer)
      return
    }
    if (ts.isJsxExpression(node) && node.expression) {
      expression(node.expression)
      // Nested JSX in map callbacks still needs to be visited.
    }
    // Data-authored display labels are inventoried for explicit localization
    // at their rendering boundary, without changing internal keys or anchors.
    if (ts.isPropertyAssignment(node) && ['label', 'description', 'tooltip', 'subline', 'hint'].includes(node.name.getText(sf).replace(/['"]/g, '')) && ts.isStringLiteral(node.initializer) && translatable(node.initializer.text)) {
      const text = node.initializer.text
      if (!inventory.has(text)) inventory.set(text, [])
      inventory.get(text).push(relative(root, file))
    }
    if (ts.isCallExpression(node) && /^(set\w*(Error|Warning|Notice)|setError|setDone|setSuccess|alert|confirm)$/.test(node.expression.getText(sf)) && node.arguments[0] && !(ts.isStringLiteral(node.arguments[0]) && /^[a-z_]+$/.test(node.arguments[0].text))) expression(node.arguments[0])
    ts.forEachChild(node, visit)
  }
  function inventoryCalls(node) {
    if (ts.isCallExpression(node) && ['uiText', 'text'].includes(node.expression.getText(sf)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) && source.includes('useUiText')) {
      const value = node.arguments[0].text
      if (!inventory.has(value)) inventory.set(value, [])
      inventory.get(value).push(relative(root, file))
    }
    ts.forEachChild(node, inventoryCalls)
  }
  inventoryCalls(sf)
  visit(sf)
  if (!edits.length) continue
  for (const owner of owners) if (!owner.body.statements.some(s => /const uiText = useUiText\(\)/.test(s.getText(sf)))) edits.push({ start: owner.body.getStart(sf) + 1, end: owner.body.getStart(sf) + 1, value: '\n  const uiText = useUiText()\n' })
  const importPath = relative(dirname(file), resolve(root, 'src/lib/ui-text')).replaceAll('\\', '/')
  if (!source.includes('import { useUiText }')) edits.push({ start: 0, end: 0, value: `import { useUiText } from ${JSON.stringify(importPath.startsWith('.') ? importPath : './' + importPath)}\n` })
  const backup = resolve(process.env.USERPROFILE, 'BionicLLM-backups/2026-11-02-traducao', relative(root, file))
  if (!existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); writeFileSync(backup, source) }
  // Duplicate nodes can be encountered while visiting JSX expressions.
  const unique = [...new Map(edits.map(e => [`${e.start}:${e.end}`, e])).values()]
  let result = source
  for (const edit of unique.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  writeFileSync(file, result)
  changed++
}
mkdirSync(resolve(root, 'docs/localization'), { recursive: true })
writeFileSync(inventoryFile, JSON.stringify(Object.fromEntries([...inventory].sort().map(([key, paths]) => [key, [...new Set(paths)]])), null, 2) + '\n')
console.log(JSON.stringify({ mode, strings: inventory.size, characters: [...inventory.keys()].join('').length, filesChanged: changed }))
