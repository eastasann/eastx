import type { Page, Response } from '@playwright/test'

/**
 * SSR のページを開き、React がヘッダーを hydrate し終えるまで待つ。hydrate の前に押したボタンは何もしないので、
 * 公開側の画面でボタン（テーマ・メニュー）を押すテストはこれで開く。React が DOM の要素に付ける内部のキーで判定する
 */
export async function gotoHydrated(page: Page, url: string): Promise<Response | null> {
  const response = await page.goto(url)
  await page.waitForFunction(() => {
    const header = document.querySelector('header')
    return header !== null && Object.keys(header).some((key) => key.startsWith('__reactProps'))
  })
  return response
}
