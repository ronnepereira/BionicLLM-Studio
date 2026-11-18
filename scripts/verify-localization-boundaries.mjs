// Compare development backups with the localized source. A copy change must
// not change commands, input values, routes, classes, or accessibility IDs.
import ts from 'typescript'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const backup = process.argv[2] ?? resolve(process.env.USERPROFILE, 'BionicLLM-backups/2026-11-02-traducao/src/components')
const protectedAttrs = new Set(['value', 'type', 'role', 'href', 'src', 'key', 'className', 'aria-controls', 'data-testid'])
function invariants(path) {
  const sf = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const result = []
  function visit(node) {
    if (ts.isJsxAttribute(node) && protectedAttrs.has(node.name.getText(sf))) result.push(`attribute:${node.name.getText(sf)}:${node.initializer?.getText(sf) ?? ''}`)
    if (ts.isCallExpression(node) && /^(backendCall|invoke)$/.test(node.expression.getText(sf))) result.push(`command:${node.arguments[0]?.getText(sf) ?? ''}`)
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return result
}
let files = 0, checked = 0
const changed = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else if (path.endsWith('.tsx')) {
      const current = resolve(root, 'src/components', relative(backup, path))
      if (!existsSync(current)) continue
      const before = invariants(path), after = invariants(current)
      files++; checked += before.length
      if (JSON.stringify(before) !== JSON.stringify(after)) changed.push(relative(root, current))
    }
  }
}
walk(backup)
if (changed.length) {
  console.error('Review protected changes in: ' + changed.join(', '))
  process.exitCode = 1
} else console.log(`Preserved ${checked} input/route/style/accessibility/command invariants across ${files} backed-up components`)
