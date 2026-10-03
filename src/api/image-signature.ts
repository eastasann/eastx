import type { UploadContentType } from './contract/misc'

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

/** 先頭のバイトが宣言された形式と一致するか（SDD 5.10）。SVG は本文に `<svg` を含むこと */
export function matchesSignature(type: UploadContentType, bytes: Uint8Array): boolean {
  switch (type) {
    case 'image/png':
      return [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)
    case 'image/jpeg':
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case 'image/gif':
      return ['GIF87a', 'GIF89a'].includes(ascii(bytes, 0, 6))
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP'
    case 'image/avif': {
      // ISO BMFF の ftyp ボックス。主ブランドか互換ブランドに avif（静止画）か avis（連続画像）がある
      if (ascii(bytes, 4, 8) !== 'ftyp') return false
      const boxSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
      const end = Math.min(boxSize, bytes.length)
      for (let offset = 8; offset + 4 <= end; offset += offset === 8 ? 8 : 4) {
        if (['avif', 'avis'].includes(ascii(bytes, offset, offset + 4))) return true
      }
      return false
    }
    case 'image/svg+xml':
      return /<svg[\s>/]/i.test(new TextDecoder().decode(bytes))
  }
}
