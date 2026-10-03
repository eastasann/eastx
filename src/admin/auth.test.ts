import { describe, expect, it } from 'vitest'
import { loginErrorState, parseLoginSearch, safeRedirect } from './auth'

describe('loginErrorState（SDD 5.2 の表）', () => {
  it.each([
    ['unable_to_create_user', 'notAdmin'],
    ['unable_to_create_session', 'notAdmin'],
    ['forbidden', 'notAdmin'],
    ['access_denied', 'cancelled'],
    ['invalid_code', 'network'],
    ['session_check_failed', 'network'],
    ['state_not_found', 'network'],
  ] as const)('%s → %s', (error, state) => {
    expect(loginErrorState(error)).toBe(state)
  })
})

describe('safeRedirect', () => {
  it.each([
    ['/admin', '/admin'],
    ['/admin/works/0f8c', '/admin/works/0f8c'],
    ['/admin/works?status=draft#top', '/admin/works?status=draft#top'],
  ])('管理画面のパスはそのまま: %s', (value, expected) => {
    expect(safeRedirect(value)).toBe(expected)
  })

  it.each([
    [undefined],
    [''],
    ['https://evil.example/admin'],
    ['//evil.example/admin'],
    ['/\\evil.example/admin'],
    ['javascript:alert(1)'],
    ['admin'],
    ['/ja'],
    ['/administrator'],
    ['/admin/login'],
    ['/admin/login?redirect=/admin'],
    ['/admin/../ja'],
    [42],
  ])('戻れない値は /admin: %s', (value) => {
    expect(safeRedirect(value)).toBe('/admin')
  })
})

describe('parseLoginSearch', () => {
  it('知っている値だけを残す', () => {
    expect(parseLoginSearch({ redirect: '/admin/works', error: 'access_denied', loggedOut: 1, other: 'x' })).toEqual({
      redirect: '/admin/works',
      error: 'access_denied',
      loggedOut: 1,
    })
  })

  it('形の違う値は捨てる', () => {
    expect(parseLoginSearch({ redirect: 1, error: '', loggedOut: 'yes' })).toEqual({})
  })
})
