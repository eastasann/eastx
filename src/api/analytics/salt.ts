/**
 * 訪問者のハッシュに混ぜる日ごとの値（SDD ADR-023）。KV（ANALYTICS_SALTS）に期限付きで置き、日本時間のその日の終わりから
 * 10分以内に消える。KV は D1 と違い、消えた値を利用者が戻す仕組みを持たない（ADR-022 のスパイク）
 */
import { newSalt, saltExpiration, saltKey } from '../../domain/analytics/visitor'

/**
 * isolate の中で値を持っておく時間。KV は「無ければ書く」を原子的にできず、その日の最初の数十秒は拠点ごとに別の値が
 * 作られうる（後から書いた値が残る）。いつまでも持つと、伝わり終えた後も負けた値を使い続けるので、数分で読み直す
 */
const CACHE_MS = 5 * 60 * 1000

const cache = new Map<string, { salt: string; readAt: number }>()

/**
 * 受け口が使うその日の値。isolate の中 → KV の順に読み、KV に無い（初回のデプロイの当日・Cron が失敗した日）ときは
 * その場で作って置く
 */
export async function dailySalt(
  kv: KVNamespace,
  date: string,
  onPutError: (error: unknown) => void,
  now = Date.now(),
): Promise<string> {
  const cached = cache.get(date)
  if (cached !== undefined && now - cached.readAt < CACHE_MS) return cached.salt
  let salt = await kv.get(saltKey(date))
  if (salt === null) {
    salt = newSalt()
    try {
      await kv.put(saltKey(date), salt, { expiration: saltExpiration(date) })
    } catch (error) {
      // KV は同じキーへの書き込みが1秒に1回まで。その日の最初に拠点・isolate が一斉に作ると書き込みが断られうる。
      // 書けなくても作った値でこの送信は数える（拠点ごとに別の値ができうるのは書けたときと同じ。ADR-023）。
      // 5分後に読み直すので、ほかが書いた値に寄る
      onPutError(error)
    }
  }
  // 前の日の値は使わなくなるので残さない
  for (const key of cache.keys()) if (key !== date) cache.delete(key)
  cache.set(date, { salt, readAt: now })
  return salt
}

/**
 * Cron が翌日の値を作る。使い始める約24時間前に置くので、KV の拠点への伝わりの遅れが問題にならない。
 * すでにあれば（Cron が二重に動いた・受け口が先に作った）書き換えない
 */
export async function prepareSalt(kv: KVNamespace, date: string): Promise<void> {
  if ((await kv.get(saltKey(date))) !== null) return
  await kv.put(saltKey(date), newSalt(), { expiration: saltExpiration(date) })
}
