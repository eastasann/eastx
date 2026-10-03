/**
 * シードのダミー画像（design-spec 8章「画像はダミー画像を使う」）。
 * 画像のライブラリを入れずに済むよう SVG で作る。SVG はアップロードで許す形式で、
 * `/media/*` は SVG に専用の CSP を付けて配信する（SDD 5.10）。
 */

export type SeedImage = {
  /** R2 のキー。`uploads/{yyyy}/{mm}/{uuid}.{拡張子}`（ADR-010） */
  key: string
  /** DB に持つルート相対のパス */
  url: string
  body: string
  contentType: 'image/svg+xml'
}

// シードを何度入れ直しても同じキーに上書きされるよう、UUID は通し番号から決める
const seedUuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function svg(width: number, height: number, hue: number, label: string): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="100%" height="100%" fill="hsl(${hue} 45% 55%)"/>`,
    `<text x="50%" y="50%" fill="#ffffff" font-family="sans-serif" font-size="${Math.round(height / 6)}"`,
    ` text-anchor="middle" dominant-baseline="middle">${escapeXml(label)}</text>`,
    '</svg>',
  ].join('')
}

export type ImageFactory = {
  /** ダミー画像を1つ作って登録し、DB に入れるパスを返す。`kind` で縦横比を変える（サムネイルは 16:9、写真とアイコンは 1:1） */
  url: (kind: 'thumbnail' | 'avatar' | 'icon', label: string) => string
  /** 作った画像。R2 に置くもの */
  images: SeedImage[]
}

/** 通し番号はファクトリーごとに 1 から振る。同じ順で作れば、何度作っても同じキーになる */
export function createImageFactory(): ImageFactory {
  const images: SeedImage[] = []
  return {
    images,
    url(kind, label) {
      const n = images.length + 1
      const key = `uploads/2026/01/${seedUuid(n)}.svg`
      const hue = (n * 47) % 360
      const body = kind === 'thumbnail' ? svg(1280, 720, hue, label) : svg(256, 256, hue, label)
      const url = `/media/${key}`
      images.push({ key, url, body, contentType: 'image/svg+xml' })
      return url
    },
  }
}
