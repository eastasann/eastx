/**
 * 訪問者の数え方（SDD ADR-023）。Cookie を使わず、日ごとにランダムな値と IP と User-Agent からハッシュを作る。
 * 日ごとの値はその日の終わりに KV から消えるので、日が終われば IP・User-Agent からハッシュを作り直して照合できない
 */
import { addDays, jstDayStartMs } from './dates'

/** 日ごとの値の KV のキー */
export function saltKey(date: string): string {
  return `salt:${date}`
}

/**
 * 日ごとの値の期限（KV の `expiration`。UNIX 秒）。日本時間のその日の終わり＋10分。
 * 10分は、日付の境目の直前に送られた送信を処理し終えるための余裕
 */
export function saltExpiration(date: string): number {
  return Math.floor((jstDayStartMs(addDays(date, 1)) + 10 * 60 * 1000) / 1000)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 日ごとの値（32バイトのランダムな値の16進） */
export function newSalt(): string {
  return toHex(crypto.getRandomValues(new Uint8Array(32)))
}

/**
 * 訪問者のハッシュ。SHA-256(日ごとの値・日付・IP・User-Agent) の先頭16バイトの16進。
 * `ipKey` は IPv6 を上位64ビットにまとめた値（src/api/rate-limit-key.ts）。プライバシー拡張で末尾が変わっても
 * 同じ人として数える。区切りの改行は HTTP のヘッダーの値（IP・User-Agent）に入らない
 */
export async function visitorHash(input: {
  salt: string
  date: string
  ipKey: string
  userAgent: string
}): Promise<string> {
  const text = [input.salt, input.date, input.ipKey, input.userAgent].join('\n')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return toHex(new Uint8Array(digest).slice(0, 16))
}
