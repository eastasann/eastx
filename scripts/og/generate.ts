/**
 * 既定の OGP 画像（public/og/default-{ja,en}.png、1200×630）と、favicon（public/favicon.png）・iOS のホーム画面の
 * アイコン（public/apple-touch-icon.png）を作る（ADR-019）。
 * OGP 画像の色と書体は docs/06_design-tokens.json のセマンティック層（ライト）から読み、トークンを変えたら作り直してコミットする。
 * favicon とホーム画面のアイコンは、持ち主の絵（scripts/og/favicon-source.png）の円の部分を切り抜いて作る。
 * OGP 画像はトークンの色で組んだ HTML を、アイコンは元の絵を切り抜く HTML を、Playwright の Chromium で撮る。実行: `bun scripts/og/generate.ts`
 * （Chromium は make setup が入れる）。和文は OS のゴシック体で描くので、撮る環境で字形が変わりうる
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { chromium } from '@playwright/test'
import { LANGS } from '../../src/i18n/detect'
import { getMessages } from '../../src/i18n/messages'
import { flattenTokens, toCssValue } from '../tokens/transform'

const root = resolve(import.meta.dirname, '../..')
const WIDTH = 1200
const HEIGHT = 630

const doc = JSON.parse(readFileSync(resolve(root, 'docs/06_design-tokens.json'), 'utf-8'))
const leaves = new Map(flattenTokens(doc).map((leaf) => [leaf.path.join('.'), leaf]))

/** トークンの値を、参照をたどって CSS の値にする */
function token(path: string): string {
  const leaf = leaves.get(path)
  if (!leaf) throw new Error(`トークンがない: ${path}`)
  if (typeof leaf.value === 'string' && leaf.value.startsWith('{')) return token(leaf.value.slice(1, -1))
  return String(toCssValue(leaf.type, leaf.value))
}

const color = {
  canvas: token('semantic.color.light.bg.canvas'),
  text: token('semantic.color.light.text.default'),
  muted: token('semantic.color.light.text.muted'),
  accent: token('semantic.color.light.accent.default'),
}
// 書体はセマンティック層の display（ページの大見出しと同じ）から、参照をたどって読む
const display = leaves.get('semantic.typography.display')?.value as { fontFamily?: string } | undefined
if (!display?.fontFamily) throw new Error('semantic.typography.display の fontFamily がない')
const fontFamily = token(display.fontFamily.slice(1, -1))

// about:blank のページからは file:// のフォントを読めないので、欧文の可変フォントを data URL で埋め込む
const sans = readFileSync(
  resolve(root, 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2'),
).toString('base64')

function ogHtml(lang: (typeof LANGS)[number]): string {
  const messages = getMessages(lang)
  const sections = [messages.section.career, messages.section.works, messages.section.blog].join(' · ')
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<style>
  @font-face { font-family: 'Geist Variable'; src: url(data:font/woff2;base64,${sans}) format('woff2'); font-weight: 100 900; }
  html, body { margin: 0; }
  body {
    width: ${WIDTH}px; height: ${HEIGHT}px; box-sizing: border-box; padding: 96px;
    display: flex; flex-direction: column; justify-content: center; gap: 32px;
    background: ${color.canvas}; color: ${color.text}; font-family: ${fontFamily};
    border-left: 24px solid ${color.accent};
  }
  .name { font-size: 120px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; }
  .sections { font-size: 40px; color: ${color.muted}; }
</style>
</head>
<body>
  <div class="name">${messages.siteName}</div>
  <div class="sections">${sections}</div>
</body>
</html>`
}

/**
 * 元の絵（1254×1254）の中の円の外接正方形。絵を差し替えたら測り直す。円の外の黒い地を落として、小さく縮めても
 * 人物が分かる大きさにする
 */
const ICON_SOURCE = resolve(import.meta.dirname, 'favicon-source.png')
const ICON_SOURCE_SIZE = 1254
const CIRCLE = { left: 193, top: 185, size: 870 }

/**
 * 円の外接正方形を `size` の大きさで描く HTML。`round` なら円の外を透明にする（favicon）。ホーム画面のアイコンは iOS が
 * 透明を埋めてしまうので円にせず、元の絵の黒い角を残す
 */
function iconHtml(size: number, round: boolean): string {
  const scale = size / CIRCLE.size
  const src = `data:image/png;base64,${readFileSync(ICON_SOURCE).toString('base64')}`
  return `<!doctype html>
<html>
<head>
<style>
  html, body { margin: 0; background: transparent; }
  .icon { width: ${size}px; height: ${size}px; overflow: hidden; position: relative; ${round ? 'border-radius: 50%;' : ''} }
  .icon img {
    position: absolute;
    left: ${-CIRCLE.left * scale}px;
    top: ${-CIRCLE.top * scale}px;
    width: ${ICON_SOURCE_SIZE * scale}px;
    height: ${ICON_SOURCE_SIZE * scale}px;
  }
</style>
</head>
<body><div class="icon"><img src="${src}" alt=""></div></body>
</html>`
}

const ICONS = [
  { path: 'public/favicon.png', size: 64, round: true },
  { path: 'public/apple-touch-icon.png', size: 180, round: false },
] as const

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
  for (const lang of LANGS) {
    await page.setContent(ogHtml(lang))
    await page.evaluate(() => document.fonts.ready)
    const out = resolve(root, `public/og/default-${lang}.png`)
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
    console.log(`og: ${out} を作った`)
  }
  for (const icon of ICONS) {
    const iconPage = await browser.newPage({ viewport: { width: icon.size, height: icon.size }, deviceScaleFactor: 1 })
    await iconPage.setContent(iconHtml(icon.size, icon.round))
    await iconPage.locator('img').evaluate((image: HTMLImageElement) => image.decode())
    const out = resolve(root, icon.path)
    await iconPage.screenshot({
      path: out,
      omitBackground: true,
      clip: { x: 0, y: 0, width: icon.size, height: icon.size },
    })
    await iconPage.close()
    console.log(`og: ${out} を作った`)
  }
} finally {
  await browser.close()
}
