/**
 * P1 トップと P2・P3 の詳細（design-spec 6.1・6.2）。コアフロー「何者かつかみ、作品で確かめる」（design-spec 2.2）の
 * トップ → 作品をページング → 作品詳細 → 戻るで元のページ、経歴・作品の行の展開、
 * 言語の切り替え（ページの一番上から開き、ページングは1ページ目）、0件のセクションが消えること。
 * make e2e のデモデータ（make db-seed）を前提にする。作品は公開11件（1ページ10件）で、2ページ目に詳細ページを持つ
 * 「レシピノート」がある。経歴（公開7）・プロジェクト（公開6）は10件以下でページングが出ない
 */
import type { Locator, Page } from '@playwright/test'
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import * as schema from '../../src/db/schema'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'

const COPY = {
  ja: {
    next: '次のページ',
    previous: '前のページ',
    paging: '作品のページ',
    recipe: 'レシピノート',
    budget: '家計簿アプリ',
    back: '作品へ戻る',
  },
  en: {
    next: 'Next page',
    previous: 'Previous page',
    paging: 'Works pages',
    recipe: 'Recipe Notes',
    budget: 'Budget App',
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

/** セクションの上端が、画面の上端にあるか（ヘッダーは固定しないので、ハッシュへのスクロールは上端で止まる） */
async function sectionAtTop(page: Page, id: string): Promise<boolean> {
  return page.evaluate((sectionId) => {
    const element = document.getElementById(sectionId)
    if (!element) return false
    return Math.abs(element.getBoundingClientRect().top) <= 2
  }, id)
}

/** 作品の行の ▸（読み上げ名は行の名前） */
function workToggle(page: Page, name: RegExp): Locator {
  return page.locator('#works').getByRole('button', { name })
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
      await expect(page).toHaveURL(`/${lang}/works/budget-app`)
      await expect(page.getByRole('heading', { level: 1, name: copy.budget })).toBeVisible()
      await page.getByRole('link', { name: copy.back }).click()
      await expect(worksPaging(page, lang)).toContainText('1 / 2')
      await expect(page.locator('#works').getByRole('link', { name: copy.budget })).toBeVisible()
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
    await gotoHydrated(page, '/ja/works/budget-app')
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
  test('同じ画面の英語版をページの一番上から開き、ページングは1ページ目に戻る。詳細から「戻る」で離れたときの位置に戻る', async ({
    page,
  }) => {
    await gotoHydrated(page, '/ja')
    // 1ページ目に戻ることを確かめるため、2ページ目にしてから切り替える
    await worksPaging(page, 'ja').getByRole('button', { name: '次のページ' }).click()
    await expect(worksPaging(page, 'ja')).toContainText('2 / 2')

    await page.getByRole('group', { name: '言語' }).getByRole('link', { name: 'EN' }).click()
    await expect(page).toHaveURL('/en')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(worksPaging(page, 'en')).toContainText('1 / 2')
    expect(await page.evaluate(() => window.scrollY)).toBe(0)

    await page.locator('#works').scrollIntoViewIfNeeded()
    const clickedScrollY = await scrollYAtNextClick(page)
    await page.locator('#works').getByRole('link', { name: 'Task Board' }).click()
    await expect(page).toHaveURL('/en/works/task-board')
    const scrollY = await clickedScrollY()
    expect(scrollY).toBeGreaterThan(0)
    await page.goBack()
    await expect(page).toHaveURL('/en')
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
})

test.describe('経歴の行', () => {
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('▸ を押すとその場で種類・場所・内容を広げ、もう一度押すと閉じる。複数の行を同時に開ける', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const career = page.locator('#career')
    const current = career.getByRole('button', { name: /株式会社サンプル ~ シニアエンジニア/ })
    const previous = career.getByRole('button', { name: /株式会社テスト/ })
    await expect(current).toHaveAttribute('aria-expanded', 'false')
    await current.click()
    await expect(current).toHaveAttribute('aria-expanded', 'true')
    const content = page.locator(`[id="${await current.getAttribute('aria-controls')}"]`)
    await expect(content).toContainText('職歴')
    await previous.click()
    await expect(current).toHaveAttribute('aria-expanded', 'true')
    await expect(previous).toHaveAttribute('aria-expanded', 'true')
    await current.click()
    await expect(current).toHaveAttribute('aria-expanded', 'false')
    await expect(content).toBeEmpty()
  })

  test('キーボードで広げられ、ページを切り替えると閉じる', async ({ page, local }) => {
    // 公開の経歴を11件にして、ページングを出す
    await local.db.insert(schema.career).values(
      Array.from({ length: 4 }, (_, index) => ({
        kind: 'work' as const,
        titleJa: `追加の経歴 ${index + 1}`,
        startDate: `2010-0${index + 1}`,
        status: 'published' as const,
      })),
    )
    await gotoHydrated(page, '/ja')
    const career = page.locator('#career')
    const row = career.getByRole('button', { name: /株式会社サンプル/ })
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    const paging = career.getByRole('group', { name: '経歴のページ' })
    await paging.getByRole('button', { name: '次のページ' }).click()
    await paging.getByRole('button', { name: '前のページ' }).click()
    await expect(career.getByRole('button', { name: /株式会社サンプル/ })).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('作品・プロジェクトの行を広げる', () => {
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('▸ で広げるとサムネイル・概要・使用技術が出て、▸ のほかの部分は行き先へ移る', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const works = page.locator('#works')
    const toggle = workToggle(page, /ポートフォリオと CMS/)
    const thumbnail = works.locator('img[alt="ポートフォリオと CMS"]')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(thumbnail).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(thumbnail).toBeVisible()
    // 使用技術は、行には3個と「+5」、広げた中には6個と「+2」（技術が8個の作品）
    await expect(works.getByText('+5')).toBeVisible()
    await expect(works.getByText('+2')).toBeVisible()
    // 広げても URL は変わらない
    await expect(page).toHaveURL('/ja')
    await toggle.click()
    await expect(thumbnail).toHaveCount(0)

    // タイトルの文字でなく概要の文字の位置を押しても、行の行き先（詳細ページ）へ移る（リンクの ::after が覆っている）
    const summary = await works.getByText(/日英2言語のポートフォリオ/).boundingBox()
    if (!summary) throw new Error('概要が見えない')
    await page.mouse.click(summary.x + summary.width / 2, summary.y + summary.height / 2)
    await expect(page).toHaveURL('/ja/works/portfolio-cms')
  })

  test('詳細ページを持つ行でも、GitHub のアイコンはその先を別タブで開く', async ({ page, context }) => {
    await context.route('https://github.com/**', (route) => route.fulfill({ body: 'github' }))
    await gotoHydrated(page, '/ja')
    const row = page.locator('#works').getByRole('article').filter({ hasText: 'ポートフォリオと CMS' })
    const [popup] = await Promise.all([page.waitForEvent('popup'), row.getByRole('link', { name: 'GitHub' }).click()])
    await popup.waitForURL('https://github.com/example/portfolio')
    await expect(page).toHaveURL('/ja')
  })

  test('作品の ▸ はキーボード（Space）で広げられる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const toggle = workToggle(page, /タスクボード/)
    await toggle.focus()
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#works img[alt="タスクボード"]')).toBeVisible()
  })

  test('プロジェクトは広げると期間も出す。広げるものが無い作品には ▸ を出さない', async ({ page, local }) => {
    await local.db.insert(schema.work).values({
      titleJa: '中身のない作品',
      slug: 'empty-work',
      sortOrder: -1,
      status: 'published',
    })
    await gotoHydrated(page, '/ja')
    const projects = page.locator('#projects')
    await projects.getByRole('button', { name: /決済基盤の刷新/ }).click()
    await expect(projects.getByText('2024年4月 – 現在')).toBeVisible()
    await expect(page.locator('#works').getByText('中身のない作品')).toBeVisible()
    await expect(workToggle(page, /中身のない作品/)).toHaveCount(0)
  })

  test('広げた行は、ページを切り替えても、詳細から戻っても、言語を切り替えても閉じる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const paging = worksPaging(page, 'ja')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await expect(paging).toContainText('2 / 2')
    const recipe = workToggle(page, /レシピノート/)
    await recipe.click()
    await expect(recipe).toHaveAttribute('aria-expanded', 'true')

    await page.locator('#works').getByRole('link', { name: 'レシピノート' }).click()
    await page.getByRole('link', { name: '作品へ戻る' }).click()
    await expect(paging).toContainText('2 / 2')
    await expect(recipe).toHaveAttribute('aria-expanded', 'false')
    await recipe.click()
    await page.goBack()
    await page.goBack()
    await expect(page).toHaveURL('/ja')
    await expect(paging).toContainText('2 / 2')
    await expect(recipe).toHaveAttribute('aria-expanded', 'false')

    await recipe.click()
    await expect(recipe).toHaveAttribute('aria-expanded', 'true')
    await paging.getByRole('button', { name: '前のページ' }).click()
    await paging.getByRole('button', { name: '次のページ' }).click()
    await expect(recipe).toHaveAttribute('aria-expanded', 'false')

    // 言語の切り替えは、ページングの無いセクション（経歴）で確かめる。ページングすると、それだけで閉じるため
    const career = page.locator('#career').getByRole('button').first()
    await career.click()
    await expect(career).toHaveAttribute('aria-expanded', 'true')
    await page.getByRole('group', { name: '言語' }).getByRole('link', { name: 'EN' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.locator('#career').getByRole('button').first()).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('件数とページング', () => {
  test('10件以下のセクションはページ表示を出さず、1ページは10件', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    await expect(page.locator('#career').getByRole('group', { name: '経歴のページ' })).toHaveCount(0)
    const projects = page.locator('#projects')
    await expect(projects.getByRole('group', { name: 'プロジェクトのページ' })).toHaveCount(0)
    await expect(page.locator('#works ul[data-position="current"] > li')).toHaveCount(10)
  })
})

test.describe('モバイル幅の行', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('作品の行は概要を出さず、ページの横にはみ出さない', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const row = page.locator('#works').getByRole('article').first()
    await expect(row.getByText('ポートフォリオと CMS')).toBeVisible()
    await expect(row.getByText(/日英2言語のポートフォリオ/)).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })
})

test.describe('トップの行', () => {
  test('行き先ごとの押し方・言語ラベル', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const works = page.locator('#works')
    // 詳細本文なしで外部リンクだけの作品は、外部リンクを別タブで開く
    await expect(works.getByRole('link', { name: /ランディングページ/ })).toHaveAttribute('target', '_blank')
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

  test('セクションごと消える', async ({ page, local }) => {
    await insertSeed(local.db, buildSeed({ empty: true }))
    await page.goto('/ja')
    await expect(page.locator('#works')).toBeVisible()
    await expect(page.locator('#blog')).toHaveCount(0)
    await expect(page.locator('#coding')).toHaveCount(0)
  })
})
