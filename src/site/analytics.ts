/**
 * 公開側の解析の送信（SDD 5.14・ADR-023）。表示と行動のイベントを、同じ origin の受け口へ `sendBeacon` で送る。
 * 送るのは SiteChromeView.analyticsBeacon が true の画面だけで、DNT・GPC・自動操作のブラウザは何も送らない。
 * 応答は読まず、やり直さない（受け口は除外したかどうかを見せず、`sendBeacon` は応答を受け取れない）
 */
import { useRouter, useRouterState } from '@tanstack/react-router'
import { createContext, type RefObject, useContext, useEffect, useRef } from 'react'
import {
  type ExpandableSection,
  LINK_KINDS,
  type LinkKind,
  type PagedSectionName,
  type ThemeChoice,
  TOP_SECTIONS,
  type TopSection,
} from '~/domain/analytics/events'
import { isLang, type Lang } from '~/i18n/detect'

const ENDPOINT = '/api/collect'
/** 受け口の上限（SDD 5.14）。超える値は送らない（1件ごと捨てられないように、送る前に落とす） */
const REFERRER_MAX = 2048
const UTM_MAX = 100

/** 画面が送る行動。`path` と `lang` は送信の部品が足す */
export type ActionEvent =
  | { type: 'section_view'; section: TopSection }
  | { type: 'read_complete' }
  | { type: 'row_expand'; section: ExpandableSection; itemId: string }
  | { type: 'paging'; section: PagedSectionName; page: number }
  | { type: 'outbound'; linkKind: LinkKind; host: string }
  | { type: 'lang_switch'; to: Lang }
  | { type: 'theme_switch'; to: ThemeChoice }
  | { type: 'code_copy' }

export interface BrowserSignals {
  doNotTrack?: string | null
  globalPrivacyControl?: boolean
  webdriver?: boolean
}

/** DNT・GPC を送るブラウザと、自動操作のブラウザ（navigator.webdriver）は送らない */
export function isTrackingAllowed(signals: BrowserSignals): boolean {
  return signals.doNotTrack !== '1' && signals.globalPrivacyControl !== true && signals.webdriver !== true
}

export interface BeaconEnvironment {
  sendBeacon?: (url: string, data: Blob) => boolean
  fetch: (url: string, init: RequestInit) => Promise<unknown>
  location: { pathname: string; search: string }
  /** 文書を読み込んだときの参照元（document.referrer） */
  referrer: string
  /** 表示している言語 */
  lang: () => Lang
  /** C2（取得に失敗した画面）を出しているか。出しているあいだは送らない */
  isErrorPage: () => boolean
}

function utmValue(params: URLSearchParams, name: string): string | null {
  const value = params.get(name)
  return value === null || value === '' || value.length > UTM_MAX || value.includes('|') ? null : value
}

/** URL の UTM。どれも無ければ undefined（送らない） */
export function utmOf(search: string) {
  const params = new URLSearchParams(search)
  const utm = {
    source: utmValue(params, 'utm_source'),
    medium: utmValue(params, 'utm_medium'),
    campaign: utmValue(params, 'utm_campaign'),
  }
  return utm.source === null && utm.medium === null && utm.campaign === null ? undefined : utm
}

/** 参照元。受け口はホスト名だけを残すので、上限を超える URL は origin にして送る */
function referrerOf(referrer: string): string {
  if (referrer.length <= REFERRER_MAX) return referrer
  try {
    return new URL(referrer).origin
  } catch {
    return ''
  }
}

export type Beacon = ReturnType<typeof createBeacon>

/** 1つの文書の中で持ち越す送信の状態。公開側のレイアウトが作り直されても（C1 と画面の行き来）、参照元を二度送らない */
export interface BeaconState {
  /** 前回 page_view を送った path */
  lastPath: string | null
  /** 文書を読み込んでから、まだ page_view を送っていない（参照元と UTM を付ける） */
  firstView: boolean
}

export function newBeaconState(): BeaconState {
  return { lastPath: null, firstView: true }
}

export function createBeacon(env: BeaconEnvironment, state: BeaconState = newBeaconState()) {
  function post(body: Record<string, unknown>) {
    const json = JSON.stringify({ ...body, path: env.location.pathname, lang: env.lang() })
    // 同じ origin なので CORS の事前確認は無い。Content-Type による違いを持ち込まないよう、text/plain で送る
    if (env.sendBeacon?.(ENDPOINT, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return
    // sendBeacon が無い・送信の列が満ちているときは keepalive の fetch。解析の送信の失敗は訪問者の操作に関わらないので、
    // 結果は見ない（拾われない reject を Sentry の未処理の例外にしない）
    env
      .fetch(ENDPOINT, {
        method: 'POST',
        body: json,
        keepalive: true,
        headers: { 'content-type': 'text/plain;charset=UTF-8' },
      })
      .catch(() => undefined)
  }

  return {
    /**
     * 前回と違う path のときだけ送る。初期化の1回と、ルーターの onResolved で呼ぶ（初期化の後に onResolved が来ても
     * 来なくても二重にならない）。ハッシュだけの移動・同じパスの読み込み直しは送らない
     */
    pageView() {
      const path = env.location.pathname
      if (path === state.lastPath || env.isErrorPage()) return
      state.lastPath = path
      const body: Record<string, unknown> = { type: 'page_view' }
      if (state.firstView) {
        // 参照元と UTM は文書を読み込んだ最初の1回だけ（ルーターの移動の参照元は自分のサイト）
        body.referrer = referrerOf(env.referrer)
        const utm = utmOf(env.location.search)
        if (utm !== undefined) body.utm = utm
        state.firstView = false
      }
      post(body)
    },
    /** bfcache から戻った。同じ path でも、もう一度の表示として送る */
    restored() {
      state.lastPath = null
      this.pageView()
    },
    track(event: ActionEvent) {
      if (!env.isErrorPage()) post(event)
    },
  }
}

interface ClosestTarget {
  closest(selector: string): { href?: string; getAttribute(name: string): string | null } | null
}

function isClosestTarget(target: unknown): target is ClosestTarget {
  return typeof target === 'object' && target !== null && typeof (target as ClosestTarget).closest === 'function'
}

/**
 * 別タブで開くリンクを押したときの `outbound`。`data-analytics-link` の値を種類にし、属性の無いもの（Markdown の本文）は
 * `body`。http・https 以外は送らない
 */
export function outboundOf(target: unknown): Extract<ActionEvent, { type: 'outbound' }> | null {
  if (!isClosestTarget(target)) return null
  const anchor = target.closest('a[target="_blank"]')
  if (anchor === null || anchor.href === undefined) return null
  let url: URL
  try {
    url = new URL(anchor.href)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  const kind = anchor.getAttribute('data-analytics-link')
  const linkKind = LINK_KINDS.find((candidate) => candidate === kind) ?? 'body'
  return { type: 'outbound', linkKind, host: url.hostname }
}

/** 本文のコードブロックの「コピー」（src/ui/markdown-body.tsx が data-code-copy を付ける） */
export function isCodeCopy(target: unknown): boolean {
  return isClosestTarget(target) && target.closest('[data-code-copy]') !== null
}

/** 今動いている送信の部品。1つの文書に1つで、公開側のレイアウト（SiteChrome）が作る */
let active: Beacon | null = null
/** この文書の送信の状態。部品を作り直しても引き継ぐ */
const documentState = newBeaconState()

/** 行動を送る。送信の部品が動いていなければ何もしない（管理画面・計測しない環境・DNT など） */
export function track(event: ActionEvent): void {
  active?.track(event)
}

/** 送信の部品が動く画面か（SiteChromeView.analyticsBeacon）。画面の部品が観測を置くかを決める */
const AnalyticsEnabled = createContext(false)
export const AnalyticsEnabledProvider = AnalyticsEnabled.Provider

function langOf(matches: readonly { routeId: string; context: unknown }[]): Lang | undefined {
  const lang = (matches.find((match) => match.routeId === '/$lang')?.context as { lang?: string } | undefined)?.lang
  return isLang(lang) ? lang : undefined
}

/**
 * 送信の部品を動かす。公開側のレイアウト（SiteChrome）が1つだけ呼ぶ。`enabled` が false なら、リスナーも置かない
 */
export function useAnalyticsBeacon(enabled: boolean, lang: Lang): void {
  const router = useRouter()
  const langRef = useRef(lang)
  useEffect(() => {
    langRef.current = lang
  }, [lang])
  useEffect(() => {
    if (!enabled || !isTrackingAllowed(navigator)) return
    const beacon = createBeacon(
      {
        sendBeacon: navigator.sendBeacon === undefined ? undefined : (url, data) => navigator.sendBeacon(url, data),
        fetch: (url, init) => fetch(url, init),
        location: window.location,
        referrer: document.referrer,
        // 言語の切り替えの移動は、画面の描き直しより先に onResolved が来るので、ルーターの今の値から読む
        lang: () => langOf(router.state.matches) ?? langRef.current,
        isErrorPage: () => router.state.matches.some((match) => match.status === 'error'),
      },
      documentState,
    )
    active = beacon
    beacon.pageView()
    const unsubscribe = router.subscribe('onResolved', () => beacon.pageView())
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) beacon.restored()
    }
    // 中ボタンは click にならず auxclick だけが来る。修飾キー付きの左クリックは click に来る
    const onClick = (event: MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return
      const outbound = outboundOf(event.target)
      if (outbound !== null) beacon.track(outbound)
      else if (event.type === 'click' && isCodeCopy(event.target)) beacon.track({ type: 'code_copy' })
    }
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('click', onClick)
    document.addEventListener('auxclick', onClick)
    return () => {
      unsubscribe()
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('click', onClick)
      document.removeEventListener('auxclick', onClick)
      if (active === beacon) active = null
    }
  }, [enabled, router])
}

/**
 * 表示し終えたページのパス。ルーターの location は移動の始まり（前のページを描いたまま）で変わるので、それで観測を
 * 置き直すと、前のページの要素（前後のナビのすぐ上の本文の最後の印など）を次のページの表示として送ってしまう
 */
function useResolvedPathname(): string | undefined {
  return useRouterState({ select: (state) => state.resolvedLocation?.pathname })
}

/**
 * 画面に入ったら1回だけ呼ぶ観測。送信の部品が動く画面だけで置き、表示し終えたページのパスが変わったら置き直す
 */
function useFirstSight(targets: () => [Element, () => void][], pathname: string | undefined, enabled: boolean): void {
  const router = useRouter()
  // biome-ignore lint/correctness/useExhaustiveDependencies: 観測を置き直すのは表示し終えたページが変わったときだけ。targets は描画ごとに作り直される関数
  useEffect(() => {
    if (!enabled || pathname === undefined || typeof IntersectionObserver === 'undefined') return
    if (!isTrackingAllowed(navigator)) return
    const callbacks = new Map(targets())
    const observer = new IntersectionObserver((entries) => {
      // 移動の途中（前のページを描いたまま、URL はもう次のページ）に入ったものは送らない。表示し終えたら置き直す
      const { location, resolvedLocation } = router.state
      if (location.pathname !== resolvedLocation?.pathname) return
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        callbacks.get(entry.target)?.()
        observer.unobserve(entry.target)
      }
    })
    for (const element of callbacks.keys()) observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, pathname])
}

/**
 * P1 の `section_view`。各セクション（SDD 4.1 の要素の ID）の中の最初の見出しが初めて画面に入ったとき、1回の表示で1回
 */
export function useSectionViews(): void {
  const enabled = useContext(AnalyticsEnabled)
  const pathname = useResolvedPathname()
  useFirstSight(
    () =>
      TOP_SECTIONS.flatMap((section) => {
        const element = document.getElementById(section)
        if (element === null) return []
        const heading = element.querySelector('h1, h2') ?? element
        return [[heading, () => track({ type: 'section_view', section })] as [Element, () => void]]
      }),
    pathname,
    enabled,
  )
}

/** P2〜P5 の `read_complete`。本文の最後の印（`marker`）が初めて画面に入ったとき、1回の表示で1回 */
export function useReadComplete(marker: RefObject<Element | null>): void {
  const enabled = useContext(AnalyticsEnabled)
  const pathname = useResolvedPathname()
  useFirstSight(
    () => (marker.current === null ? [] : [[marker.current, () => track({ type: 'read_complete' })]]),
    pathname,
    enabled,
  )
}
