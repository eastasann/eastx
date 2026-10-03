/**
 * better-call（Better Auth が使う）の署名付き Cookie と同じ形: `{値}.{HMAC-SHA256 の base64}` を URL エンコードしたもの。
 * 結合テスト（workerd）と E2E（Node.js）のヘルパーで共通に使う（SDD 10章）
 */
export async function signCookieValue(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return encodeURIComponent(`${value}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)
}
