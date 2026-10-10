/**
 * カラムの値の定義（SDD 6.4）。schema.ts から分けているのは、ブラウザで動くコード（管理画面のルートの検索条件の検証、
 * 公開側の表示）がこれだけを読むため。schema.ts は Drizzle を読み込むので、import すると公開側のバンドルに Drizzle が入る
 */
export const STATUSES = ['draft', 'published'] as const
export const SOCIAL_SERVICES = ['github', 'linkedin', 'instagram', 'x', 'zenn', 'qiita', 'other'] as const
export const CAREER_KINDS = ['work', 'education'] as const
export const CODING_LOG_KINDS = ['learning_log', 'snippet', 'problem', 'memo'] as const
/** 使用技術のカテゴリ。並びは公開側の Tech Stack の群の順（design-spec 6.1.4） */
export const STACK_CATEGORIES = ['languages', 'frameworks', 'infrastructure', 'tools'] as const
/** 解析の日ごとの集計の次元（SDD 6.3・5.13）。値を足すときは analytics_daily の CHECK を変えるマイグレーションになる */
export const ANALYTICS_DIMENSIONS = [
  'total',
  'page',
  'referrer',
  'utm',
  'country',
  'device',
  'browser_lang',
  'site_lang',
  'top_view',
  'section_view',
  'read_complete',
  'row_expand',
  'paging',
  'outbound',
  'outbound_total',
  'lang_switch',
  'theme_switch',
  'code_copy',
] as const
