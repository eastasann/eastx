/**
 * docs/06_design-tokens.json（DTCG 形式）を Panda CSS のトークン定義に変換する。
 * 型と Panda の対応は SDD ADR-014 の対応表が正。
 *
 * - プリミティブ層は `primitive` の名前空間に出す（`make lint` が src/ からの参照を止める）
 * - セマンティックの color は light/dark を `base`/`_dark` の条件付きの値にまとめる
 * - typography は Panda の textStyles に、transition は durations と easings の組に展開する
 */

type DtcgNode = {
  $type?: string
  $value?: unknown
  $description?: string
  [key: string]: unknown
}

type Leaf = { path: string[]; type: string; value: unknown }

type TokenRecord = Record<string, unknown>

/** DTCG の木を、$type を継承しながら葉（$value を持つノード）の一覧にする */
export function flattenTokens(node: DtcgNode, path: string[] = [], inheritedType?: string): Leaf[] {
  const type = (node.$type as string | undefined) ?? inheritedType
  if ('$value' in node) {
    if (!type) throw new Error(`$type が決まらないトークン: ${path.join('.')}`)
    return [{ path, type, value: node.$value }]
  }
  const leaves: Leaf[] = []
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) continue
    leaves.push(...flattenTokens(child as DtcgNode, [...path, key], type))
  }
  return leaves
}

/** DTCG のパス（primitive.color.neutral.0 など）を Panda のトークンパスに変換する */
export function toPandaPath(path: string[]): string[] {
  const [layer, group, ...rest] = path
  if (layer !== 'primitive' && layer !== 'semantic') throw new Error(`未知の層: ${path.join('.')}`)
  if (group === 'font') {
    const [sub, ...name] = rest
    const category = { family: 'fonts', size: 'fontSizes', weight: 'fontWeights', 'letter-spacing': 'letterSpacings' }[
      sub ?? ''
    ]
    if (!category) throw new Error(`未知の font グループ: ${path.join('.')}`)
    return layer === 'primitive' ? [category, 'primitive', ...name] : [category, ...name]
  }
  const category = {
    color: 'colors',
    space: 'spacing',
    size: 'sizes',
    radius: 'radii',
    shadow: 'shadows',
    duration: 'durations',
    easing: 'easings',
    ratio: 'aspectRatios',
    'aspect-ratio': 'aspectRatios',
    opacity: 'opacities',
    z: 'zIndex',
    'z-index': 'zIndex',
  }[group ?? '']
  if (!category) throw new Error(`未知のトークングループ: ${path.join('.')}`)
  return layer === 'primitive' ? [category, 'primitive', ...rest] : [category, ...rest]
}

/** DTCG の参照（{primitive.color.neutral.0}）を Panda の参照（{colors.primitive.neutral.0}）に変換する */
export function toPandaRef(ref: string): string {
  const m = /^\{(.+)\}$/.exec(ref)
  if (!m?.[1]) throw new Error(`参照の形式が不正: ${ref}`)
  return `{${toPandaPath(m[1].split('.')).join('.')}}`
}

function isRef(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('{') && value.endsWith('}')
}

type DtcgColor = { components: [number, number, number]; alpha?: number; hex: string }
type DtcgDimension = { value: number; unit: string }

/** 葉の $value を CSS の値（文字列・数値）にする。参照はそのまま Panda の参照に変換する */
export function toCssValue(type: string, value: unknown): string | number {
  if (isRef(value)) return toPandaRef(value)
  switch (type) {
    case 'color': {
      const c = value as DtcgColor
      if (c.alpha !== undefined && c.alpha !== 1) {
        const [r, g, b] = c.components
        return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${c.alpha})`
      }
      return c.hex
    }
    case 'dimension':
    case 'duration': {
      const d = value as DtcgDimension
      return `${d.value}${d.unit}`
    }
    case 'fontFamily': {
      const families = value as string[]
      return families.map((f) => (f.includes(' ') ? `'${f}'` : f)).join(', ')
    }
    case 'fontWeight':
    case 'number':
      // Panda 2 のコンパイラはトークン値に数値を受け付けないので文字列にする
      return String(value as number)
    case 'cubicBezier': {
      const [a, b, c, d] = value as [number, number, number, number]
      return `cubic-bezier(${a}, ${b}, ${c}, ${d})`
    }
    case 'shadow': {
      const s = value as {
        color: string
        offsetX: DtcgDimension
        offsetY: DtcgDimension
        blur: DtcgDimension
        spread: DtcgDimension
      }
      const dim = (d: DtcgDimension) => `${d.value}${d.unit}`
      return `${dim(s.offsetX)} ${dim(s.offsetY)} ${dim(s.blur)} ${dim(s.spread)} ${toPandaRef(s.color)}`
    }
    default:
      throw new Error(`未知の $type: ${type}`)
  }
}

function setDeep(target: TokenRecord, path: string[], value: unknown): void {
  let node = target
  for (const key of path.slice(0, -1)) {
    node[key] ??= {}
    node = node[key] as TokenRecord
  }
  const last = path[path.length - 1]
  if (last === undefined) throw new Error('空のパス')
  node[last] = value
}

function getDeep(source: TokenRecord, path: string[]): unknown {
  let node: unknown = source
  for (const key of path) {
    if (typeof node !== 'object' || node === null) return undefined
    node = (node as TokenRecord)[key]
  }
  return node
}

/** 参照をたどってプリミティブの CSS 値に解決する（textStyles は生成時に解決して埋め込む） */
function resolveRef(doc: DtcgNode, ref: string): string | number {
  const m = /^\{(.+)\}$/.exec(ref)
  if (!m?.[1]) throw new Error(`参照の形式が不正: ${ref}`)
  const path = m[1].split('.')
  const node = getDeep(doc as TokenRecord, path) as DtcgNode | undefined
  if (!node || !('$value' in node)) throw new Error(`参照先が見つからない: ${ref}`)
  const type = inferType(doc, path)
  return toCssValue(type, node.$value)
}

function inferType(doc: DtcgNode, path: string[]): string {
  let node: DtcgNode | undefined = doc
  let type: string | undefined
  for (const key of path) {
    node = node?.[key] as DtcgNode | undefined
    if (!node) throw new Error(`パスが見つからない: ${path.join('.')}`)
    type = (node.$type as string | undefined) ?? type
  }
  if (!type) throw new Error(`$type が決まらない: ${path.join('.')}`)
  return type
}

export type PandaTheme = {
  tokens: TokenRecord
  semanticTokens: TokenRecord
  textStyles: TokenRecord
}

export function buildPandaTheme(doc: DtcgNode): PandaTheme {
  const tokens: TokenRecord = {}
  const semanticTokens: TokenRecord = {}
  const textStyles: TokenRecord = {}

  for (const leaf of flattenTokens((doc.primitive ?? {}) as DtcgNode, ['primitive'])) {
    setDeep(tokens, toPandaPath(leaf.path), { value: toCssValue(leaf.type, leaf.value) })
  }

  const semantic = (doc.semantic ?? {}) as DtcgNode
  const lightColors = new Map<string, Leaf>()
  const darkColors = new Map<string, Leaf>()

  for (const leaf of flattenTokens(semantic, ['semantic'])) {
    const [, group, ...rest] = leaf.path
    if (group === 'color') {
      const [mode, ...name] = rest
      if (mode === 'light') lightColors.set(name.join('.'), leaf)
      else if (mode === 'dark') darkColors.set(name.join('.'), leaf)
      else throw new Error(`semantic.color の直下は light/dark だけ: ${leaf.path.join('.')}`)
      continue
    }
    if (group === 'typography') {
      const name = rest.join('.')
      const t = leaf.value as Record<string, unknown>
      setDeep(textStyles, [name], {
        value: {
          fontFamily: resolveRef(doc, t.fontFamily as string),
          fontSize: resolveRef(doc, t.fontSize as string),
          fontWeight: resolveRef(doc, t.fontWeight as string),
          letterSpacing: resolveRef(doc, t.letterSpacing as string),
          lineHeight: t.lineHeight as number,
        },
      })
      continue
    }
    if (group === 'motion') {
      // transition は durations と easings のセマンティックトークンの組に展開する（ADR-014）。
      // delay は仕様にないので、0 以外が来たら黙って落とさずに止める
      const t = leaf.value as { duration: string; delay: string; timingFunction: string }
      if (resolveRef(doc, t.delay) !== '0ms') throw new Error(`motion の delay は展開先がない: ${leaf.path.join('.')}`)
      setDeep(semanticTokens, ['durations', 'motion', ...rest], { value: toPandaRef(t.duration) })
      setDeep(semanticTokens, ['easings', 'motion', ...rest], { value: toPandaRef(t.timingFunction) })
      continue
    }
    setDeep(semanticTokens, toPandaPath(leaf.path), { value: toCssValue(leaf.type, leaf.value) })
  }

  for (const [name, light] of lightColors) {
    const dark = darkColors.get(name)
    if (!dark) throw new Error(`dark の対になる色がない: semantic.color.light.${name}`)
    setDeep(semanticTokens, ['colors', ...name.split('.')], {
      value: { base: toCssValue('color', light.value), _dark: toCssValue('color', dark.value) },
    })
  }
  for (const name of darkColors.keys()) {
    if (!lightColors.has(name)) throw new Error(`light の対になる色がない: semantic.color.dark.${name}`)
  }

  return { tokens, semanticTokens, textStyles }
}
