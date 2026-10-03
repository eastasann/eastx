import { env } from 'cloudflare:workers'
import { UPLOAD_CONTENT_TYPES, UPLOAD_MESSAGES, type UploadContentType } from '../contract/misc'
import { inputValidationFailed } from '../errors'
import { matchesSignature } from '../image-signature'
import { admin, logOperation } from './base'

const EXTENSIONS: Record<UploadContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

/** 宣言された形式。パラメーター（`;charset=…`）と大文字小文字の揺れは除いて比べる */
function declaredType(file: File): UploadContentType | null {
  const type = (file.type.split(';')[0] ?? '').trim().toLowerCase()
  return (UPLOAD_CONTENT_TYPES as readonly string[]).includes(type) ? (type as UploadContentType) : null
}

export const uploads = {
  create: admin.uploads.create.handler(async ({ input, context }) => {
    const notImage = () => inputValidationFailed({ fieldErrors: { file: [UPLOAD_MESSAGES.notImage] }, formErrors: [] })
    const type = declaredType(input.file)
    if (type === null) throw notImage()
    const bytes = new Uint8Array(await input.file.arrayBuffer())
    if (!matchesSignature(type, bytes)) throw notImage()

    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0')
    const key = `uploads/${yyyy}/${mm}/${crypto.randomUUID()}.${EXTENSIONS[type]}`
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } })
    logOperation(context, 'uploaded', { key, contentType: type, size: bytes.byteLength })
    return { url: `/media/${key}`, contentType: type, size: bytes.byteLength }
  }),
}
