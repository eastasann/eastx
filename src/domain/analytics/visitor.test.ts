import { describe, expect, it } from 'vitest'
import { newSalt, saltExpiration, saltKey, visitorHash } from './visitor'

describe('日ごとの値', () => {
  it('キーは salt:{日付}', () => {
    expect(saltKey('2026-10-10')).toBe('salt:2026-10-10')
  })

  it('期限は日本時間のその日の終わり＋10分の UNIX 秒', () => {
    expect(new Date(saltExpiration('2026-10-10') * 1000).toISOString()).toBe('2026-10-10T15:10:00.000Z')
  })

  it('32バイトのランダムな値の16進で、毎回違う', () => {
    const salt = newSalt()
    expect(salt).toMatch(/^[0-9a-f]{64}$/)
    expect(newSalt()).not.toBe(salt)
  })
})

describe('visitorHash', () => {
  const base = { salt: 'a'.repeat(64), date: '2026-10-10', ipKey: '203.0.113.7', userAgent: 'Mozilla/5.0' }

  it('先頭16バイトの16進。同じ入力なら同じ値', async () => {
    const hash = await visitorHash(base)
    expect(hash).toMatch(/^[0-9a-f]{32}$/)
    expect(await visitorHash({ ...base })).toBe(hash)
  })

  it('日ごとの値・日付・IP・User-Agent のどれかが違えば違う値', async () => {
    const hash = await visitorHash(base)
    expect(await visitorHash({ ...base, salt: 'b'.repeat(64) })).not.toBe(hash)
    expect(await visitorHash({ ...base, date: '2026-10-11' })).not.toBe(hash)
    expect(await visitorHash({ ...base, ipKey: '203.0.113.8' })).not.toBe(hash)
    expect(await visitorHash({ ...base, userAgent: 'Mozilla/5.1' })).not.toBe(hash)
  })
})
