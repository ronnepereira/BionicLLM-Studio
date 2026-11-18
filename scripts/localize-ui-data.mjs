// Resolve display-only data back to static source records. This deliberately
// refuses data from props, network calls, stores, messages, and user files.
import ts from 'typescript'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { resolve, dirname, relative } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const apply = process.argv[2] === 'apply'
const configFile = ts.readConfigFile(resolve(root, 'tsconfig.app.json'), ts.sys.readFile)
const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root)
const program = ts.createProgram(config.fileNames, config.options)
const checker = program.getTypeChecker()
const catalog = JSON.parse(readFileSync(resolve(root, 'src/lib/locales/pt-BR.json'), 'utf8'))
const inventoryPath = resolve(root, 'docs/localization/inventory.json')
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const candidates = []
const allowed = new Set(['label', 'description', 'desc', 'hint', 'tooltip', 'caption', 'subline', 'emptyMessage', 'text', 'short', 'placeholder', 'subtitle', 'summary', 'help'])

function sourceDeclaration(node) {
  let symbol = checker.getSymbolAtLocation(node)
  if (!symbol) return null
  if (symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
  return symbol.valueDeclaration ?? symbol.declarations?.[0]
}
function authored(node, depth = 0) {
  if (!node || depth > 8) return false
  if (ts.isArrayLiteralExpression(node) || ts.isObjectLiteralExpression(node)) return true
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return authored(node.expression, depth + 1)
  if (ts.isIdentifier(node)) {
    const declaration = sourceDeclaration(node)
    if (!declaration) return false
    if (ts.isVariableDeclaration(declaration)) return authored(declaration.initializer, depth + 1)
    if (ts.isBindingElement(declaration)) {
      const binding = declaration.parent.parent
      if (ts.isParameter(binding)) {
        const fn = binding.parent
        const call = fn.parent
        return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && ['map', 'filter', 'find'].includes(call.expression.name.text) && authored(call.expression.expression, depth + 1)
      }
      if (ts.isVariableDeclaration(binding)) return authored(binding.initializer, depth + 1)
    }
    if (ts.isParameter(declaration)) {
      const fn = declaration.parent
      const call = fn.parent
      return ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) && ['map', 'filter', 'find', 'flatMap'].includes(call.expression.name.text) && authored(call.expression.expression, depth + 1)
    }
    return false
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) return authored(node.expression, depth + 1)
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['filter', 'find', 'slice', 'sort', 'map'].includes(node.expression.name.text)) return authored(node.expression.expression, depth + 1)
  if (ts.isConditionalExpression(node)) return authored(node.whenTrue, depth + 1) && authored(node.whenFalse, depth + 1)
  return false
}
function displayData(node) {
  if (ts.isPropertyAccessExpression(node) && allowed.has(node.name.text)) return authored(node.expression)
  if (ts.isIdentifier(node)) {
    const declaration = sourceDeclaration(node)
    if (declaration && ts.isBindingElement(declaration) && allowed.has((declaration.propertyName ?? declaration.name).getText())) return authored(node)
  }
  return false
}
function ownerOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name && /^[A-Z]/.test(p.name.text) && p.body) return p
    if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && ts.isBlock(p.body)) {
      let parent = p.parent
      while (parent && (ts.isCallExpression(parent) || ts.isParenthesizedExpression(parent))) parent = parent.parent
      if (parent && ts.isVariableDeclaration(parent) && /^[A-Z]/.test(parent.name.getText())) return p
    }
  }
  return null
}

// Inventory display fields from all source data records, but never rewrite
// their stored values: IDs and comparisons continue using the original keys.
for (const sf of program.getSourceFiles()) {
  if (!sf.fileName.replaceAll('\\', '/').startsWith(root.replaceAll('\\', '/') + '/src/') || sf.fileName.includes('__tests__') || sf.fileName.includes('/mobile/')) continue
  function inventoryVisit(node) {
    if (ts.isVariableDeclaration(node) && /(?:_PLACEHOLDER|_REASON|_HINT|_NOTE|_WARNING|_COPY|_DESCRIPTION|_TEXT|_TITLE)$/.test(node.name.getText(sf)) && node.initializer) {
      function collect(child) {
        if ((ts.isStringLiteral(child) || ts.isNoSubstitutionTemplateLiteral(child)) && /[a-zA-Z]{2}/.test(child.text) && child.text.length < 2500 && !/^(https?:|\/|[A-Z]:\\)/.test(child.text)) inventory[child.text] ??= [relative(root, sf.fileName)]
        ts.forEachChild(child, collect)
      }
      collect(node.initializer)
    }
    if (ts.isPropertyAssignment(node) && (allowed.has(node.name.getText(sf).replace(/['"]/g, '')) || node.name.getText(sf) === 'title' || (sf.fileName.replaceAll('\\', '/').endsWith('/lib/skills.ts') && node.name.getText(sf) === 'name')) && (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))) {
      const value = node.initializer.text
      if (/[A-Za-z]{2}/.test(value) && !/^(https?:|\/|[A-Z]:\\)/.test(value) && value.length < 2500) inventory[value] ??= [relative(root, sf.fileName)]
    }
    ts.forEachChild(node, inventoryVisit)
  }
  inventoryVisit(sf)
  if (!sf.fileName.endsWith('.tsx') || !sf.fileName.includes('components')) continue
  const edits = [], owners = new Set()
  function visit(node) {
    if (ts.isJsxAttribute(node) && ['options', 'items'].includes(node.name.getText(sf)) && node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isArrayLiteralExpression(node.initializer.expression)) {
      const owner = ownerOf(node)
      if (owner) for (const element of node.initializer.expression.elements) if (ts.isObjectLiteralExpression(element)) for (const prop of element.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name.getText(sf) === 'label' && ts.isStringLiteral(prop.initializer) && Object.hasOwn(catalog, prop.initializer.text)) {
          edits.push({ start: prop.initializer.getStart(sf), end: prop.initializer.end, value: `uiText(${JSON.stringify(prop.initializer.text)})` })
          owners.add(owner)
        }
      }
    }
    if (ts.isJsxExpression(node) && node.expression && displayData(node.expression) && !ts.isJsxAttribute(node.parent) && !sf.fileName.endsWith('SpeechSettings.tsx') && !sf.fileName.endsWith('ModelsStep.tsx')) {
      const owner = ownerOf(node)
      if (owner) {
        candidates.push(`${relative(root, sf.fileName)}: ${node.expression.getText(sf)}`)
        edits.push({ start: node.expression.getStart(sf), end: node.expression.end, value: `uiText(${node.expression.getText(sf)})` })
        owners.add(owner)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  if (!apply || !edits.length) continue
  const source = readFileSync(sf.fileName, 'utf8')
  for (const owner of owners) if (!owner.body.statements.some(s => /const uiText = useUiText\(\)/.test(s.getText(sf)))) edits.push({ start: owner.body.getStart(sf) + 1, end: owner.body.getStart(sf) + 1, value: '\n  const uiText = useUiText()\n' })
  if (!source.includes('import { useUiText }')) {
    const importPath = relative(dirname(sf.fileName), resolve(root, 'src/lib/ui-text')).replaceAll('\\', '/')
    edits.push({ start: 0, end: 0, value: `import { useUiText } from ${JSON.stringify(importPath.startsWith('.') ? importPath : './' + importPath)}\n` })
  }
  const backup = resolve(process.env.USERPROFILE, 'BionicLLM-backups/2026-11-02-traducao', relative(root, sf.fileName))
  if (!existsSync(backup)) { mkdirSync(dirname(backup), { recursive: true }); writeFileSync(backup, source) }
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end)
  writeFileSync(sf.fileName, result)
}
writeFileSync(inventoryPath, JSON.stringify(Object.fromEntries(Object.entries(inventory).sort()), null, 2) + '\n')
writeFileSync(resolve(root, 'docs/localization/data-boundaries.txt'), candidates.join('\n') + '\n')
console.log(JSON.stringify({ mode: apply ? 'apply' : 'inventory', catalogEntries: Object.keys(catalog).length, inventoryEntries: Object.keys(inventory).length, staticDisplayBoundaries: candidates.length }))
