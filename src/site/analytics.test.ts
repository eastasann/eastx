import { describe, expect, it, vi } from 'vitest'
import {
  type BeaconEnvironment,
  createBeacon,
  isCodeCopy,
  isTrackingAllowed,
  newBeaconState,
  outboundOf,
  utmOf,
} from './analytics'

function setup(overrides: Partial<BeaconEnvironment> = {}) {
  const sent: Record<string, unknown>[] = []
  const location = { pathname: '/ja', search: '?utm_source=LinkedIn&utm_medium=social' }
  let error = false
  const env: BeaconEnvironment = {
    sendBeacon: (_, data) => {
      void data.text().then((text) => sent.push(JSON.parse(text)))
      return true
    },
    fetch: vi.fn(async () => new Response(null, { status: 204 })),
    location,
    referrer: 'https://www.linkedin.com/feed/',
    lang: () => (location.pathname.startsWith('/en') ? 'en' : 'ja'),
    isErrorPage: () => error,
    ...overrides,
  }
  const beacon = createBeacon(env)
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0)).then(() => sent)
  return { beacon, location, flush, setError: (value: boolean) => (error = value), env }
}

describe('isTrackingAllowed', () => {
  it('DNT・GPC・自動操作のブラウザは送らない', () => {
    expect(isTrackingAllowed({})).toBe(true)
    expect(isTrackingAllowed({ doNotTrack: '0', globalPrivacyControl: false, webdriver: false })).toBe(true)
    expect(isTrackingAllowed({ doNotTrack: '1' })).toBe(false)
    expect(isTrackingAllowed({ globalPrivacyControl: true })).toBe(false)
    expect(isTrackingAllowed({ webdriver: true })).toBe(false)
  })
})

describe('createBeacon の page_view', () => {
  it('最初の1回だけ referrer と utm を付け、path と lang を足す', async () => {
    const { beacon, location, flush } = setup()
    beacon.pageView()
    location.pathname = '/ja/works/my-app'
    location.search = ''
    beacon.pageView()
    expect(await flush()).toEqual([
      {
        type: 'page_view',
        referrer: 'https://www.linkedin.com/feed/',
        utm: { source: 'LinkedIn', medium: 'social', campaign: null },
        path: '/ja',
        lang: 'ja',
      },
      { type: 'page_view', path: '/ja/works/my-app', lang: 'ja' },
    ])
  })

  it('前回と同じ path は送らない（初期化の後の onResolved、ハッシュだけの移動）', async () => {
    const { beacon, flush } = setup()
    beacon.pageView()
    beacon.pageView()
    expect(await flush()).toHaveLength(1)
  })

  it('戻る・進むで path が変われば送る', async () => {
    const { beacon, location, flush } = setup()
    beacon.pageView()
    location.pathname = '/en'
    beacon.pageView()
    location.pathname = '/ja'
    beacon.pageView()
    expect((await flush()).map((event) => [event.path, event.lang])).toEqual([
      ['/ja', 'ja'],
      ['/en', 'en'],
      ['/ja', 'ja'],
    ])
  })

  it('bfcache から戻ったら、同じ path でももう一度送る（referrer は付けない）', async () => {
    const { beacon, flush } = setup()
    beacon.pageView()
    beacon.restored()
    const sent = await flush()
    expect(sent).toHaveLength(2)
    expect(sent[1]).toEqual({ type: 'page_view', path: '/ja', lang: 'ja' })
  })

  it('C2 を出しているあいだは送らず、移った先が C2 でなければ送る', async () => {
    const { beacon, location, flush, setError } = setup()
    setError(true)
    beacon.pageView()
    beacon.track({ type: 'lang_switch', to: 'en' })
    setError(false)
    location.pathname = '/ja/blog/hello'
    beacon.pageView()
    const sent = await flush()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ type: 'page_view', path: '/ja/blog/hello' })
  })

  it('同じ文書で部品を作り直しても（C1 と画面の行き来）、参照元を二度送らず、同じ path を二度送らない', async () => {
    const state = newBeaconState()
    const first = setup()
    createBeacon(first.env, state).pageView()
    const again = setup()
    const beacon = createBeacon(again.env, state)
    beacon.pageView()
    again.location.pathname = '/fr/foo'
    beacon.pageView()
    expect(await first.flush()).toHaveLength(1)
    expect(await again.flush()).toEqual([{ type: 'page_view', path: '/fr/foo', lang: 'ja' }])
  })

  it('上限を超える参照元は origin にして送る', async () => {
    const { beacon, flush } = setup({ referrer: `https://example.com/${'a'.repeat(3000)}` })
    beacon.pageView()
    expect((await flush())[0]?.referrer).toBe('https://example.com')
  })
})

describe('createBeacon の送り方', () => {
  it('行動に path と lang を足して送る', async () => {
    const { beacon, flush } = setup()
    beacon.track({ type: 'row_expand', section: 'works', itemId: 'a7e3c1d2-5b7d-4c1e-9a3f-2d6b8e4f1a07' })
    expect(await flush()).toEqual([
      { type: 'row_expand', section: 'works', itemId: 'a7e3c1d2-5b7d-4c1e-9a3f-2d6b8e4f1a07', path: '/ja', lang: 'ja' },
    ])
  })

  it('sendBeacon が無い・送れないときは keepalive の fetch で text/plain', async () => {
    for (const sendBeacon of [undefined, () => false]) {
      const fetch = vi.fn(async () => new Response(null, { status: 204 }))
      const { beacon } = setup({ sendBeacon, fetch })
      beacon.track({ type: 'code_copy' })
      expect(fetch).toHaveBeenCalledWith('/api/collect', {
        method: 'POST',
        body: JSON.stringify({ type: 'code_copy', path: '/ja', lang: 'ja' }),
        keepalive: true,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
      })
    }
  })

  it('fetch の失敗は訪問者の操作に出さない', async () => {
    const { beacon } = setup({ sendBeacon: undefined, fetch: () => Promise.reject(new TypeError('offline')) })
    expect(() => beacon.track({ type: 'code_copy' })).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
})

describe('utmOf', () => {
  it('どれも無ければ送らない。上限を超える値と | を含む値は落とす', () => {
    expect(utmOf('')).toBeUndefined()
    expect(utmOf('?ref=x')).toBeUndefined()
    expect(utmOf(`?utm_source=${'a'.repeat(101)}&utm_campaign=fall`)).toEqual({
      source: null,
      medium: null,
      campaign: 'fall',
    })
    expect(utmOf('?utm_source=a|b')).toBeUndefined()
  })
})

describe('outboundOf・isCodeCopy', () => {
  const target = (anchor: { href?: string; attr?: string | null } | null, copy = false) => ({
    closest: (selector: string) => {
      if (selector === '[data-code-copy]') return copy ? { getAttribute: () => null } : null
      return anchor === null ? null : { href: anchor.href, getAttribute: () => anchor.attr ?? null }
    },
  })

  it('別タブのリンクの種類（属性が無ければ body）と行き先のホスト名', () => {
    expect(outboundOf(target({ href: 'https://github.com/a/b', attr: 'github' }))).toEqual({
      type: 'outbound',
      linkKind: 'github',
      host: 'github.com',
    })
    expect(outboundOf(target({ href: 'https://example.com/x' }))).toMatchObject({ linkKind: 'body' })
    expect(outboundOf(target({ href: 'https://example.com/x', attr: 'unknown' }))).toMatchObject({ linkKind: 'body' })
  })

  it('リンクでない・http(s) でない・読めない URL は送らない', () => {
    expect(outboundOf(target(null))).toBeNull()
    expect(outboundOf(target({ href: 'mailto:a@example.com' }))).toBeNull()
    expect(outboundOf(target({ href: 'not a url' }))).toBeNull()
    expect(outboundOf(target({}))).toBeNull()
    expect(outboundOf(null)).toBeNull()
    expect(outboundOf({})).toBeNull()
  })

  it('コードのコピーのボタン', () => {
    expect(isCodeCopy(target(null, true))).toBe(true)
    expect(isCodeCopy(target(null, false))).toBe(false)
    expect(isCodeCopy(null)).toBe(false)
  })
})
