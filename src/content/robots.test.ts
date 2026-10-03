import { describe, expect, it } from 'vitest'
import { robotsTxt } from './robots'

describe('robotsTxt', () => {
  it('本番は /admin と /api だけを拒否する', () => {
    expect(robotsTxt('production')).toBe('User-agent: *\nDisallow: /admin\nDisallow: /api\n')
  })

  it('staging とローカルはすべてを拒否する', () => {
    for (const environment of ['staging', 'local']) expect(robotsTxt(environment)).toBe('User-agent: *\nDisallow: /\n')
  })
})
