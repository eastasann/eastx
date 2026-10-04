/**
 * 今のサイトのデータを取り出して変換し、`scripts/migrate-legacy/out/` に書き出す（design-spec 9章）。
 *
 *   bun scripts/migrate-legacy/migrate.ts
 *
 * 書き出すもの:
 * - `legacy.sql`: D1 に流す SQL（`wrangler d1 execute --file`）
 * - `images/`: R2 に置く画像のファイル
 * - `images.tsv`: R2 のキー・ローカルのファイル・形式の一覧（1行1件。`wrangler r2 object put` に渡す）
 * - `counts.json`: 今のサイトから取り出した件数（verify.ts が D1 の件数と照合する）
 *
 * D1・R2 には触れない。流すのは verify.ts（ローカル）と、docs/04_deployment-procedure.md 3章 Step 7（staging・本番）。
 */
import { createHash } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { UPLOAD_CONTENT_TYPES, UPLOAD_MAX_BYTES, type UploadContentType } from '../../src/api/contract/misc'
import { matchesSignature } from '../../src/api/image-signature'
import { extractResume, LEGACY_IMAGE_HOST, LEGACY_SITE_URL, legacyCounts } from './legacy'
import { buildSql } from './sql'
import { imageSources, transform } from './transform'

export const OUT_DIR = path.join(import.meta.dirname, 'out')

const EXTENSIONS: Record<UploadContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

type LegacyImage = { key: string; file: string; contentType: UploadContentType; body: Uint8Array }

const FETCH_TIMEOUT_MS = 30_000

async function fetchOk(url: string): Promise<Response> {
  const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`${url} の取得に失敗した（${response.status}）`)
  return response
}

/**
 * 画像を取ってきて、アップロード（SDD 5.10）と同じ形式・大きさ・先頭のバイトの検査をする。
 * キーは `uploads/legacy/{元のファイル名}-{中身のハッシュ}.{拡張子}`。`/media/*` はキーの中身が変わらない前提で
 * 1年キャッシュさせる（ADR-010）ので、中身が変われば別のキーになるようにハッシュを入れる
 */
async function downloadImage(sourceUrl: string): Promise<LegacyImage> {
  // 取ってくるのは今の画像の置き場からだけにする。URL はページから読んだ値なので、ほかのホストを指していれば止める
  if (new URL(sourceUrl).hostname !== LEGACY_IMAGE_HOST) throw new Error(`${sourceUrl}: 今の画像の置き場ではない`)
  const response = await fetchOk(sourceUrl)
  const length = Number(response.headers.get('content-length'))
  if (length > UPLOAD_MAX_BYTES) throw new Error(`${sourceUrl}: 5MB を超える（${length} バイト）`)
  const declared = (response.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase()
  const contentType = UPLOAD_CONTENT_TYPES.find((t) => t === declared)
  if (!contentType) throw new Error(`${sourceUrl}: アップロードで受け付けない形式（${declared}）`)
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > UPLOAD_MAX_BYTES) throw new Error(`${sourceUrl}: 5MB を超える（${body.byteLength} バイト）`)
  if (!matchesSignature(contentType, body)) throw new Error(`${sourceUrl}: 中身が ${contentType} ではない`)

  const stem = path.posix
    .basename(new URL(sourceUrl).pathname)
    .replace(/\.[^.]*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
  const hash = createHash('sha256').update(body).digest('hex').slice(0, 8)
  const file = `${stem}-${hash}.${EXTENSIONS[contentType]}`
  return { key: `uploads/legacy/${file}`, file, contentType, body }
}

async function main() {
  const html = await (await fetchOk(LEGACY_SITE_URL)).text()
  const resume = extractResume(html)

  // キーはファイル名と中身のハッシュで決まるので、別の URL でも同じキーなら同じ画像として1つにまとめる
  const byKey = new Map<string, LegacyImage>()
  const mediaPath = new Map<string, string>()
  for (const url of imageSources(resume)) {
    const img = await downloadImage(url)
    if (!byKey.has(img.key)) byKey.set(img.key, img)
    mediaPath.set(url, `/media/${img.key}`)
  }
  const images = [...byKey.values()]

  const data = transform(resume, (sourceUrl) => {
    const found = mediaPath.get(sourceUrl)
    if (!found) throw new Error(`取得していない画像: ${sourceUrl}`)
    return found
  })

  // 前回の出力が残っていると、今回使わない画像まで一覧の外に混ざるので作り直す
  await rm(OUT_DIR, { recursive: true, force: true })
  await mkdir(path.join(OUT_DIR, 'images'), { recursive: true })
  await Promise.all(images.map((img) => writeFile(path.join(OUT_DIR, 'images', img.file), img.body)))
  await writeFile(
    path.join(OUT_DIR, 'images.tsv'),
    images.map((img) => `${img.key}\t${path.join(OUT_DIR, 'images', img.file)}\t${img.contentType}\n`).join(''),
  )
  await writeFile(path.join(OUT_DIR, 'legacy.sql'), buildSql(data))
  const counts = { ...legacyCounts(resume), image: images.length }
  await writeFile(path.join(OUT_DIR, 'counts.json'), `${JSON.stringify(counts, null, 2)}\n`)

  console.log(
    `${OUT_DIR} に書き出した:`,
    Object.entries(counts)
      .map(([k, v]) => `${k} ${v}`)
      .join(' '),
  )
}

if (import.meta.main) await main()
