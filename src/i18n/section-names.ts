/**
 * セクションの名前（design-spec 1.4）。公開側の /ja・/en と管理画面で共通の英語。
 * 作品（個人で作ったもの）は Lab、プロジェクト（仕事で作ったもの）は Projects と呼んで違いを見せる。
 * プロフィールのセクションは見出しを持たないので含めない（読み上げの名前は辞書が言語ごとに持つ）
 */
export const SECTION_NAMES = {
  career: 'Career',
  projects: 'Projects',
  works: 'Lab',
  stack: 'Tech Stack',
  blog: 'Blog',
  coding: 'Coding Log',
} as const

/** セクションの名前の言語。/ja のページでも英語の発音で読ませるよう、名前を出す要素の lang にする */
export const SECTION_NAME_LANG = 'en'
