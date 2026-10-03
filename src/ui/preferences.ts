/**
 * 表示設定の Cookie（SDD 7章: eastx-lang・eastx-theme。どちらも1年、HttpOnly ではない）。
 * 書くのはクライアント（切り替えたとき）。読むのはサーバー（SSR）とクライアントの両方なので、
 * リクエストの読み方を createIsomorphicFn で分ける
 */
import { createIsomorphicFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { detectLang, LANG_COOKIE, type Lang, readCookie } from '~/i18n/detect'

export { LANG_COOKIE }
export const THEME_COOKIE = 'eastx-theme'

export const THEME_PREFERENCES = ['system', 'light', 'dark'] as const
export type ThemePreference = (typeof THEME_PREFERENCES)[number]

const ONE_YEAR_SECONDS = 365 * 24 * 60 * 60

export function parseThemePreference(value: string | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

/** 「OSに合わせる → ライト → ダーク」の順（design-spec 6.1.2） */
export function nextThemePreference(current: ThemePreference): ThemePreference {
  const index = THEME_PREFERENCES.indexOf(current)
  return THEME_PREFERENCES[(index + 1) % THEME_PREFERENCES.length] ?? 'system'
}

export function writePreferenceCookie(name: typeof LANG_COOKIE | typeof THEME_COOKIE, value: string): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  // biome-ignore lint/suspicious/noDocumentCookie: 表示設定はクライアントで書く Cookie（SDD 7章）。Cookie Store API は Safari の対応が足りない
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax${secure}`
}

interface RequestPreferenceSource {
  cookie: string | null
  /** Accept-Language の形。ブラウザでは navigator.languages を優先の順に並べたもの */
  acceptLanguage: string | null
}

const readSource = createIsomorphicFn()
  .server(
    (): RequestPreferenceSource => ({
      cookie: getRequestHeader('cookie') ?? null,
      acceptLanguage: getRequestHeader('accept-language') ?? null,
    }),
  )
  .client(
    (): RequestPreferenceSource => ({
      cookie: document.cookie,
      acceptLanguage: navigator.languages.join(','),
    }),
  )

export function readThemePreference(): ThemePreference {
  return parseThemePreference(readCookie(readSource().cookie, THEME_COOKIE))
}

/**
 * URL に言語がないとき（ルート `/`、`$lang` が ja・en 以外の C1）の言語。design-spec 1.4 の振り分けと同じ規則
 */
export function readPreferredLang(): Lang {
  const { cookie, acceptLanguage } = readSource()
  return detectLang(cookie, acceptLanguage)
}

/**
 * <head> で描画の前に <html data-theme> を決めるスクリプト（ADR-014）。OS に合わせる設定のときは
 * prefers-color-scheme を見る。React より先に走るので、Cookie の名前と値はここに直接書く。
 * Cookie や matchMedia を読めない環境（Cookie を止めたブラウザなど）では、ライトで描く
 */
export const THEME_INIT_SCRIPT = `(function(){var d=document.documentElement;try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)/);var p=m?m[1]:'system';d.dataset.theme=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p}catch(e){d.dataset.theme='light'}})()`
