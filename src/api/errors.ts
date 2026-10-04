/**
 * エラーを SDD 8章の形にそろえ、ログに出す（OpenAPIHandler のインターセプター）。
 * - 入力の検証の失敗（oRPC の BAD_REQUEST）と、本文を解釈できないリクエスト → INPUT_VALIDATION_FAILED（422）
 * - 5xx と想定外の例外 → INTERNAL_SERVER_ERROR（500）。message は一般的な文言にし、data.requestId だけを返す
 */

import { ORPCError, ValidationError } from '@orpc/server'
import type { StandardHandlerOptions } from '@orpc/server/standard'
import type { MissingField } from '../domain/publishing'
import { captureServerError } from '../monitoring/server'
import { API_BASE_PATH } from './constants'
import type { RequestContext } from './context'
import { baseErrors, publishRequirementsError, slugConflictError, stackKeyConflictError } from './contract/common'
import { UPLOAD_MESSAGES } from './contract/misc'
import { log } from './log'

type Interceptors<K extends 'interceptors' | 'clientInterceptors'> = NonNullable<
  StandardHandlerOptions<RequestContext>[K]
>
type Issue = ValidationError['issues'][number]

const MALFORMED_REQUEST = 'リクエストの形式が正しくありません'

/**
 * Standard Schema の issues を `fieldErrors`（`ja.title` のような点区切りのキー）と `formErrors` に分ける。
 * `detailed` の入力では先頭の `params`・`body` を落とし、キーを管理画面のフォームの欄の名前にそろえる
 */
function toInputValidationData(issues: readonly Issue[], detailedInput: boolean) {
  const fieldErrors: Record<string, string[]> = {}
  const formErrors: string[] = []
  for (const issue of issues) {
    const segments = (issue.path ?? []).map((segment) => String(typeof segment === 'object' ? segment.key : segment))
    const key = (detailedInput ? segments.slice(1) : segments).join('.')
    if (key === '') formErrors.push(issue.message)
    else fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message]
  }
  return { fieldErrors, formErrors }
}

export function inputValidationFailed(data: { fieldErrors: Record<string, string[]>; formErrors: string[] }) {
  const { status, message } = baseErrors.INPUT_VALIDATION_FAILED
  return new ORPCError('INPUT_VALIDATION_FAILED', { defined: true, status, message, data })
}

/**
 * 手続きの中で投げる定義済みのエラー。コード・status・message はコントラクト（SDD 8章）の値を使い、
 * 手続きのエラーの定義と照合されて `defined: true` になる
 */
export function slugConflict(suggestion: string) {
  const { status, message } = slugConflictError.SLUG_CONFLICT
  return new ORPCError('SLUG_CONFLICT', { status, message, data: { suggestion } })
}

export function stackKeyConflict(suggestion: string) {
  const { status, message } = stackKeyConflictError.STACK_KEY_CONFLICT
  return new ORPCError('STACK_KEY_CONFLICT', { status, message, data: { suggestion } })
}

export function publishRequirementsNotMet(missing: MissingField[]) {
  const { status, message } = publishRequirementsError.PUBLISH_REQUIREMENTS_NOT_MET
  return new ORPCError('PUBLISH_REQUIREMENTS_NOT_MET', { status, message, data: { missing } })
}

/**
 * 本文が上限を超えた（src/api/app.ts が読み込みを止めた）。`field` は理由を出す入力欄で、
 * アップロードでは `file`（design-spec 6.7.3 の「ファイルが大きすぎます」）、それ以外は null（フォーム全体）
 */
export class RequestBodyTooLargeError extends Error {
  constructor(readonly field: 'file' | null) {
    super('request body too large')
    this.name = 'RequestBodyTooLargeError'
  }
}

function bodyTooLarge(error: RequestBodyTooLargeError) {
  return error.field === 'file'
    ? inputValidationFailed({ fieldErrors: { file: [UPLOAD_MESSAGES.tooLarge] }, formErrors: [] })
    : inputValidationFailed({ fieldErrors: {}, formErrors: ['リクエストの本文が大きすぎます'] })
}

/** 原因をたどった先の例外。Drizzle の例外の message は SQL のパラメーター（本文）を含むので、ログには原因のほうを出す */
function rootCause(error: unknown): unknown {
  let current = error
  while (current instanceof Error && current.cause !== undefined) current = current.cause
  return current
}

function normalize(error: unknown, context: RequestContext): ORPCError<string, unknown> {
  if (!(error instanceof ORPCError) && !context.trace.procedureStarted) {
    // 手続きを呼ぶ前に起きる例外は、oRPC が本文（JSON・multipart）を読めなかった・解釈できなかったときだけ
    const cause = rootCause(error)
    if (cause instanceof RequestBodyTooLargeError) return bodyTooLarge(cause)
    return inputValidationFailed({ fieldErrors: {}, formErrors: [MALFORMED_REQUEST] })
  }
  if (error instanceof ORPCError) {
    if (error.code === 'BAD_REQUEST') {
      // 手続きの入力の検証の失敗は ValidationError を原因に持つ。それ以外の BAD_REQUEST は本文の解釈の失敗で、
      // どちらも呼び出し側の入力の誤り
      return error.cause instanceof ValidationError
        ? inputValidationFailed(toInputValidationData(error.cause.issues, context.trace.detailedInput))
        : inputValidationFailed({ fieldErrors: {}, formErrors: [MALFORMED_REQUEST] })
    }
    if (error.status < 500) return error
  }
  const { status, message } = baseErrors.INTERNAL_SERVER_ERROR
  return new ORPCError('INTERNAL_SERVER_ERROR', {
    defined: true,
    status,
    message,
    data: { requestId: context.requestId },
    cause: error,
  })
}

/** ハンドラーのインターセプター。手続きの外（本文の解釈・CSRF）で起きたエラーも受ける */
export const handlerInterceptors: Interceptors<'interceptors'> = [
  async ({ next, context, request }) => {
    try {
      const result = await next()
      log('debug', {
        msg: 'request',
        requestId: context.requestId,
        route: context.trace.route,
        method: request.method,
        status: result.response?.status,
      })
      return result
    } catch (e) {
      const error = normalize(e, context)
      const fields = { msg: error.message, requestId: context.requestId, route: context.trace.route, code: error.code }
      if (error.status >= 500) {
        const cause = rootCause(e)
        log('error', {
          ...fields,
          error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
        })
        captureServerError(cause, context.requestId)
      } else {
        log('warn', fields)
      }
      throw error
    }
  },
]

/** 手続きを呼び始めたことを記録し、ログの route をパスのテンプレートにする */
export const clientInterceptors: Interceptors<'clientInterceptors'> = [
  ({ next, procedure, context }) => {
    context.trace.procedureStarted = true
    context.trace.detailedInput = procedure['~orpc'].route.inputStructure === 'detailed'
    const route = procedure['~orpc'].route
    if (route.method && route.path) context.trace.route = `${route.method} ${API_BASE_PATH}${route.path}`
    return next()
  },
]
