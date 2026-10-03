import { describe, expect, it } from 'vitest'
import { matchesSignature } from './image-signature'

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

/** ISO BMFF の ftyp ボックス（大きさ・'ftyp'・主ブランド・版・互換ブランド） */
const ftyp = (major: string, compatible: string[]) =>
  bytes([0, 0, 0, 16 + compatible.length * 4], 'ftyp', major, [0, 0, 0, 0], ...compatible)

describe('matchesSignature', () => {
  it('PNG・JPEG・GIF・WebP の先頭のバイト', () => {
    expect(matchesSignature('image/png', bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true)
    expect(matchesSignature('image/png', bytes('PNG'))).toBe(false)
    expect(matchesSignature('image/jpeg', bytes([0xff, 0xd8, 0xff, 0xdb]))).toBe(true)
    expect(matchesSignature('image/jpeg', bytes([0xff, 0xd8]))).toBe(false)
    expect(matchesSignature('image/gif', bytes('GIF87a'))).toBe(true)
    expect(matchesSignature('image/gif', bytes('GIF90a'))).toBe(false)
    expect(matchesSignature('image/webp', bytes('RIFF', [1, 2, 3, 4], 'WEBP'))).toBe(true)
    expect(matchesSignature('image/webp', bytes('RIFF', [1, 2, 3, 4], 'WAVE'))).toBe(false)
  })

  it('AVIF: 主ブランドか互換ブランドに avif・avis があること', () => {
    expect(matchesSignature('image/avif', ftyp('avif', ['mif1']))).toBe(true)
    expect(matchesSignature('image/avif', ftyp('mif1', ['miaf', 'avis']))).toBe(true)
    expect(matchesSignature('image/avif', ftyp('heic', ['mif1', 'heic']))).toBe(false)
    expect(matchesSignature('image/avif', bytes([0, 0, 0, 16], 'moov', 'avif', [0, 0, 0, 0]))).toBe(false)
  })

  it('AVIF: ftyp ボックスの外にある avif は数えない', () => {
    const box = ftyp('mif1', ['miaf'])
    expect(matchesSignature('image/avif', Uint8Array.from([...box, ...bytes('avif')]))).toBe(false)
  })

  it('SVG: 本文に <svg を含むこと（大文字小文字は問わない）', () => {
    expect(matchesSignature('image/svg+xml', bytes('<?xml version="1.0"?>\n<SVG xmlns="x"/>'))).toBe(true)
    expect(matchesSignature('image/svg+xml', bytes('<svgx>'))).toBe(false)
    expect(matchesSignature('image/svg+xml', bytes('<html></html>'))).toBe(false)
  })
})
