/**
 * Lighthouse CI が測る先（lighthouserc.cjs の startServerCommand。SDD 10章）。
 * ビルドしたもののプレビューを内側のポートで起動し、http://localhost:3000 で gzip に圧縮して返す。
 * 本番では Cloudflare の拠点が HTML・JS・CSS を圧縮して届けるが、ローカルのプレビュー（miniflare）は圧縮しない。
 * 圧縮しないまま測ると、本番にない転送量で Performance が決まってしまう。
 * 本番の brotli より縮まない gzip にして、本番より甘く測らないようにする
 */
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { gzipSync } from 'node:zlib'

// .dev.vars の SITE_URL（http://localhost:3000）と同じ origin で受ける。canonical・OGP の URL が測る先と一致する
const PUBLIC_PORT = 3000
const PREVIEW_PORT = 3001
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|manifest\+json)|image\/svg\+xml)/

const preview = spawn('bunx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    preview.kill(signal)
    process.exit(0)
  })
}
preview.on('exit', (code) => {
  console.error(`vite preview が終了した（${code}）`)
  process.exit(1)
})

await new Promise<void>((resolve) => {
  preview.stdout.on('data', (chunk: Buffer) => {
    if (chunk.toString().includes('Local')) resolve()
  })
})

async function relay(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const headers = new Headers()
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (typeof value === 'string') headers.set(name, value)
  }
  // 宛先と接続はこのサーバーとプレビューの間のもの
  for (const name of ['host', 'connection']) headers.delete(name)
  // 圧縮はここで行う。fetch が勝手に圧縮を求めて展開すると content-encoding と本文が食い違うので、無圧縮を求める
  headers.set('accept-encoding', 'identity')
  // 測るのは GET だけ（Lighthouse がページと資源を読む）なので、本文は渡さない
  const upstream = await fetch(`http://localhost:${PREVIEW_PORT}${incoming.url ?? '/'}`, {
    method: incoming.method,
    headers,
    redirect: 'manual',
  })
  const responseHeaders = new Headers(upstream.headers)
  const type = responseHeaders.get('content-type') ?? ''
  const acceptsGzip = /\bgzip\b/.test(incoming.headers['accept-encoding'] ?? '')
  let body = Buffer.from(await upstream.arrayBuffer())
  if (acceptsGzip && COMPRESSIBLE.test(type) && !responseHeaders.has('content-encoding') && body.byteLength > 0) {
    body = gzipSync(body)
    responseHeaders.set('content-encoding', 'gzip')
    responseHeaders.append('vary', 'accept-encoding')
  }
  // 本文は読み切ってから返すので、長さで送る
  responseHeaders.delete('transfer-encoding')
  responseHeaders.set('content-length', String(body.byteLength))
  // fetch はヘッダーの値を連結するので、Set-Cookie だけは個別に戻す
  const cookies = upstream.headers.getSetCookie()
  responseHeaders.delete('set-cookie')
  outgoing.writeHead(
    upstream.status,
    [...responseHeaders.entries(), ...cookies.map((c) => ['set-cookie', c] as [string, string])].flat(),
  )
  outgoing.end(body)
}

createServer((incoming, outgoing) => {
  relay(incoming, outgoing).catch((error: unknown) => {
    // 中継できなかったリクエストは 502 にし、測定の失敗として Lighthouse の結果に出す
    console.error(error)
    if (!outgoing.headersSent) outgoing.writeHead(502)
    outgoing.end()
  })
}).listen(PUBLIC_PORT, 'localhost', () => {
  console.log(`lhci server ready on http://localhost:${PUBLIC_PORT}`)
})
