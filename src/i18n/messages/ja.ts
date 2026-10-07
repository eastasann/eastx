/**
 * 公開側の固定文言（日本語）。en.ts はこの型を満たす（ADR-013、SDD 9章）。
 * 対訳の正は design-spec 1.4 と各画面の仕様。管理画面の文言はここに置かず、日本語を直接書く
 */
import type { Lang } from '../detect'

const LANG_NAMES: Record<Lang, string> = { ja: '日本語', en: '英語' }

export const ja = {
  siteName: 'eastasian',
  section: {
    profile: 'プロフィール',
    career: '経歴',
    projects: 'プロジェクト',
    works: '作品',
    stack: '使用技術',
    blog: 'ブログ',
    coding: 'コーディング記録',
  },
  careerKind: { work: '職歴', education: '学歴' },
  codingLogKind: {
    learning_log: '学習ログ',
    snippet: 'コード断片',
    problem: '問題を解いた記録',
    memo: '技術メモ',
  },
  period: { present: '現在' },
  action: {
    visitSite: 'サイトを見る',
    github: 'GitHub',
    reload: '再読み込み',
    backToTop: 'トップへ戻る',
  },
  /** 表示中の言語で「言語あり」でない中身に付ける言語ラベル。引数は実際に出している中身の言語 */
  label: {
    onlyIn: (lang: Lang): string => `${LANG_NAMES[lang]}のみ`,
    /** 使用技術のアイコンの列で、出しきれなかった数（「+N」）の読み上げ名 */
    moreStacks: (count: number): string => `ほかに${count}個`,
    opensInNewTab: '別タブで開く',
    reference: '参考',
    updated: '更新',
  },
  /** 片方の言語しかない中身の注記（design-spec 1.4・6.2.3）。引数は実際に出している中身の言語 */
  notice: {
    postOnlyIn: (lang: Lang): string => `この記事は${LANG_NAMES[lang]}のみです`,
    codingLogOnlyIn: (lang: Lang): string => `この記録は${LANG_NAMES[lang]}のみです`,
    workBodyOnlyIn: (lang: Lang): string => `この作品の説明は${LANG_NAMES[lang]}のみです`,
    projectBodyOnlyIn: (lang: Lang): string => `このプロジェクトの説明は${LANG_NAMES[lang]}のみです`,
  },
  back: {
    works: '作品へ戻る',
    projects: 'プロジェクトへ戻る',
    blog: 'ブログへ戻る',
    coding: 'コーディング記録へ戻る',
  },
  neighbor: {
    /** 詳細ページの前後のナビのまとまりの読み上げ名 */
    nav: '前後のページ',
    prevWork: '前の作品',
    nextWork: '次の作品',
    prevProject: '前のプロジェクト',
    nextProject: '次のプロジェクト',
    newerPost: '新しい記事',
    olderPost: '古い記事',
    newerLog: '新しい記録',
    olderLog: '古い記録',
  },
  paging: {
    /** ページングの操作（◀ 現在 / 全体 ▶）のまとまりの読み上げ名 */
    controls: (section: string): string => `${section}のページ`,
    previous: '前のページ',
    next: '次のページ',
    /** セクション見出しの右の「現在 / 全体」 */
    position: (current: number, total: number): string => `${current} / ${total}`,
    /** ページの切り替えを読み上げる文 */
    announce: (current: number, total: number): string => `${total}ページ中${current}ページ目`,
  },
  header: {
    language: '言語',
  },
  footer: {
    copyright: '© eastasian',
    social: 'SNS',
  },
  theme: {
    /** テーマの切り替えボタンの読み上げ名。今の設定と、押したあとの設定を伝える */
    toggle: (current: string, next: string): string => `テーマ: ${current}（押すと${next}）`,
    system: 'OSに合わせる',
    light: 'ライト',
    dark: 'ダーク',
  },
  code: {
    copy: 'コピー',
    copied: 'コピーしました',
    copyFailed: 'コピーできませんでした',
  },
  notFound: {
    title: 'ページが見つかりません',
    body: 'お探しのページは存在しないか、公開されていません。',
  },
  error: {
    title: 'ただいま表示できません',
    body: '時間をおいて再読み込みしてください。',
  },
}

export type Messages = typeof ja
