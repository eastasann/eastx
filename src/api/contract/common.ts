/**
 * コントラクトで共有する部品: 入力の型（SDD 5.0 の決まり）、エラー（SDD 8章）、出力の共通の形。
 * 管理画面のフォームも同じスキーマで入力をチェックする（ADR-008）。
 */
import { oc } from '@orpc/contract'
import { z } from 'zod'
import ja from 'zod/v4/locales/ja.js'
import { CAREER_KINDS, CODING_LOG_KINDS, SOCIAL_SERVICES, STATUSES } from '../../db/enums'
import { hasAnyTitle } from '../../domain/publishing'
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../domain/slug'

// 入力欄の下に出す理由（SDD 8章の fieldErrors）は日本語。管理画面だけが使う
z.config(ja())
// JIT（new Function）を使わない。Zod は初めての検証で new Function を試して JIT の可否を決めるので、
// 管理画面では CSP（SDD 7章。script-src に 'unsafe-eval' を入れない）の違反が出る。Workers は元から JIT を使わない
z.config({ jitless: true })

// ---- 文字数などの技術的な上限（SDD 5.0） ----------------------------------
export const LIMITS = {
  shortText: 200,
  summary: 500,
  markdown: 100_000,
  url: 2048,
  slug: SLUG_MAX_LENGTH,
} as const

// ---- 入力の部品 -------------------------------------------------------------
// 文字列は前後の空白を取り除き、空文字は null として保存する（SDD 5.0）。省略も null と同じに扱う

/** 任意の文字列。空なら null */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null)

/** 空なら null にしたうえで、入っていれば `schema` の形式を確かめる */
const optionalFormatted = (max: number, schema: z.ZodString) => optionalText(max).pipe(schema.nullable())

/** https:// で始まる URL（design-spec 6.7.3） */
export const optionalHttpsUrl = optionalFormatted(
  LIMITS.url,
  z.string().startsWith('https://', 'https:// で始めてください'),
)
export const httpsUrl = z.string().trim().max(LIMITS.url).startsWith('https://', 'https:// で始めてください')

/** 画像の URL（/media/ で始まる。SDD 5.0） */
export const optionalMediaUrl = optionalFormatted(
  LIMITS.url,
  z.string().startsWith('/media/', '/media/ で始めてください'),
)

const SLUG_MESSAGE = '半角の英小文字・数字・ハイフンだけで入力してください'
export const slugString = z.string().trim().min(1).max(LIMITS.slug).regex(SLUG_PATTERN, SLUG_MESSAGE)
export const optionalSlug = optionalFormatted(LIMITS.slug, z.string().regex(SLUG_PATTERN, SLUG_MESSAGE))

/** 年月 `YYYY-MM`（SDD 5.0） */
const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/
export const optionalYearMonth = optionalFormatted(
  7,
  z.string().regex(YEAR_MONTH_REGEX, 'YYYY-MM の形で入力してください'),
)

/** 日時の入力。ISO 8601（オフセット付きも受け付ける） */
export const optionalDateTime = optionalText(64).pipe(z.iso.datetime({ offset: true }).nullable())

export const statusSchema = z.enum(STATUSES)
export const careerKindSchema = z.enum(CAREER_KINDS)
export const codingLogKindSchema = z.enum(CODING_LOG_KINDS)
export const socialServiceSchema = z.enum(SOCIAL_SERVICES)

/** パスの ID。形式の誤りは、存在しない ID と同じく NOT_FOUND にするため、文字列であることだけを見る */
export const idParam = z.string().max(100)

/**
 * `/{id}` を持つ手続きは入力を `detailed`（`params`・`body` を分ける）にする。`compact` は本文の `id` が
 * パスの `{id}` を上書きし、URL と違う行を書き換えうるため。入力の誤りの `fieldErrors` のキーからは
 * `params`・`body` を落とす（src/api/errors.ts）
 */
export const byIdRoute = { inputStructure: 'detailed' } as const
export const idInput = z.object({ params: z.object({ id: idParam }) })
export const idWithBody = <T extends z.ZodType>(body: T) => z.object({ params: z.object({ id: idParam }), body })

/** 並べ替え（作品・プロジェクト・使用技術） */
export const reorderInput = z.object({
  ids: z
    .array(z.string().max(100))
    .max(10_000)
    .refine((ids) => new Set(ids).size === ids.length, '同じ ID が重複しています'),
})

/** 終了年月は開始年月と同じか後（design-spec 6.7.3）。`endDate` の欄の理由として出す */
export const periodRefinement = <T extends { startDate: string | null; endDate: string | null }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.startDate !== null && value.endDate !== null && value.endDate < value.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: '終了年月は開始年月と同じか後にしてください' })
  }
}

/**
 * 下書きのルール: タイトルが日英のどちらかに入っていること（SDD 5.3・design-spec 6.7.3）。両方の欄に理由を出す。
 * 公開・更新では、タイトルの不足も公開のルール（PUBLISH_REQUIREMENTS_NOT_MET）の足りない項目として返すので、ここでは見ない
 */
export const titleRefinement = <
  T extends { status: 'draft' | 'published'; ja: { title: string | null }; en: { title: string | null } },
>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (value.status === 'draft' && !hasAnyTitle(value.ja, value.en)) {
    for (const lang of ['ja', 'en'] as const) {
      ctx.addIssue({
        code: 'custom',
        path: [lang, 'title'],
        message: 'タイトルを日本語か英語のどちらかに入力してください',
      })
    }
  }
}

// ---- 出力の部品 -------------------------------------------------------------
export const isoDateTime = z.iso.datetime()
export const languagesSchema = z.object({ ja: z.boolean(), en: z.boolean() })

// ---- エラー（SDD 8章） -----------------------------------------------------
export const inputValidationFailedData = z.object({
  fieldErrors: z.record(z.string(), z.array(z.string())),
  formErrors: z.array(z.string()),
})

export const missingFieldSchema = z.object({ field: z.string(), lang: z.enum(['ja', 'en']).optional() })

/** すべての手続きが返しうるエラー（ミドルウェア・CSRF・入力チェック・想定外） */
export const baseErrors = {
  INPUT_VALIDATION_FAILED: { status: 422, message: '入力内容に誤りがあります', data: inputValidationFailedData },
  UNAUTHORIZED: { status: 401, message: 'ログインしてください' },
  FORBIDDEN: { status: 403, message: 'この操作を行う権限がありません' },
  CSRF_TOKEN_MISMATCH: { status: 403, message: 'リクエストを確認できませんでした' },
  TOO_MANY_REQUESTS: { status: 429, message: 'リクエストが多すぎます。しばらくしてからお試しください' },
  INTERNAL_SERVER_ERROR: {
    status: 500,
    message: 'サーバーでエラーが発生しました',
    data: z.object({ requestId: z.string() }),
  },
} as const

export const notFoundError = { NOT_FOUND: { status: 404, message: '見つかりませんでした' } } as const
export const slugConflictError = {
  SLUG_CONFLICT: {
    status: 409,
    message: 'このスラッグはすでに使われています',
    data: z.object({ suggestion: z.string() }),
  },
} as const
export const stackKeyConflictError = {
  STACK_KEY_CONFLICT: {
    status: 409,
    message: 'この識別名はすでに使われています',
    data: z.object({ suggestion: z.string() }),
  },
} as const
export const publishRequirementsError = {
  PUBLISH_REQUIREMENTS_NOT_MET: {
    status: 422,
    message: '公開に必要な項目が足りません',
    data: z.object({ missing: z.array(missingFieldSchema) }),
  },
} as const
export const orderOutOfDateError = {
  ORDER_OUT_OF_DATE: { status: 409, message: '表示順が最新ではありません。読み直してください' },
} as const

/** 全手続きの起点。ベースパスの `/api/admin` は OpenAPIHandler の prefix で付ける（src/api/app.ts） */
export const base = oc.errors(baseErrors)
