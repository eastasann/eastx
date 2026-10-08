/** 名前の頭文字。前後の空白を除いた最初の1文字（コードポイント）を大文字にする（design-spec 6.1.4）。頭文字の丸・枠と、自己紹介の太字の前のアイコンの代わりで共通 */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? ''
}
