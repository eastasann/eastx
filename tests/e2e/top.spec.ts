/**
 * P1 トップと P2・P3 の詳細（design-spec 6.1・6.2）。コアフロー「何者かつかみ、作品で確かめる」（design-spec 2.2）の
 * トップ → 作品をページング → 作品詳細 → 戻るで元のページ、言語の切り替えのスクロール、0件のセクションが消えること。
 * make e2e のデモデータ（make db-seed）を前提にする。作品は公開7件で、2ページ目に詳細ページを持つ「レシピノート」がある
 */
import type { Locator, Page } from '@playwright/test'
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'

const COPY = {
  ja: {
    next: '次のページ',
    previous: '前のページ',
    paging: '作品のページ',
    recipe: 'レシピノート',
    weather: '天気の CLI',
    back: '作品へ戻る',
  },
  en: {
    next: 'Next page',
    previous: 'Previous page',
    paging: 'Works pages',
    recipe: 'Recipe Notes',
    weather: 'Weather CLI',
    back: 'Back to Works',
  },
} as const

function worksPaging(page: Page, lang: keyof typeof COPY): Locator {
  return page.locator('#works').getByRole('group', { name: COPY[lang].paging })
}

/**
 * 次のクリックの時点のスクロールの位置を覚える。Playwright はクリックの前に押す要素を画面に入れるため
 * スクロールしうるので、ルーターが離れたときに覚える位置（移り始めの位置）と揃えるにはクリックの時点で読む
 */
async function scrollYAtNextClick(page: Page): Promise<() => Promise<number>> {
  await page.evaluate(() => {
    window.addEventListener('click', () => document.body.setAttribute('data-click-scroll-y', String(window.scrollY)), {
      capture: true,
      once: true,
    })
  })
  return async () => Number(await page.locator('body').getAttribute('data-click-scroll-y'))
}

/** セクションの上端が、固定ヘッダーのすぐ下（scroll-padding-top）にあるか */
async function sectionAtTop(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sectionId) => {
    const element = document.getElementById(sectionId)
    if (!element) return false
    const offset = Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop)
    return Math.abs(element.getBoundingClientRect().top - offset) <= 2
  }, id)
}

for (const lang of ['ja', 'en'] as const) {
  const copy = COPY[lang]

  test.describe(`${lang}: 作品のページングと詳細`, () => {
    test('ページングして詳細へ移り、戻るリンクで元のページに戻る', async ({ page }) => {
      await gotoHydrated(page, `/${lang}`)
      const paging = worksPaging(page, lang)
      await expect(paging).toContainText('1 / 2')
      await expect(paging.getByRole('button', { name: copy.previous })).toBeDisabled()
      await paging.getByRole('button', { name: copy.next }).click()
      await expect(paging).toContainText('2 / 2')
      await expect(paging.getByRole('button', { name: copy.next })).toBeDisabled()

      await page.locator('#works').getByRole('link', { name: copy.recipe }).click()
      await expect(page).toHaveURL(`/${lang}/works/recipe-notes`)
      await expect(page.getByRole('heading', { level: 1, name: copy.recipe })).toBeVisible()

      await page.getByRole('link', { name: copy.back }).click()
      await expect(page).toHaveURL(`/${lang}#works`)
      await expect(paging).toContainText('2 / 2')
      await expect(page.locator('#works').getByRole('link', { name: copy.recipe })).toBeVisible()
    })

    test('前後のナビで別の作品に移ったら、戻るリンクはその作品を含むページを開く', async ({ page }) => {
      // 詳細ページを直接開いた場合も、戻るリンクは元のページを開く（design-spec 6.1.3）
      await gotoHydrated(page, `/${lang}/works/recipe-notes`)
      await page
        .getByRole('navigation', { name: lang === 'ja' ? '前後のページ' : 'Previous and next' })
        .getByRole('link')
        .click()
      await expect(page).toHaveURL(`/${lang}/works/weather-cli`)
      await expect(page.getByRole('heading', { level: 1, name: copy.weather })).toBeVisible()
      await page.getByRole('link', { name: copy.back }).click()
      await expect(worksPaging(page, lang)).toContainText('1 / 2')
      await expect(page.locator('#works').getByRole('link', { name: copy.weather })).toBeVisible()
    })
  })
}

test.describe('ブラウザの「戻る」', () => {
  test('トップに戻ると、離れたときのスクロールの位置とページを出す', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const paging = worksPaging(page, 'ja')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await expect(paging).toContainText('2 / 2')
    await page.locator('#works').scrollIntoViewIfNeeded()
    const clickedScrollY = await scrollYAtNextClick(page)

    await page.locator('#works').getByRole('link', { name: 'レシピノート' }).click()
    await expect(page).toHaveURL('/ja/works/recipe-notes')
    const scrollY = await clickedScrollY()
    expect(scrollY).toBeGreaterThan(0)
    await page.goBack()
    await expect(page).toHaveURL('/ja')
    await expect(paging).toContainText('2 / 2')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
  })
})

test.describe('戻るリンクで来たあとのページング', () => {
  test('ページングしてから離れて「戻る」と、戻るリンクの項目ではなく離れたときのページを出す', async ({ page }) => {
    await gotoHydrated(page, '/ja/works/weather-cli')
    await page.getByRole('link', { name: '作品へ戻る' }).click()
    const paging = worksPaging(page, 'ja')
    await expect(paging).toContainText('1 / 2')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await page.locator('#works').getByRole('link', { name: 'レシピノート' }).click()
    await expect(page).toHaveURL('/ja/works/recipe-notes')
    await page.goBack()
    await expect(paging).toContainText('2 / 2')
  })
})

test.describe('言語の切り替え', () => {
  test('トップで見ていたセクションへスクロールし、詳細から「戻る」で離れたときの位置に戻る', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    await page.getByRole('navigation', { name: 'セクション' }).getByRole('link', { name: '作品' }).click()
    await expect.poll(() => sectionAtTop(page, 'works')).toBe(true)
    // 1ページ目に戻ることを確かめるため、2ページ目にしてから切り替える
    await worksPaging(page, 'ja').getByRole('button', { name: '次のページ' }).click()

    await page.getByRole('group', { name: '言語' }).getByRole('link', { name: 'EN' }).click()
    await expect(page).toHaveURL(/\/en(#works)?$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect.poll(() => sectionAtTop(page, 'works')).toBe(true)
    await expect(worksPaging(page, 'en')).toContainText('1 / 2')
    const clickedScrollY = await scrollYAtNextClick(page)

    await page.locator('#works').getByRole('link', { name: 'Task Board' }).click()
    await expect(page).toHaveURL('/en/works/task-board')
    const scrollY = await clickedScrollY()
    expect(scrollY).toBeGreaterThan(0)
    await page.goBack()
    await expect(page).toHaveURL(/\/en(#works)?$/)
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrollY)
  })
})

test.describe('セクション内ページングの操作', () => {
  test('キーボードの ← → で切り替え、切り替えを読み上げ、セクションの高さを変えない', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const works = page.locator('#works')
    const paging = worksPaging(page, 'ja')
    const list = works.locator('ul[data-position]').first().locator('..')
    const height = await list.evaluate((element) => element.getBoundingClientRect().height)

    await paging.getByRole('button', { name: '次のページ' }).focus()
    await page.keyboard.press('ArrowRight')
    await expect(paging).toContainText('2 / 2')
    await expect(works.locator('[aria-live="polite"]')).toHaveText('2ページ中2ページ目')
    // 最終ページの件数が少なくても、セクションの高さは一番高いページに揃う
    expect(await list.evaluate((element) => element.getBoundingClientRect().height)).toBe(height)
    await page.keyboard.press('ArrowLeft')
    await expect(paging).toContainText('1 / 2')
  })

  test('ハッシュ付きの URL でページングしても、スクロールの位置を動かさない', async ({ page }) => {
    await gotoHydrated(page, '/ja#works')
    await expect.poll(() => sectionAtTop(page, 'works')).toBe(true)
    await page.mouse.wheel(0, 200)
    await expect.poll(() => sectionAtTop(page, 'works')).toBe(false)
    const scrollY = await page.evaluate(() => window.scrollY)
    const paging = worksPaging(page, 'ja')
    // ボタンを画面に入れるためのスクロールを避け、要素の click() で押す
    await paging.getByRole('button', { name: '次のページ' }).evaluate((button: HTMLElement) => button.click())
    await expect(paging).toContainText('2 / 2')
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY)
  })

  test('横スワイプで切り替える', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const paging = worksPaging(page, 'ja')
    const viewport = page.locator('#works ul[data-position]').first().locator('..')
    const box = await viewport.boundingBox()
    if (!box) throw new Error('作品の一覧が見えない')
    const y = box.y + box.height / 2
    const swipe = async (fromX: number, toX: number) => {
      await viewport.dispatchEvent('pointerdown', { pointerType: 'touch', clientX: fromX, clientY: y, isPrimary: true })
      await viewport.dispatchEvent('pointerup', { pointerType: 'touch', clientX: toX, clientY: y, isPrimary: true })
    }
    await swipe(box.x + box.width - 20, box.x + 20)
    await expect(paging).toContainText('2 / 2')
    await swipe(box.x + 20, box.x + box.width - 20)
    await expect(paging).toContainText('1 / 2')
  })

  test('経歴の「続きを読む」はその場で広げ、ページを切り替えると閉じる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const career = page.locator('#career')
    const readMore = career.getByRole('button', { name: '続きを読む' })
    await expect(readMore).toHaveCount(1)
    await readMore.click()
    await expect(career.getByRole('button', { name: '閉じる' })).toHaveAttribute('aria-expanded', 'true')

    const paging = career.getByRole('group', { name: '経歴のページ' })
    await paging.getByRole('button', { name: '次のページ' }).click()
    await paging.getByRole('button', { name: '前のページ' }).click()
    await expect(career.getByRole('button', { name: '続きを読む' })).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('トップのカード', () => {
  test('行き先ごとの押し方・使用技術の「+N」・言語ラベル', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const works = page.locator('#works')
    // 詳細本文なしで外部リンクだけの作品は、外部リンクを別タブで開く
    await expect(works.getByRole('link', { name: /ランディングページ/ })).toHaveAttribute('target', '_blank')
    // 7個以上の技術を持つ作品は、6個と「+N」
    await expect(works.getByText('+2')).toBeVisible()
    // 英語だけの経歴には /ja で言語ラベル
    await expect(page.locator('#career').getByText('英語のみ')).toBeVisible()
  })

  test('読み込めない画像は、壊れた画像のアイコンではなく背景色だけの枠にする', async ({ page }) => {
    await page.route('**/media/**', (route) => route.abort())
    await gotoHydrated(page, '/ja/works/portfolio-cms')
    await expect(page.getByRole('heading', { level: 1, name: 'ポートフォリオと CMS' })).toBeVisible()
    await expect(page.locator('main img')).toHaveCount(0)
    // 使用技術のアイコンは、表示名の頭文字の丸に替わる
    await expect(page.locator('main').getByText('TypeScript')).toBeVisible()
  })

  test('詳細本文がない作品の詳細ページは C1', async ({ page }) => {
    const response = await page.goto('/ja/works/landing-page')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'ページが見つかりません' })).toBeVisible()
  })

  test('詳細本文が片方の言語だけなら、もう片方の言語の本文と注記を出す', async ({ page }) => {
    await page.goto('/en/works/recipe-notes')
    await expect(page.getByRole('note')).toHaveText('The description of this work is available in Japanese only.')
    await expect(page.locator('main [lang="ja"]').first()).toContainText('家族のレシピ')
  })
})

test.describe('ブログ・コーディング記録が0件', () => {
  // ほかのテストのため、終わったら全件のシードに戻す
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('セクションとヘッダーのメニューから消える', async ({ page, local }) => {
    await insertSeed(local.db, buildSeed({ empty: true }))
    await page.goto('/ja')
    await expect(page.locator('#works')).toBeVisible()
    await expect(page.locator('#blog')).toHaveCount(0)
    await expect(page.locator('#coding')).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'セクション' }).getByRole('link')).toHaveText([
      '経歴',
      'プロジェクト',
      '作品',
      '使用技術',
    ])
  })
})
