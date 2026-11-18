// Expand coverage only when browser text matches a literal in app source.
// Never send observed model/user content to a translation service.
import ts from 'typescript'
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { resolve, relative } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const inventoryPath = resolve(root, 'docs/localization/inventory.json')
const inventory = JSON.parse(readFileSync(inventoryPath, 'utf8'))
const visible = JSON.parse(readFileSync(resolve(root, 'docs/localization/visible-copy.json'), 'utf8'))
const lines = new Set(Object.values(visible).flatMap(text => text.split('\n').map(line => line.trim())).filter(line => line.length > 8))
let added = 0
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['__tests__', 'mobile', 'locales'].includes(entry.name)) continue
    const file = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(file)
    else if (/\.tsx?$/.test(file) && !file.endsWith('src\\lib\\i18n.ts') && !file.endsWith('src/lib/i18n.ts')) {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node) {
        const modelName = ts.isPropertyAssignment(node.parent) && node.parent.name.getText(sf).replace(/['"]/g, '') === 'name' && /[\\/]api[\\/]/.test(file)
        if (!modelName && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && lines.has(node.text.trim()) && !Object.hasOwn(inventory, node.text)) {
          inventory[node.text] = [relative(root, file)]
          added++
        }
        ts.forEachChild(node, visit)
      }
      visit(sf)
    }
  }
}
walk(resolve(root, 'src'))
writeFileSync(inventoryPath, JSON.stringify(Object.fromEntries(Object.entries(inventory).sort()), null, 2) + '\n')
console.log(`Added ${added} observed messages verified against authored source literals`)
