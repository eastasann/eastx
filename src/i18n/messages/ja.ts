/**
 * 公開側の固定文言（日本語）。en.ts はこの型を満たす（ADR-013、SDD 9章）。
 * 対訳の正は design-spec 1.4 と各画面の仕様。管理画面の文言はここに置かず、日本語を直接書く
 * （セクションの名前だけは公開側と共通の英語で、`../section-names.ts` が持つ）
 */
import type { Lang } from '../detect'
import { SECTION_NAMES } from '../section-names'

const LANG_NAMES: Record<Lang, string> = { ja: '日本語', en: '英語' }

export const ja = {
  siteName: 'eastasian',
  section: { profile: 'プロフィール', ...SECTION_NAMES },
  careerKind: { work: '職歴', education: '学歴' },
  codingLogKind: {
    learning_log: '学習ログ',
    snippet: 'コード断片',
    problem: '問題を解いた記録',
    memo: '技術メモ',
  },
  period: { present: '現在' },
  action: {
    viewDetails: '詳細を見る',
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
    /** 作品・プロジェクトの詳細本文 */
    bodyOnlyIn: (lang: Lang): string => `この説明は${LANG_NAMES[lang]}のみです`,
  },
  /**
   * 詳細ページの戻るリンクの、セクションの名前の前後に読み上げだけで足す語（「Lab へ戻る」）。見える文字はセクションの
   * 名前だけ（← Lab）。名前は英語の発音で読ませるので、名前と前後の語を別の要素にして、文を作らずに部品で並べる
   */
  backLink: (): { before: string; after: string } => ({ before: '', after: 'へ戻る' }),
  neighbor: {
    /** 詳細ページの前後のナビのまとまりの読み上げ名 */
    nav: '前後のページ',
    /** 作品・プロジェクトの前後（表示順） */
    previous: '前へ',
    next: '次へ',
    newerPost: '新しい記事',
    olderPost: '古い記事',
    newerLog: '新しい記録',
    olderLog: '古い記録',
  },
  paging: {
    /** ページングの操作（◀ 現在 / 全体 ▶）のまとまりの読み上げ名 */
    /** セクションの名前（見出し）に続けて読み上げる語（「Lab のページ」）。名前は見出しの要素から英語の発音で読ませる */
    controlsSuffix: 'のページ',
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
