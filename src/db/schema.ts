import { relations, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

import { CAREER_KINDS, CODING_LOG_KINDS, SOCIAL_SERVICES, STATUSES } from './enums'

// ---- 値の定義（ブラウザからも読むので enums.ts に置く） ---------------------
export { CAREER_KINDS, CODING_LOG_KINDS, SOCIAL_SERVICES, STATUSES }

// ---- 共通のカラム ------------------------------------------------------
const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
const status = () => text('status', { enum: STATUSES }).notNull().default('draft')
/** 年月。'YYYY-MM' */
const yearMonth = (name: string) => text(name)

// ---- CHECK 制約の部品 --------------------------------------------------
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))
const slugFormat = (col: unknown) => sql`${col} is null or (${col} <> '' and ${col} not glob '*[^a-z0-9-]*')`
const yearMonthFormat = (col: unknown) =>
  sql`${col} is null or (${col} glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr(${col}, 6, 2) between '01' and '12')`
// LIKE は ASCII の大文字小文字を区別しない（'/MEDIA/...' が通る）ので、前方一致は GLOB で見る
const httpsOrNull = (col: unknown) => sql`${col} is null or ${col} glob 'https://*'`
const mediaOrNull = (col: unknown) => sql`${col} is null or ${col} glob '/media/*'`

// ---- profile ----------------------------------------------------------
export const profile = sqliteTable(
  'profile',
  {
    id: id(),
    /** 常に1。一意制約で2件目を防ぐ */
    singleton: integer('singleton').notNull().default(1).unique(),
    nameJa: text('name_ja'),
    nameEn: text('name_en'),
    headlineJa: text('headline_ja'),
    headlineEn: text('headline_en'),
    bioJa: text('bio_ja'), // Markdown
    bioEn: text('bio_en'), // Markdown
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('profile_singleton', sql`${t.singleton} = 1`),
    check('profile_name_required', sql`${t.nameJa} is not null or ${t.nameEn} is not null`),
    check('profile_avatar_url', mediaOrNull(t.avatarUrl)),
  ],
)

// ---- social_link ------------------------------------------------------
export const socialLink = sqliteTable(
  'social_link',
  {
    id: id(),
    service: text('service', { enum: SOCIAL_SERVICES }).notNull(),
    url: text('url').notNull(),
    /** service が other のときは必須 */
    label: text('label'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('social_link_service', sql`${t.service} in (${inList(SOCIAL_SERVICES)})`),
    check('social_link_url', sql`${t.url} glob 'https://*'`),
    check('social_link_other_label', sql`${t.service} <> 'other' or ${t.label} is not null`),
    index('social_link_sort_idx').on(t.sortOrder),
  ],
)

// ---- career -----------------------------------------------------------
export const career = sqliteTable(
  'career',
  {
    id: id(),
    kind: text('kind', { enum: CAREER_KINDS }).notNull().default('work'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    organizationJa: text('organization_ja'),
    organizationEn: text('organization_en'),
    locationJa: text('location_ja'),
    locationEn: text('location_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    /** 公開時に必須 */
    startDate: yearMonth('start_date'),
    /** 空なら「現在」 */
    endDate: yearMonth('end_date'),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('career_kind', sql`${t.kind} in (${inList(CAREER_KINDS)})`),
    check('career_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('career_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('career_start_date', yearMonthFormat(t.startDate)),
    check('career_end_date', yearMonthFormat(t.endDate)),
    // 終了年月は開始年月と同じか後（design-spec 6.7.3）
    check('career_period', sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('career_published_start', sql`${t.status} <> 'published' or ${t.startDate} is not null`),
    index('career_status_start_idx').on(t.status, t.startDate),
  ],
)

// ---- work -------------------------------------------------------------
export const work = sqliteTable(
  'work',
  {
    id: id(),
    /** URL 用。作品の中で一意（NULL どうしは重複とみなさない）。公開時に必須 */
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    summaryJa: text('summary_ja'),
    summaryEn: text('summary_en'),
    bodyJa: text('body_ja'), // Markdown。どちらかの言語にあれば詳細ページを持つ
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    linkUrl: text('link_url'),
    githubUrl: text('github_url'),
    sortOrder: integer('sort_order').notNull(),
    status: status(),
    /** 初めて公開した日時（値を入れるのは 5.3） */
    firstPublishedAt: integer('first_published_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('work_slug_unique').on(t.slug),
    check('work_slug_format', slugFormat(t.slug)),
    check('work_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('work_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('work_published_slug', sql`${t.status} <> 'published' or ${t.slug} is not null`),
    check('work_link_url', httpsOrNull(t.linkUrl)),
    check('work_github_url', httpsOrNull(t.githubUrl)),
    check('work_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('work_status_sort_idx').on(t.status, t.sortOrder),
  ],
)

// ---- project ----------------------------------------------------------
export const project = sqliteTable(
  'project',
  {
    id: id(),
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    summaryJa: text('summary_ja'),
    summaryEn: text('summary_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    linkUrl: text('link_url'),
    /** 公開時に必須 */
    startDate: yearMonth('start_date'),
    /** 空なら「現在」 */
    endDate: yearMonth('end_date'),
    sortOrder: integer('sort_order').notNull(),
    status: status(),
    firstPublishedAt: integer('first_published_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('project_slug_unique').on(t.slug),
    check('project_slug_format', slugFormat(t.slug)),
    check('project_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('project_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('project_published_slug', sql`${t.status} <> 'published' or ${t.slug} is not null`),
    check('project_published_start', sql`${t.status} <> 'published' or ${t.startDate} is not null`),
    check('project_start_date', yearMonthFormat(t.startDate)),
    check('project_end_date', yearMonthFormat(t.endDate)),
    check('project_period', sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('project_link_url', httpsOrNull(t.linkUrl)),
    check('project_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('project_status_sort_idx').on(t.status, t.sortOrder),
  ],
)

// ---- stack ------------------------------------------------------------
export const stack = sqliteTable(
  'stack',
  {
    id: id(),
    /** 識別名。スラッグと同じ形式。一意 */
    key: text('key').notNull().unique(),
    /** 表示名。日英共通 */
    displayName: text('display_name').notNull(),
    iconUrl: text('icon_url'),
    linkUrl: text('link_url'),
    sortOrder: integer('sort_order').notNull(),
    showOnTop: integer('show_on_top', { mode: 'boolean' }).notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('stack_key_format', sql`${t.key} <> '' and ${t.key} not glob '*[^a-z0-9-]*'`),
    check('stack_link_url', httpsOrNull(t.linkUrl)),
    check('stack_icon_url', mediaOrNull(t.iconUrl)),
    index('stack_sort_idx').on(t.sortOrder),
  ],
)

// ---- work_stack / project_stack --------------------------------------
export const workStack = sqliteTable(
  'work_stack',
  {
    workId: text('work_id')
      .notNull()
      .references(() => work.id, { onDelete: 'cascade' }),
    stackId: text('stack_id')
      .notNull()
      .references(() => stack.id, { onDelete: 'cascade' }),
    /** 作品の中での技術の表示順 */
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.stackId] }), index('work_stack_stack_idx').on(t.stackId)],
)

export const projectStack = sqliteTable(
  'project_stack',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => project.id, { onDelete: 'cascade' }),
    stackId: text('stack_id')
      .notNull()
      .references(() => stack.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.stackId] }), index('project_stack_stack_idx').on(t.stackId)],
)

// ---- blog_post --------------------------------------------------------
export const blogPost = sqliteTable(
  'blog_post',
  {
    id: id(),
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    status: status(),
    /** 公開日（値を入れるのは 5.3） */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** 更新日（値を入れるのは 5.3） */
    contentUpdatedAt: integer('content_updated_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('blog_post_slug_unique').on(t.slug),
    check('blog_post_slug_format', slugFormat(t.slug)),
    check('blog_post_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('blog_post_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check(
      'blog_post_published',
      sql`${t.status} <> 'published' or (${t.slug} is not null and ${t.publishedAt} is not null)`,
    ),
    check('blog_post_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('blog_post_status_published_idx').on(t.status, t.publishedAt),
  ],
)

// ---- coding_log -------------------------------------------------------
export const codingLog = sqliteTable(
  'coding_log',
  {
    id: id(),
    slug: text('slug'),
    kind: text('kind', { enum: CODING_LOG_KINDS }).notNull().default('learning_log'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    referenceUrl: text('reference_url'),
    thumbnailUrl: text('thumbnail_url'),
    status: status(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    contentUpdatedAt: integer('content_updated_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('coding_log_slug_unique').on(t.slug),
    check('coding_log_slug_format', slugFormat(t.slug)),
    check('coding_log_kind', sql`${t.kind} in (${inList(CODING_LOG_KINDS)})`),
    check('coding_log_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('coding_log_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check(
      'coding_log_published',
      sql`${t.status} <> 'published' or (${t.slug} is not null and ${t.publishedAt} is not null)`,
    ),
    check('coding_log_reference_url', httpsOrNull(t.referenceUrl)),
    check('coding_log_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('coding_log_status_published_idx').on(t.status, t.publishedAt),
  ],
)

// ---- Better Auth（管理者のログイン） -----------------------------------
export const adminUser = sqliteTable('admin_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** GitHub の数値 ID。ADMIN_GITHUB_USER_ID と一致する人だけが作られる */
  githubUserId: text('github_user_id').notNull().unique(),
  /** GitHub のユーザー名。ログインのたびに更新する */
  githubLogin: text('github_login').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const adminSession = sqliteTable(
  'admin_session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('admin_session_user_idx').on(t.userId)],
)

export const adminAccount = sqliteTable(
  'admin_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => adminUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('admin_account_provider_unique').on(t.providerId, t.accountId)],
)

export const authVerification = sqliteTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
)

// ---- リレーション（db.query で使う） ------------------------------------
export const workRelations = relations(work, ({ many }) => ({ stacks: many(workStack) }))
export const projectRelations = relations(project, ({ many }) => ({ stacks: many(projectStack) }))
export const stackRelations = relations(stack, ({ many }) => ({ works: many(workStack), projects: many(projectStack) }))
export const workStackRelations = relations(workStack, ({ one }) => ({
  work: one(work, { fields: [workStack.workId], references: [work.id] }),
  stack: one(stack, { fields: [workStack.stackId], references: [stack.id] }),
}))
export const projectStackRelations = relations(projectStack, ({ one }) => ({
  project: one(project, { fields: [projectStack.projectId], references: [project.id] }),
  stack: one(stack, { fields: [projectStack.stackId], references: [stack.id] }),
}))
