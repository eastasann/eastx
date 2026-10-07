/**
 * デモデータ（design-spec 8章）。件数と、確認したい状態のバリエーションはその表に合わせる。
 * 表を変えたら `data.test.ts` の検査も合わせて直す。
 */
import type {
  blogPost,
  career,
  codingLog,
  profile,
  project,
  projectStack,
  socialLink,
  stack,
  work,
  workStack,
} from '../../src/db/schema'
import { createImageFactory, type SeedImage } from './images'

export type SeedData = {
  profile: (typeof profile.$inferInsert)[]
  socialLinks: (typeof socialLink.$inferInsert)[]
  careers: (typeof career.$inferInsert)[]
  stacks: (typeof stack.$inferInsert)[]
  works: (typeof work.$inferInsert)[]
  workStacks: (typeof workStack.$inferInsert)[]
  projects: (typeof project.$inferInsert)[]
  projectStacks: (typeof projectStack.$inferInsert)[]
  blogPosts: (typeof blogPost.$inferInsert)[]
  codingLogs: (typeof codingLog.$inferInsert)[]
  images: SeedImage[]
}

export type SeedOptions = {
  /** ブログとコーディング記録を0件にする（make db-seed-empty。トップのセクションとメニューが消えることの確認用） */
  empty: boolean
}

/** 日本時間の日時。シードの日付を読みやすく書くため */
const jst = (isoLocal: string) => new Date(`${isoLocal}+09:00`)

const CODE_TS = ['```ts', 'export const add = (a: number, b: number): number => a + b', '```'].join('\n')
const CODE_SQL = ['```sql', "select id, slug from work where status = 'published' order by sort_order;", '```'].join(
  '\n',
)
const CODE_SH = ['```sh', 'bunx wrangler d1 migrations apply eastx-db-local --local', '```'].join('\n')

const LONG_BODY_JA = [
  '社内向けの業務システムを、要件定義から運用まで担当しました。',
  '',
  '- 受発注の管理画面を React と TypeScript で作り直し、画面の表示を3秒から0.5秒に短縮',
  '- バッチ処理をキューに移し、夜間の処理の失敗を月10件から0件に削減',
  '- 新しく入ったメンバー4名のオンボーディングと、コードレビューの仕組みづくり',
  '- 障害対応の手順書を整備し、一次対応の時間を半分に',
  '',
  '小さなチームだったので、インフラの設定やお客さまとの打ち合わせにも関わりました。',
  '技術の選定では、運用する人が少なくても回せることを一番に考えました。',
].join('\n')

const LONG_BODY_EN = [
  'Owned an internal business system from requirements to operations.',
  '',
  '- Rebuilt the order management UI with React and TypeScript, cutting load time from 3s to 0.5s',
  '- Moved batch jobs onto a queue, reducing nightly failures from 10 a month to zero',
  '- Onboarded four new members and set up a code review process',
  '- Wrote incident runbooks that halved first-response time',
  '',
  'As a small team, I also worked on infrastructure and joined client meetings.',
  'When choosing technologies, the top priority was something a small team could operate.',
].join('\n')

/** 下書きを最後に保存した日時 */
const DRAFT_SAVED_AT = jst('2026-10-01T12:00:00')

/**
 * 作成・更新の日時。既定（シードを入れた時刻）のままだと公開日より後に作られたことになるので、
 * 公開した日時（下書きは最後に保存した日時）に揃える。`updatedAt` は公開後に更新したものだけ別にする
 */
const stamps = (createdAt: Date, updatedAt: Date = createdAt) => ({ createdAt, updatedAt })

export function buildSeed(options: SeedOptions): SeedData {
  const image = createImageFactory()

  // ---- profile / social_link ------------------------------------------
  const profileRows: SeedData['profile'] = [
    {
      nameJa: '東 アジア',
      nameEn: 'Asia Higashi',
      headlineJa: 'ソフトウェアエンジニア',
      headlineEn: 'Software Engineer',
      // 太字の React・TypeScript は使用技術と一致してアイコンが付き、使いやすさ・usability は一致しない（design-spec 8章）
      bioJa:
        'Web のフロントエンドとバックエンドを作っています。主に **React** と **TypeScript** を使います。\n\n小さく作って早く出し、**使いやすさ**を確かめながら直すのが好きです。',
      bioEn:
        'I build web frontends and backends, mostly with **React** and **TypeScript**.\n\nI like to ship small, check the **usability**, and keep improving.',
      avatarUrl: image.url('avatar', 'Photo'),
    },
  ]

  const socialLinks: SeedData['socialLinks'] = [
    { service: 'github', url: 'https://github.com/example', sortOrder: 0 },
    { service: 'linkedin', url: 'https://www.linkedin.com/in/example', sortOrder: 1 },
    { service: 'x', url: 'https://x.com/example', sortOrder: 2 },
    { service: 'other', url: 'https://example.com', label: 'Portfolio', sortOrder: 3 },
  ]

  // ---- career（職歴5・学歴3。公開7・下書き1） -----------------------------
  const careers: SeedData['careers'] = [
    {
      kind: 'work',
      titleJa: 'シニアエンジニア',
      titleEn: 'Senior Engineer',
      organizationJa: '株式会社サンプル',
      organizationEn: 'Sample Inc.',
      locationJa: '東京',
      locationEn: 'Tokyo',
      bodyJa: 'Web サービスの設計と開発をリードしています。',
      bodyEn: 'Leading the design and development of web services.',
      startDate: '2024-04',
      endDate: null, // 「現在」の職歴
      status: 'published',
    },
    {
      kind: 'work',
      titleJa: 'ソフトウェアエンジニア',
      titleEn: 'Software Engineer',
      organizationJa: '株式会社テスト',
      organizationEn: 'Test Co., Ltd.',
      locationJa: '大阪',
      locationEn: 'Osaka',
      bodyJa: LONG_BODY_JA, // 行を広げたときに全文が出ることを確かめる長さ
      bodyEn: LONG_BODY_EN,
      startDate: '2021-04',
      endDate: '2024-03',
      status: 'published',
    },
    {
      kind: 'work',
      titleJa: null, // 英語のみ（/ja で言語ラベルが出る）
      titleEn: 'Software Engineer Intern',
      organizationEn: 'Example Labs',
      locationEn: 'Singapore',
      bodyEn: 'Built internal tools for the data team.',
      startDate: '2020-07',
      endDate: '2020-09',
      status: 'published',
    },
    {
      kind: 'work',
      titleJa: 'Web 制作アルバイト',
      titleEn: 'Part-time Web Developer',
      organizationJa: 'デザイン事務所デモ',
      organizationEn: 'Demo Design Studio',
      startDate: '2019-04',
      endDate: '2021-03',
      status: 'published',
    },
    {
      kind: 'work',
      titleJa: 'フリーランス（準備中）',
      titleEn: 'Freelance (draft)',
      startDate: '2026-10',
      status: 'draft',
    },
    {
      kind: 'education',
      titleJa: '情報工学専攻 修士課程',
      titleEn: 'M.S. in Computer Science',
      organizationJa: 'サンプル大学大学院',
      organizationEn: 'Graduate School of Sample University',
      locationJa: '京都',
      locationEn: 'Kyoto',
      startDate: '2019-04',
      endDate: '2021-03',
      status: 'published',
    },
    {
      kind: 'education',
      titleJa: '情報工学科',
      titleEn: 'B.S. in Computer Science',
      organizationJa: 'サンプル大学',
      organizationEn: 'Sample University',
      locationJa: '京都',
      locationEn: 'Kyoto',
      startDate: '2015-04',
      endDate: '2019-03',
      status: 'published',
    },
    {
      kind: 'education',
      titleJa: '交換留学',
      titleEn: 'Exchange Program',
      organizationJa: 'デモ大学',
      organizationEn: 'Demo University',
      locationJa: 'シドニー',
      locationEn: 'Sydney',
      startDate: '2017-09',
      endDate: '2018-02',
      status: 'published',
    },
  ]

  // ---- stack（15。アイコンあり14・なし1、トップに出さない2） -------------------
  const stackDefs: { key: string; name: string; link?: string; icon: boolean; top: boolean }[] = [
    { key: 'typescript', name: 'TypeScript', link: 'https://www.typescriptlang.org', icon: true, top: true },
    { key: 'react', name: 'React', link: 'https://react.dev', icon: true, top: true },
    { key: 'tanstack-start', name: 'TanStack Start', link: 'https://tanstack.com/start', icon: true, top: true },
    { key: 'nextjs', name: 'Next.js', link: 'https://nextjs.org', icon: true, top: true },
    { key: 'nodejs', name: 'Node.js', link: 'https://nodejs.org', icon: true, top: true },
    { key: 'bun', name: 'Bun', link: 'https://bun.sh', icon: true, top: true },
    { key: 'cloudflare-workers', name: 'Cloudflare Workers', icon: true, top: true },
    { key: 'postgresql', name: 'PostgreSQL', link: 'https://www.postgresql.org', icon: true, top: true },
    { key: 'sqlite', name: 'SQLite', link: 'https://www.sqlite.org', icon: true, top: true },
    { key: 'drizzle', name: 'Drizzle ORM', link: 'https://orm.drizzle.team', icon: true, top: true },
    { key: 'go', name: 'Go', link: 'https://go.dev', icon: true, top: true },
    { key: 'python', name: 'Python', link: 'https://www.python.org', icon: true, top: true },
    { key: 'docker', name: 'Docker', link: 'https://www.docker.com', icon: true, top: true },
    { key: 'jquery', name: 'jQuery', icon: true, top: false },
    { key: 'perl', name: 'Perl', icon: false, top: false },
  ]
  const stacks: SeedData['stacks'] = stackDefs.map((s, i) => ({
    id: crypto.randomUUID(),
    key: s.key,
    displayName: s.name,
    linkUrl: s.link ?? null,
    iconUrl: s.icon ? image.url('icon', s.name) : null,
    showOnTop: s.top,
    sortOrder: i,
  }))
  const stackId = (key: string) => {
    const found = stacks.find((s) => s.key === key)
    if (!found?.id) throw new Error(`シードに無い使用技術: ${key}`)
    return found.id
  }

  // ---- work（公開11・下書き1） ---------------------------------------------
  type WorkDef = Omit<typeof work.$inferInsert, 'id' | 'sortOrder' | 'firstPublishedAt'> & { stackKeys: string[] }
  const workDefs: WorkDef[] = [
    {
      slug: 'portfolio-cms',
      titleJa: 'ポートフォリオと CMS',
      titleEn: 'Portfolio and CMS',
      summaryJa: '日英2言語のポートフォリオと、自作の管理画面。',
      summaryEn: 'A bilingual portfolio with a self-made admin.',
      bodyJa: `## 作ったもの\n\n公開サイトと管理画面を1つの Worker で動かしています。\n\n${CODE_TS}`,
      bodyEn: `## What I built\n\nThe public site and the admin run on a single Worker.\n\n${CODE_TS}`,
      thumbnailUrl: image.url('thumbnail', 'Portfolio'),
      linkUrl: 'https://example.com/portfolio',
      githubUrl: 'https://github.com/example/portfolio',
      // 使用技術が7個以上で「+N」が出る
      stackKeys: ['typescript', 'react', 'tanstack-start', 'cloudflare-workers', 'sqlite', 'drizzle', 'bun', 'nodejs'],
    },
    {
      slug: 'task-board',
      titleJa: 'タスクボード',
      titleEn: 'Task Board',
      summaryJa: 'チームで使うかんばん形式のタスク管理。',
      summaryEn: 'A kanban-style task manager for teams.',
      bodyJa: '## 概要\n\nドラッグで並べ替えられるかんばんです。',
      bodyEn: '## Overview\n\nA kanban board you can reorder by dragging.',
      thumbnailUrl: image.url('thumbnail', 'Task Board'),
      githubUrl: 'https://github.com/example/task-board',
      stackKeys: ['typescript', 'nextjs', 'postgresql'],
    },
    {
      slug: 'weather-cli',
      titleJa: '天気の CLI',
      titleEn: 'Weather CLI',
      summaryJa: 'ターミナルで天気予報を見るツール。',
      summaryEn: 'A tool to check the weather forecast in the terminal.',
      bodyJa: '## 使い方\n\n`weather tokyo` で東京の天気を出します。',
      bodyEn: '## Usage\n\nRun `weather tokyo` to see the weather in Tokyo.',
      thumbnailUrl: image.url('thumbnail', 'Weather CLI'),
      linkUrl: 'https://example.com/weather',
      stackKeys: ['go'],
    },
    {
      // 詳細本文なしで外部リンクだけ
      slug: 'landing-page',
      titleJa: 'ランディングページ',
      titleEn: 'Landing Page',
      summaryJa: '新サービスの告知ページ。',
      summaryEn: 'An announcement page for a new service.',
      linkUrl: 'https://example.com/landing',
      stackKeys: ['react'],
    },
    {
      // 詳細本文なしで GitHub だけ
      slug: 'dotfiles',
      titleJa: 'dotfiles',
      titleEn: 'dotfiles',
      summaryJa: '開発環境の設定ファイル。',
      summaryEn: 'Configuration files for my dev environment.',
      githubUrl: 'https://github.com/example/dotfiles',
      stackKeys: ['docker'],
    },
    {
      // 外部リンクも GitHub もなく押せない
      slug: 'internal-tool',
      titleJa: '社内ツール',
      titleEn: 'Internal Tool',
      summaryJa: '社内で使っている集計ツール（非公開）。',
      summaryEn: 'An internal reporting tool (private).',
      stackKeys: ['perl', 'jquery'],
    },
    {
      slug: 'markdown-viewer',
      titleJa: 'Markdown ビューア',
      titleEn: 'Markdown Viewer',
      summaryJa: 'ブラウザで Markdown を読むための小さなビューア。',
      summaryEn: 'A small viewer for reading Markdown in the browser.',
      bodyJa: '## 概要\n\nファイルを落とすとその場で描画します。',
      bodyEn: '## Overview\n\nDrop a file and it renders right away.',
      stackKeys: ['typescript', 'react'],
    },
    {
      // 詳細本文なしで外部リンクだけ
      slug: 'event-site',
      titleJa: '勉強会の告知サイト',
      titleEn: 'Meetup Site',
      summaryJa: '地域の勉強会の日程と会場の案内。',
      summaryEn: 'Dates and venues for a local meetup.',
      linkUrl: 'https://example.com/meetup',
      stackKeys: ['nextjs'],
    },
    {
      // 詳細本文なしで GitHub だけ
      slug: 'tab-cleaner',
      titleJa: 'タブ整理の拡張機能',
      titleEn: 'Tab Cleaner',
      summaryJa: '開きっぱなしのタブをまとめて閉じるブラウザ拡張。',
      summaryEn: 'A browser extension that closes stale tabs.',
      githubUrl: 'https://github.com/example/tab-cleaner',
      stackKeys: ['typescript'],
    },
    {
      slug: 'budget-app',
      titleJa: '家計簿アプリ',
      titleEn: 'Budget App',
      summaryJa: 'レシートの写真から支出を記録する。',
      summaryEn: 'Records spending from photos of receipts.',
      bodyJa: '## 概要\n\n読み取った金額を月ごとにまとめます。',
      bodyEn: '## Overview\n\nIt totals the amounts it reads by month.',
      linkUrl: 'https://example.com/budget',
      stackKeys: ['python', 'postgresql'],
    },
    {
      slug: 'recipe-notes',
      titleJa: 'レシピノート',
      titleEn: 'Recipe Notes',
      summaryJa: '家族で共有するレシピ帳。',
      summaryEn: 'A recipe book shared with family.',
      // 詳細本文が日本語だけ（/en の詳細で日本語の本文と注記が出る）。
      // 表示順の11番目（2ページ目）に置き、ページングした先から詳細へ移って「戻る」で元のページに戻る流れを確かめられるようにする
      bodyJa: '## 背景\n\n家族のレシピを1か所にまとめたくて作りました。',
      bodyEn: null,
      thumbnailUrl: image.url('thumbnail', 'Recipe Notes'),
      stackKeys: ['python', 'sqlite'],
    },
    {
      slug: null, // 下書きなのでスラッグは未定でよい
      titleJa: '作りかけのゲーム',
      titleEn: 'Unfinished Game',
      summaryJa: 'ブラウザで遊べるパズル。',
      status: 'draft',
      stackKeys: ['typescript'],
    },
  ]
  const works: SeedData['works'] = []
  const workStacks: SeedData['workStacks'] = []
  workDefs.forEach(({ stackKeys, ...w }, i) => {
    const id = crypto.randomUUID()
    const status = w.status ?? 'published'
    works.push({
      ...w,
      id,
      status,
      sortOrder: i,
      firstPublishedAt: status === 'published' ? jst(`2025-${String(12 - i).padStart(2, '0')}-01T10:00:00`) : null,
      ...stamps(jst(`2025-${String(12 - i).padStart(2, '0')}-01T09:00:00`)),
    })
    stackKeys.forEach((key, order) => {
      workStacks.push({ workId: id, stackId: stackId(key), sortOrder: order })
    })
  })

  // ---- project（公開6・下書き1） -------------------------------------------
  type ProjectDef = Omit<typeof project.$inferInsert, 'id' | 'sortOrder' | 'firstPublishedAt'> & { stackKeys: string[] }
  const projectDefs: ProjectDef[] = [
    {
      slug: 'payment-renewal',
      titleJa: '決済基盤の刷新',
      titleEn: 'Payment Platform Renewal',
      summaryJa: '決済まわりを新しい基盤に移しました。',
      summaryEn: 'Migrated payments to a new platform.',
      bodyJa: `## 役割\n\nテックリードとして移行計画を立てました。\n\n${CODE_SQL}`,
      bodyEn: `## Role\n\nPlanned the migration as tech lead.\n\n${CODE_SQL}`,
      thumbnailUrl: image.url('thumbnail', 'Payments'),
      linkUrl: 'https://example.com/payments',
      startDate: '2024-04',
      endDate: null, // 進行中
      stackKeys: ['typescript', 'nodejs', 'postgresql'],
    },
    {
      slug: 'search-improvement',
      titleJa: '検索の改善',
      titleEn: 'Search Improvement',
      summaryJa: '検索の速度と精度を上げました。',
      summaryEn: 'Improved search speed and relevance.',
      bodyJa: '## 成果\n\n検索の応答時間を半分にしました。',
      bodyEn: '## Results\n\nHalved search response time.',
      thumbnailUrl: image.url('thumbnail', 'Search'),
      startDate: '2023-01',
      endDate: '2023-12',
      stackKeys: ['go', 'postgresql'],
    },
    {
      slug: 'mobile-api',
      titleJa: 'モバイルアプリの API',
      titleEn: 'Mobile App API',
      summaryJa: 'スマホアプリ向けの API を作りました。',
      summaryEn: 'Built an API for a mobile app.',
      bodyJa: '## 構成\n\nAPI は Go、データベースは PostgreSQL です。',
      bodyEn: '## Architecture\n\nThe API is Go and the database is PostgreSQL.',
      thumbnailUrl: image.url('thumbnail', 'Mobile API'),
      startDate: '2022-04',
      endDate: '2022-12',
      stackKeys: ['go', 'docker'],
    },
    {
      // 詳細本文なしで外部リンクあり
      slug: 'conference-site',
      titleJa: 'カンファレンスのサイト',
      titleEn: 'Conference Website',
      summaryJa: '技術カンファレンスの公式サイト。',
      summaryEn: 'The official site of a tech conference.',
      linkUrl: 'https://example.com/conference',
      startDate: '2021-06',
      endDate: '2021-10',
      stackKeys: ['nextjs'],
    },
    {
      // 詳細本文なしで外部リンクあり
      slug: 'oss-contribution',
      titleJa: 'OSS へのコントリビュート',
      titleEn: 'OSS Contributions',
      summaryJa: '使っているライブラリへの修正の提案。',
      summaryEn: 'Fixes contributed to libraries I use.',
      linkUrl: 'https://github.com/example',
      startDate: '2020-01',
      endDate: '2021-03',
      stackKeys: ['typescript'],
    },
    {
      // 外部リンクもなく押せない
      slug: 'legacy-migration',
      titleJa: '古いシステムの移行',
      titleEn: 'Legacy System Migration',
      summaryJa: '古い社内システムを新しい環境に移しました。',
      summaryEn: 'Moved an old internal system to a new environment.',
      startDate: '2019-04',
      endDate: '2019-12',
      stackKeys: ['perl'],
    },
    {
      slug: null,
      titleJa: '次のプロジェクト（下書き）',
      titleEn: 'Next Project (draft)',
      status: 'draft',
      stackKeys: [],
    },
  ]
  const projects: SeedData['projects'] = []
  const projectStacks: SeedData['projectStacks'] = []
  projectDefs.forEach(({ stackKeys, ...p }, i) => {
    const id = crypto.randomUUID()
    const status = p.status ?? 'published'
    projects.push({
      ...p,
      id,
      status,
      sortOrder: i,
      firstPublishedAt: status === 'published' ? jst(`2025-${String(12 - i).padStart(2, '0')}-15T10:00:00`) : null,
      ...stamps(jst(`2025-${String(12 - i).padStart(2, '0')}-15T09:00:00`)),
    })
    stackKeys.forEach((key, order) => {
      projectStacks.push({ projectId: id, stackId: stackId(key), sortOrder: order })
    })
  })

  // ---- blog_post（公開12・下書き1。日英6・日本語のみ4・英語のみ2） ---------------
  const blogPosts: SeedData['blogPosts'] = []
  if (!options.empty) {
    type BlogDef = {
      slug: string | null
      ja?: [title: string, body: string]
      en?: [title: string, body: string]
      thumbnail?: boolean
      updated?: boolean
      draft?: boolean
    }
    const defs: BlogDef[] = [
      {
        slug: 'hello-eastx',
        ja: ['サイトを作り直しました', `Cloudflare Workers の上に作り直しました。\n\n${CODE_SH}`],
        en: ['I rebuilt my site', `I rebuilt it on Cloudflare Workers.\n\n${CODE_SH}`],
        thumbnail: true,
        updated: true, // 公開後に更新した
      },
      {
        slug: 'd1-batch',
        ja: ['D1 でまとめて書き込む', `D1 には対話的なトランザクションがありません。\n\n${CODE_TS}`],
        en: ['Batch writes on D1', `D1 has no interactive transactions.\n\n${CODE_TS}`],
        thumbnail: true,
      },
      {
        slug: 'design-tokens',
        ja: ['デザイントークンの運用', `値はトークンにだけ書きます。\n\n${CODE_TS}`],
        en: ['Working with design tokens', `Values live only in tokens.\n\n${CODE_TS}`],
        thumbnail: true,
      },
      {
        slug: 'bilingual-site',
        ja: ['日英2言語のサイト', '片方の言語しかない記事の出し方を考えました。'],
        en: ['A bilingual site', 'How to show posts that exist in only one language.'],
        thumbnail: true,
      },
      {
        slug: 'small-team',
        ja: ['小さなチームの技術選定', '運用する人が少なくても回せることを優先します。'],
        en: ['Choosing tech for a small team', 'Prefer what a small team can operate.'],
      },
      {
        slug: 'year-in-review',
        ja: ['今年の振り返り', '今年やったことをまとめます。'],
        en: ['Year in review', 'A summary of what I did this year.'],
      },
      { slug: 'kyoto-cafe', ja: ['京都のカフェで作業', '静かなカフェで作業すると捗ります。'], thumbnail: true },
      { slug: 'reading-notes', ja: ['読書メモ', '最近読んだ技術書のメモです。'] },
      { slug: 'conference-report', ja: ['カンファレンスの参加レポート', '登壇の内容をまとめます。'] },
      { slug: 'keyboard', ja: ['キーボードを替えた', '分割キーボードにして1か月たちました。'] },
      { slug: 'remote-work', en: ['Notes on remote work', 'What worked for me while working remotely.'] },
      { slug: 'english-only-tips', en: ['Tips for code review', 'Small habits that make reviews faster.'] },
      { slug: null, ja: ['書きかけの記事', 'まだ途中です。'], draft: true },
    ]
    defs.forEach((d, i) => {
      // 新しい記事ほど先に並ぶよう、配列の順に公開日を古くしていく
      const publishedAt = d.draft ? null : jst(`2026-09-${String(28 - i * 2).padStart(2, '0')}T09:00:00`)
      blogPosts.push({
        slug: d.slug,
        titleJa: d.ja?.[0] ?? null,
        bodyJa: d.ja?.[1] ?? null,
        titleEn: d.en?.[0] ?? null,
        bodyEn: d.en?.[1] ?? null,
        thumbnailUrl: d.thumbnail ? image.url('thumbnail', d.en?.[0] ?? d.slug ?? 'Blog') : null,
        status: d.draft ? 'draft' : 'published',
        publishedAt,
        // 更新日は公開中の記事を更新したときだけ入る（SDD 5.3）
        contentUpdatedAt: d.updated ? jst('2026-09-30T18:00:00') : null,
        ...stamps(publishedAt ?? DRAFT_SAVED_AT, d.updated ? jst('2026-09-30T18:00:00') : undefined),
      })
    })
  }

  // ---- coding_log（公開11・下書き1。4種類を2件以上、参考リンク3、コードブロック8） -------
  const codingLogs: SeedData['codingLogs'] = []
  if (!options.empty) {
    type LogDef = {
      slug: string | null
      kind: (typeof codingLog.$inferInsert)['kind']
      ja: string
      en: string
      code?: string
      reference?: string
      draft?: boolean
    }
    const defs: LogDef[] = [
      { slug: 'learn-elysia', kind: 'learning_log', ja: 'Elysia を触った', en: 'Trying Elysia', code: CODE_TS },
      {
        slug: 'learn-drizzle',
        kind: 'learning_log',
        ja: 'Drizzle のスキーマ',
        en: 'Drizzle schemas',
        code: CODE_SQL,
        reference: 'https://orm.drizzle.team/docs/overview',
      },
      { slug: 'learn-panda', kind: 'learning_log', ja: 'Panda CSS の基本', en: 'Panda CSS basics' },
      { slug: 'snippet-add', kind: 'snippet', ja: '足し算の関数', en: 'An add function', code: CODE_TS },
      { slug: 'snippet-migrate', kind: 'snippet', ja: 'D1 のマイグレーション', en: 'D1 migrations', code: CODE_SH },
      { slug: 'snippet-query', kind: 'snippet', ja: '公開中の作品の一覧', en: 'Published works', code: CODE_SQL },
      {
        slug: 'problem-two-sum',
        kind: 'problem',
        ja: 'Two Sum を解いた',
        en: 'Solved Two Sum',
        code: CODE_TS,
        reference: 'https://leetcode.com/problems/two-sum/',
      },
      {
        slug: 'problem-cascade',
        kind: 'problem',
        ja: '外部キーで行が消えた',
        en: 'Rows vanished by a foreign key',
        code: CODE_SQL,
      },
      {
        slug: 'memo-cache-api',
        kind: 'memo',
        ja: 'Cache API のメモ',
        en: 'Notes on the Cache API',
        code: CODE_TS,
        reference: 'https://developers.cloudflare.com/workers/runtime-apis/cache/',
      },
      { slug: 'memo-timezone', kind: 'memo', ja: 'タイムゾーンの扱い', en: 'Handling time zones' },
      { slug: 'memo-glob', kind: 'memo', ja: 'SQLite の GLOB', en: 'GLOB in SQLite' },
      { slug: null, kind: 'snippet', ja: '書きかけの断片', en: 'Unfinished snippet', draft: true },
    ]
    defs.forEach((d, i) => {
      const publishedAt = d.draft ? null : jst(`2026-08-${String(28 - i * 2).padStart(2, '0')}T21:00:00`)
      const tail = d.code ? `\n\n${d.code}` : ''
      codingLogs.push({
        slug: d.slug,
        kind: d.kind,
        titleJa: d.ja,
        titleEn: d.en,
        bodyJa: `${d.ja}についての記録です。${tail}`,
        bodyEn: `A note about ${d.en.toLowerCase()}.${tail}`,
        referenceUrl: d.reference ?? null,
        status: d.draft ? 'draft' : 'published',
        publishedAt,
        ...stamps(publishedAt ?? DRAFT_SAVED_AT),
      })
    })
  }

  return {
    profile: profileRows,
    socialLinks,
    careers,
    stacks,
    works,
    workStacks,
    projects,
    projectStacks,
    blogPosts,
    codingLogs,
    images: image.images,
  }
}
