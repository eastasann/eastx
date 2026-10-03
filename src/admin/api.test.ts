import { ORPCError } from '@orpc/client'
import { describe, expect, it, vi } from 'vitest'
import { createAuthErrorHandler } from './api'

function setup(options: { signOutFails?: boolean } = {}) {
  const navigate = vi.fn<(href: string) => void>()
  const signOut = vi.fn(() => (options.signOutFails ? Promise.reject(new Error('offline')) : Promise.resolve()))
  const beforeLoginRedirect = vi.fn(() => Promise.resolve())
  const handle = createAuthErrorHandler({
    currentPath: () => '/admin/works/0f8c?tab=en',
    beforeLoginRedirect,
    signOut,
    navigate,
  })
  return { handle, navigate, signOut, beforeLoginRedirect }
}

describe('管理画面の API クライアントの認可エラー（SDD 8章）', () => {
  it('UNAUTHORIZED は移る前の処理を待ってから、今のパスを redirect に付けて A1 へ', async () => {
    const { handle, navigate, signOut, beforeLoginRedirect } = setup()
    await handle(new ORPCError('UNAUTHORIZED', { status: 401 }))
    expect(navigate).toHaveBeenCalledWith('/admin/login?redirect=%2Fadmin%2Fworks%2F0f8c%3Ftab%3Den')
    expect(beforeLoginRedirect.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0] ?? 0)
    expect(signOut).not.toHaveBeenCalled()
  })

  it('FORBIDDEN はログアウトしてから A1 の「管理者でないアカウント」へ', async () => {
    const { handle, navigate, signOut } = setup()
    await handle(new ORPCError('FORBIDDEN', { status: 403 }))
    expect(signOut).toHaveBeenCalledOnce()
    expect(navigate).toHaveBeenCalledWith('/admin/login?error=forbidden')
    expect(signOut.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0] ?? 0)
  })

  it('FORBIDDEN でログアウトに失敗しても A1 へ移す', async () => {
    const { handle, navigate } = setup({ signOutFails: true })
    await handle(new ORPCError('FORBIDDEN', { status: 403 }))
    expect(navigate).toHaveBeenCalledWith('/admin/login?error=forbidden')
  })

  it.each([
    new ORPCError('SLUG_CONFLICT', { status: 409 }),
    new ORPCError('CSRF_TOKEN_MISMATCH', { status: 403 }),
    new TypeError('Failed to fetch'),
  ])('それ以外のエラーでは移さない: %s', async (error) => {
    const { handle, navigate, signOut, beforeLoginRedirect } = setup()
    await handle(error)
    expect(navigate).not.toHaveBeenCalled()
    expect(signOut).not.toHaveBeenCalled()
    expect(beforeLoginRedirect).not.toHaveBeenCalled()
  })
})
