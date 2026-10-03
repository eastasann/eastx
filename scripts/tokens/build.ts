/**
 * docs/06_design-tokens.json → src/styles/tokens.generated.ts
 * Bun で実行する（make tokens）。生成物は Git に入れない。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildPandaTheme } from './transform'

const root = resolve(import.meta.dirname, '../..')
const source = resolve(root, 'docs/06_design-tokens.json')
const out = resolve(root, 'src/styles/tokens.generated.ts')

const doc = JSON.parse(readFileSync(source, 'utf-8'))
const { tokens, semanticTokens, textStyles } = buildPandaTheme(doc)

const banner = `// scripts/tokens/build.ts が docs/06_design-tokens.json から生成する。手で編集しない。
// 値を変えるときは docs/06_design-tokens.json を直して make tokens（ADR-014）。
`

const body = [
  `export const tokens = ${JSON.stringify(tokens, null, 2)} as const`,
  `export const semanticTokens = ${JSON.stringify(semanticTokens, null, 2)} as const`,
  `export const textStyles = ${JSON.stringify(textStyles, null, 2)} as const`,
].join('\n\n')

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, `${banner}\n${body}\n`)
console.log(`tokens: ${out} を生成した`)
