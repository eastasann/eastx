/**
 * カラムの値の定義（SDD 6.4）。schema.ts から分けているのは、ブラウザで動くコード（管理画面のルートの検索条件の検証、
 * 公開側の表示）がこれだけを読むため。schema.ts は Drizzle を読み込むので、import すると公開側のバンドルに Drizzle が入る
 */
export const STATUSES = ['draft', 'published'] as const
export const SOCIAL_SERVICES = ['github', 'linkedin', 'instagram', 'x', 'zenn', 'qiita', 'other'] as const
export const CAREER_KINDS = ['work', 'education'] as const
export const CODING_LOG_KINDS = ['learning_log', 'snippet', 'problem', 'memo'] as const
