/**
 * P1 の経歴・作品・プロジェクトの行の操作（design-spec 6.1.3）。行は全体が1つのボタンで、読み上げ名は行の名前。
 * 行き先への入口は広げた中にある
 */
import type { Locator, Page } from '@playwright/test'
import { expect } from './fixtures'

type Section = 'career' | 'projects' | 'works'

/** 行のボタン。ページングで隠れたページの行（inert）は含めない */
export function rowButton(page: Page, section: Section, name: string | RegExp): Locator {
  return page.locator(`#${section} ul:not([inert])`).getByRole('button', { name })
}

/** 行のボタンが指す、広げた中の包み */
export async function rowContent(page: Page, button: Locator): Promise<Locator> {
  return page.locator(`[id="${await button.getAttribute('aria-controls')}"]`)
}

/** 行を広げて、広げた中の包みを返す */
export async function expandRow(page: Page, section: Section, name: string | RegExp): Promise<Locator> {
  const button = rowButton(page, section, name)
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  return rowContent(page, button)
}
