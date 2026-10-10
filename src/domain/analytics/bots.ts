/**
 * ボットの判定（SDD 5.14 の除外）。JavaScript を動かさないボットはそもそも送らないので、ここで落とすのは
 * ブラウザを動かす監視・計測（Sentry の稼働監視、Lighthouse、ヘッドレスのブラウザ）と、JavaScript を動かすクローラー・プレビューの取得
 */
const BOT_PATTERN = /bot|crawl|spider|slurp|facebookexternalhit|embedly|preview|lighthouse|headlesschrome|phantomjs/i

/** User-Agent が無い送信もボットとして扱う（ブラウザは必ず付ける） */
export function isBot(userAgent: string | null): boolean {
  return userAgent === null || userAgent.trim() === '' || BOT_PATTERN.test(userAgent)
}

export const DEVICES = ['mobile', 'tablet', 'desktop'] as const
export type Device = (typeof DEVICES)[number]

/** User-Agent からデバイスの種類。iPadOS の Safari はデスクトップの User-Agent を送るので desktop に入る */
export function deviceOf(userAgent: string): Device {
  if (/iPad|Tablet|PlayBook|Silk|Kindle/i.test(userAgent)) return 'tablet'
  if (/Android/i.test(userAgent) && !/Mobile/i.test(userAgent)) return 'tablet'
  if (/Mobi|iPhone|iPod|Android|Windows Phone/i.test(userAgent)) return 'mobile'
  return 'desktop'
}
