import { describe, expect, it } from 'vitest'
import { hasDetailPage } from './detail'

describe('hasDetailPage', () => {
  it('詳細本文が日英のどちらかにあれば true', () => {
    expect(hasDetailPage('## 背景', null)).toBe(true)
    expect(hasDetailPage(null, '## Background')).toBe(true)
    expect(hasDetailPage(null, null)).toBe(false)
    expect(hasDetailPage('  ', null)).toBe(false)
  })
})
