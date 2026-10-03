/** oRPC の手続きが受け取るコンテキスト（SDD 5.1） */
export interface RequestContext {
  /** `cf-ray`（ローカルでは UUID）。レスポンスヘッダー・ログ・5xx の本文に入れる（SDD 8章） */
  requestId: string
  /** 元のリクエストのヘッダー。Better Auth がセッションの Cookie を読む */
  headers: Headers
  /**
   * 手続きの外（ハンドラーのインターセプター）から見るための、リクエストの進み具合。
   * src/api/errors.ts のクライアントのインターセプターが、手続きを呼び始めたところで書き込む
   */
  trace: {
    /** ログの行に入れるルート（例: `PUT /api/admin/works/{id}`）。手続きが決まるまでは実際のパス */
    route: string
    /** 手続きを呼び始めたか。false のまま起きた例外は、手続きの前の本文の解釈の失敗 */
    procedureStarted: boolean
    /** 手続きの入力が `detailed`（`params`・`body` に分かれる）か。入力の誤りのキーをそろえるのに使う */
    detailedInput: boolean
  }
}
