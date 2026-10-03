/**
 * dnd-kit の並べ替えをキーボードで操作する（ADR-015。一覧の行・SNS リンク・使用技術のチップ）
 */
import { expect, type Locator, type Page } from '@playwright/test'

/**
 * dnd-kit のキーボード操作で、つまみの項目を `from` 番目から `to` 番目へ前に動かす（1始まり）。
 * 縦の並びは ArrowUp、横に並べて折り返す並び（チップ）は ArrowLeft で前へ動く。
 * dnd-kit は1回の矢印キーごとに位置を測り直すので、読み上げ（「n番目へ動かしました」）を待ってから次のキーを押す。
 * 持ち上げたあとの矢印キーの受け付けは setTimeout で後から付く（@dnd-kit/core 6.3.1 の KeyboardSensor.attach）ので、
 * 持ち上げの直後にページの側でもタイマーを1回回し、それが付いてから押す
 */
export async function moveUpByKeyboard(
  page: Page,
  handle: Locator,
  name: string,
  from: number,
  to: number,
  key: 'ArrowUp' | 'ArrowLeft' = 'ArrowUp',
) {
  await handle.focus()
  await page.keyboard.press('Space')
  // 持ち上げた直後の読み上げは、すぐに今の位置の読み上げ（「from番目へ動かしました」）で置き換わる
  await expect(page.getByText(`「${name}」を${from}番目へ動かしました`)).toBeAttached()
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)))
  for (let position = from - 1; position >= to; position--) {
    await page.keyboard.press(key)
    await expect(page.getByText(`「${name}」を${position}番目へ動かしました`)).toBeAttached()
  }
  await page.keyboard.press('Space')
}
