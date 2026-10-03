import { describe, expect, it } from 'vitest'
import { rateLimitKeyOf } from './rate-limit-key'

describe('rateLimitKeyOf', () => {
  it('IPv4 はそのまま', () => {
    expect(rateLimitKeyOf('203.0.113.7')).toBe('203.0.113.7')
  })

  it.each([
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002::1', '2001:db8:1:2::/64'],
    ['2001:db8::1', '2001:db8:0:0::/64'],
    ['2001:db8:0:0:9::', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
  ])('IPv6 は上位 64 ビット: %s → %s', (ip, key) => {
    expect(rateLimitKeyOf(ip)).toBe(key)
  })

  it('IPv4 を埋め込んだ IPv6 は中の IPv4', () => {
    expect(rateLimitKeyOf('::ffff:192.0.2.1')).toBe('192.0.2.1')
  })

  it('形の崩れた値は落とさずにそのままキーにする', () => {
    expect(rateLimitKeyOf('1:2:3:4:5:6:7:8::9')).toBe('1:2:3:4:5:6:7:8::9')
    expect(rateLimitKeyOf('1:2:3')).toBe('1:2:3')
  })

  it('同じ /64 の中の別の送り元は同じキー', () => {
    expect(rateLimitKeyOf('2001:db8:aa:bb::1')).toBe(rateLimitKeyOf('2001:db8:aa:bb:1234::99'))
  })

  it('cf-connecting-ip が無ければ1つのキーにまとめる', () => {
    expect(rateLimitKeyOf(null)).toBe('unknown')
    expect(rateLimitKeyOf('')).toBe('unknown')
  })
})
