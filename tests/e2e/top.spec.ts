/**
 * P1 トップと P2・P3 の詳細（design-spec 6.1・6.2）。コアフロー「何者かつかみ、作品で確かめる」（design-spec 2.2）の
 * トップ → 作品をページング → 作品詳細 → 戻るで元のページ、経歴・作品・プロジェクトの行の展開と広げた中の入口、
 * 言語の切り替え（ページの一番上から開き、ページングは1ページ目）、0件のセクションが消えること。
 * make e2e のデモデータ（make db-seed）を前提にする。作品は公開11件（1ページ10件）で、2ページ目に詳細ページを持つ
 * 「レシピノート」がある。経歴（公開7）・プロジェクト（公開6）は10件以下でページングが出ない。
 * 1ページ目の「ターミナルで天気予報を…」は、モバイル幅の閉じた行で「…」で切れる長さのタイトルにしてある
 */
import type { Locator, Page } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { buildSeed } from '../../scripts/seed/data'
import { insertSeed } from '../../scripts/seed/insert'
import * as schema from '../../src/db/schema'
import { expect, test } from './fixtures'
import { gotoHydrated } from './hydration'
import { expandRow, rowButton, rowContent } from './top-rows'

const COPY = {
  ja: {
    next: '次のページ',
    previous: '前のページ',
    paging: 'Lab のページ',
    recipe: 'レシピノート',
    budget: '家計簿アプリ',
    back: 'Lab へ戻る',
    viewDetails: '詳細を見る',
  },
  en: {
    next: 'Next page',
    previous: 'Previous page',
    paging: 'Lab pages',
    recipe: 'Recipe Notes',
    budget: 'Budget App',
    back: 'Back to Lab',
    viewDetails: 'View details',
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

/** 作品の行を広げ、広げた中の「詳細を見る」で作品詳細へ移る */
async function openWorkDetail(page: Page, lang: keyof typeof COPY, name: string): Promise<void> {
  const content = await expandRow(page, 'works', name)
  await content.getByRole('link', { name: COPY[lang].viewDetails }).click()
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

      await openWorkDetail(page, lang, copy.recipe)
      await expect(page).toHaveURL(`/${lang}/works/recipe-notes`)
      await expect(page.getByRole('heading', { level: 1, name: copy.recipe })).toBeVisible()

      await page.getByRole('link', { name: copy.back }).click()
      await expect(page).toHaveURL(`/${lang}#works`)
      await expect(paging).toContainText('2 / 2')
      await expect(rowButton(page, 'works', copy.recipe)).toBeVisible()
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
      await expect(rowButton(page, 'works', copy.budget)).toBeVisible()
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
    const content = await expandRow(page, 'works', 'レシピノート')
    const clickedScrollY = await scrollYAtNextClick(page)
    await content.getByRole('link', { name: '詳細を見る' }).click()
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
    await page.getByRole('link', { name: 'Lab へ戻る' }).click()
    const paging = worksPaging(page, 'ja')
    await expect(paging).toContainText('1 / 2')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await openWorkDetail(page, 'ja', 'レシピノート')
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
    const content = await expandRow(page, 'works', 'Task Board')
    const clickedScrollY = await scrollYAtNextClick(page)
    await content.getByRole('link', { name: 'View details' }).click()
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

/** 行の名前が「…」で切れているか。名前（ボタンの読み上げ名の要素）が、その親の幅からはみ出しているかで見る */
async function nameTruncated(button: Locator): Promise<boolean> {
  return button.evaluate((element) => {
    const name = document.getElementById(element.getAttribute('aria-labelledby') ?? '')
    const box = name?.parentElement
    if (!box) throw new Error('行の名前が無い')
    return box.scrollWidth > box.clientWidth
  })
}

test.describe('経歴の行', () => {
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('名前の部分を押すとその場で種類・場所・内容を広げ、もう一度押すと閉じる。複数の行を同時に開ける', async ({
    page,
  }) => {
    await gotoHydrated(page, '/ja')
    const career = page.locator('#career')
    const current = rowButton(page, 'career', /株式会社サンプル ~ シニアエンジニア/)
    const previous = rowButton(page, 'career', /株式会社テスト/)
    await expect(current).toHaveAttribute('aria-expanded', 'false')
    await career.getByText('株式会社サンプル', { exact: true }).click()
    await expect(current).toHaveAttribute('aria-expanded', 'true')
    await expect(page).toHaveURL('/ja')
    const content = await rowContent(page, current)
    await expect(content).toContainText('職歴')
    await previous.click()
    await expect(current).toHaveAttribute('aria-expanded', 'true')
    await expect(previous).toHaveAttribute('aria-expanded', 'true')
    // 右の期間を押しても閉じる（行全体が1つのボタン）
    await current.getByText('2024年4月 – 現在').click()
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
    const row = rowButton(page, 'career', /株式会社サンプル/)
    await row.focus()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')

    const paging = career.getByRole('group', { name: 'Career のページ' })
    await paging.getByRole('button', { name: '次のページ' }).click()
    await paging.getByRole('button', { name: '前のページ' }).click()
    await expect(rowButton(page, 'career', /株式会社サンプル/)).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('作品・プロジェクトの行を広げる', () => {
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('閉じた行はタイトルと使用技術だけで、行の中にリンクが無い', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    for (const id of ['works', 'projects']) {
      const rows = page.locator(`#${id} ul:not([inert])`)
      await expect(rows.getByRole('link')).toHaveCount(0)
    }
    // 概要は閉じた行に出さない（デスクトップ幅でも）
    await expect(page.locator('#works').getByText(/日英2言語のポートフォリオ/)).toHaveCount(0)
    await expect(page.locator('#projects').getByText(/決済まわりを新しい基盤/)).toHaveCount(0)
    // 使用技術は最大3個と「+N」（技術が8個の作品）
    await expect(rowButton(page, 'works', 'ポートフォリオと CMS').getByText('+5')).toBeVisible()
  })

  test('行のどこを押しても広げ・閉じ、広げると右の使用技術を隠して、概要の全文と全部の使用技術が出る', async ({
    page,
  }) => {
    await gotoHydrated(page, '/ja')
    const works = page.locator('#works')
    const row = rowButton(page, 'works', 'ポートフォリオと CMS')
    await works.getByText('ポートフォリオと CMS', { exact: true }).click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page).toHaveURL('/ja')
    const content = await rowContent(page, row)
    await expect(content.getByRole('img', { name: 'ポートフォリオと CMS' })).toBeVisible()
    await expect(content.getByText('日英2言語のポートフォリオと、自作の管理画面。')).toBeVisible()
    await expect(row.getByText('+5')).toHaveCount(0)
    await expect(row.locator('img')).toHaveCount(0)
    // 広げた中の使用技術は上限なしで全部（8個）。「+N」は無い
    await expect(content.getByRole('list', { name: 'Tech Stack' }).getByRole('listitem')).toHaveCount(8)
    await expect(content.getByText(/^\+\d+$/)).toHaveCount(0)
    // 概要や使用技術を押しても何も起きない
    await content.getByText('日英2言語のポートフォリオと、自作の管理画面。').click()
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page).toHaveURL('/ja')

    // 行の右端の余白を押しても閉じる
    const box = await row.boundingBox()
    if (!box) throw new Error('行が見えない')
    await page.mouse.click(box.x + box.width - 4, box.y + box.height / 2)
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await expect(content).toBeEmpty()
  })

  test('広げた中の入口: 「詳細を見る」は詳細ページへ、「サイトを見る」「GitHub」は別タブで開く', async ({
    page,
    context,
  }) => {
    await context.route('https://example.com/**', (route) => route.fulfill({ body: 'example' }))
    await context.route('https://github.com/**', (route) => route.fulfill({ body: 'github' }))
    await gotoHydrated(page, '/ja')

    // 詳細本文の無い作品は、外部リンク・GitHub の入口だけ
    const landing = await expandRow(page, 'works', 'ランディングページ')
    await expect(landing.getByRole('link', { name: '詳細を見る' })).toHaveCount(0)
    const [site] = await Promise.all([
      page.waitForEvent('popup'),
      landing.getByRole('link', { name: /^サイトを見る/ }).click(),
    ])
    await site.waitForURL('https://example.com/landing')
    await site.close()
    const dotfiles = await expandRow(page, 'works', 'dotfiles')
    const [github] = await Promise.all([
      page.waitForEvent('popup'),
      dotfiles.getByRole('link', { name: /^GitHub/ }).click(),
    ])
    await github.waitForURL('https://github.com/example/dotfiles')
    await github.close()
    await expect(page).toHaveURL('/ja')

    // 詳細本文のある作品は、詳細を見る・サイトを見る・GitHub をこの順に並べる
    const portfolio = await expandRow(page, 'works', 'ポートフォリオと CMS')
    await expect(portfolio.getByRole('link')).toHaveText([
      '詳細を見る',
      'サイトを見る別タブで開く',
      'GitHub別タブで開く',
    ])
    await portfolio.getByRole('link', { name: '詳細を見る' }).click()
    await expect(page).toHaveURL('/ja/works/portfolio-cms')
  })

  test('行のボタンはキーボード（Enter・Space）で広げ・閉じ、広げた中のリンクへ Tab で移れる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const row = rowButton(page, 'works', 'タスクボード')
    await row.focus()
    await page.keyboard.press('Space')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('#works img[alt="タスクボード"]')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'false')
    await page.keyboard.press('Enter')
    await expect(row).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('Tab')
    await expect(page.locator('#works').getByRole('link', { name: '詳細を見る' })).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(page.locator('#works').getByRole('link', { name: /GitHub/ })).toBeFocused()
  })

  test('プロジェクトは広げると期間も出す。広げるものが無い作品には ▸ を出さず、押せない', async ({ page, local }) => {
    await local.db.insert(schema.work).values({
      titleJa: '中身のない作品',
      slug: 'empty-work',
      sortOrder: -1,
      status: 'published',
    })
    await gotoHydrated(page, '/ja')
    const project = await expandRow(page, 'projects', '決済基盤の刷新')
    await expect(project.getByText('2024年4月 – 現在')).toBeVisible()
    const empty = page.locator('#works').getByRole('article').filter({ hasText: '中身のない作品' })
    await expect(empty).toBeVisible()
    await expect(empty.getByRole('button')).toHaveCount(0)
    await expect(empty.getByRole('link')).toHaveCount(0)
  })

  test('広げた行は、ページを切り替えても、詳細から戻っても、言語を切り替えても閉じる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const paging = worksPaging(page, 'ja')
    await paging.getByRole('button', { name: '次のページ' }).click()
    await expect(paging).toContainText('2 / 2')
    const recipe = rowButton(page, 'works', 'レシピノート')

    await openWorkDetail(page, 'ja', 'レシピノート')
    await page.getByRole('link', { name: 'Lab へ戻る' }).click()
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
    await expect(page.locator('#career').getByRole('group', { name: 'Career のページ' })).toHaveCount(0)
    const projects = page.locator('#projects')
    await expect(projects.getByRole('group', { name: 'Projects のページ' })).toHaveCount(0)
    await expect(page.locator('#works ul[data-position="current"] > li')).toHaveCount(10)
  })
})

test.describe('モバイル幅の行', () => {
  test.use({ viewport: { width: 375, height: 740 } })

  test('長い名前は閉じた行で「…」で切り、広げると折り返して全文を出す。ページの横にはみ出さない', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const work = rowButton(page, 'works', /ターミナルで天気予報/)
    expect(await nameTruncated(work)).toBe(true)
    await work.click()
    await expect(work).toHaveAttribute('aria-expanded', 'true')
    expect(await nameTruncated(work)).toBe(false)
    await expect(work.getByText('ターミナルで天気予報をすばやく確かめるコマンドラインツール')).toBeVisible()

    const career = rowButton(page, 'career', /Example Labs/)
    expect(await nameTruncated(career)).toBe(true)
    await career.click()
    await expect(career).toHaveAttribute('aria-expanded', 'true')
    expect(await nameTruncated(career)).toBe(false)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  })

  test('経歴の2行目と、広げた中の左端は ▸ の左端に揃う', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const left = async (locator: Locator) => {
      const box = await locator.boundingBox()
      if (!box) throw new Error('見えない')
      return Math.round(box.x)
    }
    const career = rowButton(page, 'career', /株式会社サンプル/)
    const careerContent = await expandRow(page, 'career', /株式会社サンプル/)
    const chevron = await left(career.locator('svg'))
    expect(await left(career.getByText('2024年4月 – 現在'))).toBe(chevron)
    expect(await left(careerContent.getByText('職歴'))).toBe(chevron)

    const work = rowButton(page, 'works', 'ポートフォリオと CMS')
    const workContent = await expandRow(page, 'works', 'ポートフォリオと CMS')
    expect(await left(workContent.getByRole('img', { name: 'ポートフォリオと CMS' }))).toBe(
      await left(work.locator('svg')),
    )
  })

  test('広げた作品の名前の続きは ▸ の左端から始まる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const work = rowButton(page, 'works', /ターミナルで天気予報/)
    await work.click()
    await expect(work).toHaveAttribute('aria-expanded', 'true')
    const { lines, nameLeft } = await work.evaluate((element) => {
      const name = document.getElementById(element.getAttribute('aria-labelledby') ?? '')
      if (!name) throw new Error('行の名前が無い')
      const rects = [...name.getClientRects()]
      return {
        lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
        nameLeft: name.getBoundingClientRect().x,
      }
    })
    const chevron = await work.locator('svg').boundingBox()
    if (!chevron) throw new Error('見えない')
    expect(lines).toBeGreaterThan(1)
    expect(Math.round(nameLeft)).toBe(Math.round(chevron.x))
  })
})

test.describe('狭いモバイル幅の行', () => {
  // 所属とタイトルは1行に収まらず、それぞれなら収まる幅
  test.use({ viewport: { width: 320, height: 740 } })
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  test('広げた経歴は「所属 ~」と「タイトル」の境で折り返し、名前の続きは ▸ の左端から始まる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    const career = rowButton(page, 'career', /Example Labs/)
    const organization = career.getByText('Example Labs', { exact: true })
    const title = career.getByText('Software Engineer Intern', { exact: true })
    const organizationBefore = await organization.boundingBox()
    await career.click()
    await expect(career).toHaveAttribute('aria-expanded', 'true')
    const [chevron, organizationAfter, titleBox] = await Promise.all(
      [career.locator('svg'), organization, title].map((locator) => locator.boundingBox()),
    )
    if (!organizationBefore || !chevron || !organizationAfter || !titleBox) throw new Error('見えない')
    // 1行目の名前は広げても横に動かない
    expect(Math.round(organizationAfter.x)).toBe(Math.round(organizationBefore.x))
    // タイトルは丸ごと次の行から、▸ の左端で始まる
    expect(titleBox.y).toBeGreaterThanOrEqual(organizationAfter.y + organizationAfter.height)
    expect(Math.round(titleBox.x)).toBe(Math.round(chevron.x))
    await expect(career).toHaveAccessibleName('Example Labs ~ Software Engineer Intern')
  })

  test('広げた経歴の所属は、1行目の残りに収まらなくても ▸ と同じ1行目から始まる', async ({ page, local }) => {
    // 幅に頼らず、どの画面幅でも1行に収まらない長い所属を入れる
    const organization = Array.from({ length: 6 }, () => 'Long Organization Name').join(' ')
    await local.db.insert(schema.career).values({
      kind: 'work',
      titleEn: 'Engineer',
      organizationEn: organization,
      startDate: '2026-01',
      status: 'published',
    })
    await gotoHydrated(page, '/en')
    const career = rowButton(page, 'career', /Long Organization Name/)
    await career.click()
    await expect(career).toHaveAttribute('aria-expanded', 'true')
    const firstTop = await career
      .getByText(organization, { exact: true })
      .evaluate((element) => element.getClientRects()[0]?.top ?? Number.NaN)
    const chevron = await career.locator('svg').boundingBox()
    if (!chevron) throw new Error('見えない')
    expect(firstTop).toBeLessThan(chevron.y + chevron.height)
  })
})

test.describe('トップの行', () => {
  test('外部へ移る入口・言語ラベル', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    // 詳細本文なしで外部リンクだけの作品は、広げた中の外部リンクを別タブで開く
    const landing = await expandRow(page, 'works', 'ランディングページ')
    await expect(landing.getByRole('link', { name: /サイトを見る/ })).toHaveAttribute('target', '_blank')
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
    await expect(page.getByRole('note')).toHaveText('This description is available in Japanese only.')
    await expect(page.locator('main [lang="ja"]').first()).toContainText('家族のレシピ')
  })
})

test.describe('一言（design-spec 6.1.4・6.1.5）', () => {
  const [seedProfile] = buildSeed({ empty: false }).profile

  /** ヘッダーの下端から要素の上端までの距離 */
  async function gapBelowHeader(page: Page, target: Locator): Promise<number> {
    const header = await page.getByRole('banner').boundingBox()
    const box = await target.boundingBox()
    if (!header || !box) throw new Error('ヘッダーか対象の要素が見えない')
    return box.y - (header.y + header.height)
  }

  // ほかのテストのため、終わったら全件のシードに戻す
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  for (const [lang, value] of [
    ['ja', seedProfile?.taglineJa],
    ['en', seedProfile?.taglineEn],
  ] as const) {
    test(`${lang}: プロフィールの上に一言を出し、ページの見出しは名前のまま`, async ({ page }) => {
      if (!value) throw new Error('デモデータに一言が無い')
      await page.goto(`/${lang}`)
      const profile = page.locator('#profile')
      const tagline = profile.getByText(value, { exact: true })
      await expect(tagline).toBeVisible()
      await expect(tagline).not.toHaveAttribute('lang')
      const taglineBox = await tagline.boundingBox()
      const nameBox = await page.getByRole('heading', { level: 1 }).boundingBox()
      if (!taglineBox || !nameBox) throw new Error('一言か名前が見えない')
      expect(taglineBox.y + taglineBox.height).toBeLessThanOrEqual(nameBox.y)
    })
  }

  test('表示中の言語で空なら、もう片方の言語の一言を lang 付きで出す', async ({ page, local }) => {
    await local.db.update(schema.profile).set({ taglineJa: null })
    await page.goto('/ja')
    await expect(page.locator('#profile').getByText(seedProfile?.taglineEn ?? '', { exact: true })).toHaveAttribute(
      'lang',
      'en',
    )
  })

  test('ヘッダーから最初の中身までは、一言・プロフィールの有無に関わらず同じ狭い余白', async ({ page, local }) => {
    await page.goto('/ja')
    const withTagline = await gapBelowHeader(page, page.locator('#profile'))
    const profileBox = await page.locator('#profile').boundingBox()
    const careerBox = await page.locator('#career').boundingBox()
    if (!profileBox || !careerBox) throw new Error('セクションが見えない')
    // 余白の値はトークンが持つので、今のセクションどうしの間（section）より狭いことで stack になったと見る
    expect(withTagline).toBeLessThan(careerBox.y - (profileBox.y + profileBox.height))

    await local.db.update(schema.profile).set({ taglineJa: null, taglineEn: null })
    await page.goto('/ja')
    await expect(page.locator('#profile').getByText(seedProfile?.taglineJa ?? '', { exact: true })).toHaveCount(0)
    await expect(page.locator('#profile > p')).toHaveCount(0)
    expect(Math.abs((await gapBelowHeader(page, page.locator('#profile'))) - withTagline)).toBeLessThanOrEqual(1)

    await local.db.delete(schema.socialLink)
    await local.db.delete(schema.profile)
    await page.goto('/ja')
    await expect(page.locator('#profile')).toHaveCount(0)
    // 見出しは画面に出さない（srOnly）ので、-1px の margin の分を許す
    const heading = page.getByRole('heading', { level: 1, name: 'eastasian' })
    expect(Math.abs((await gapBelowHeader(page, heading)) - withTagline)).toBeLessThanOrEqual(2)
  })

  test.describe('モバイル幅', () => {
    test.use({ viewport: { width: 360, height: 740 } })

    test('200字の一言でも折り返して、ページの横にはみ出さず、ヘッダーは1行', async ({ page, local }) => {
      // 長い英単語も折り返すかを見るため、区切りの無い英字を混ぜる
      const long = `${'日英で届ける'.repeat(25)}${'a'.repeat(50)}`
      expect(long).toHaveLength(200)
      await local.db.update(schema.profile).set({ taglineJa: long })
      await page.goto('/ja')
      await expect(page.locator('#profile').getByText(long, { exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      const header = page.getByRole('banner')
      const domain = await header.getByRole('link', { name: 'x.eastasian.dev', exact: true }).boundingBox()
      const theme = await header.getByRole('button', { name: /^テーマ/ }).boundingBox()
      if (!domain || !theme) throw new Error('ヘッダーの部品が見えない')
      expect(Math.abs(domain.y + domain.height / 2 - (theme.y + theme.height / 2))).toBeLessThanOrEqual(2)
    })
  })
})

test.describe('Tech Stack の群（design-spec 6.1.4）', () => {
  // ほかのテストのため、終わったら全件のシードに戻す
  test.afterEach(async ({ local }) => {
    await insertSeed(local.db, buildSeed({ empty: false }))
  })

  const GROUPS = ['Core', 'Languages', 'Frameworks', 'Infrastructure', 'Tools']
  const group = (page: Page, name: string) => page.locator('#stack').getByRole('list', { name, exact: true })

  for (const lang of ['ja', 'en'] as const) {
    test(`${lang}: Core → Languages → Frameworks → Infrastructure → Tools の見出しを英語で出し、Core の技術は Core の群にだけ出す`, async ({
      page,
    }) => {
      await gotoHydrated(page, `/${lang}`)
      const headings = page.locator('#stack').getByRole('heading', { level: 3 })
      await expect(headings).toHaveText(GROUPS)
      for (const heading of await headings.all()) await expect(heading).toHaveAttribute('lang', 'en')
      await expect(group(page, 'Core').getByText('TypeScript', { exact: true })).toBeVisible()
      await expect(group(page, 'Languages').getByText('TypeScript', { exact: true })).toHaveCount(0)
      await expect(group(page, 'Languages').getByText('Python', { exact: true })).toBeVisible()
      // トップに出さない技術はどの群にも無い
      for (const name of ['jQuery', 'Perl']) {
        await expect(page.locator('#stack').getByText(name, { exact: true })).toHaveCount(0)
      }
    })
  }

  // グレースケールとトーンカーブの SVG フィルター。ダークではさらに白黒反転する（design-spec 4.4）
  const TONE = 'url("#stack-icon-tone")'
  const TONE_DARK = `${TONE} invert(1)`
  // チップは inline-flex で子がブロックになり、読み上げ名の計算でブロックの境目に空白が入る
  const REACT_LINK = /^React\s*別タブで開く$/

  test('使用技術の並びのアイコンは枠を付けずにグレースケールとトーンカーブで、切らずに収める。アイコンの無い技術は頭文字の丸', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await gotoHydrated(page, '/ja')
    await expect(page.locator('filter#stack-icon-tone')).toHaveCount(1)
    const icons = [page.locator('#stack img').first(), page.locator('#works ul:not([inert]) img').first()]
    for (const icon of icons) {
      await expect(icon).toHaveCSS('filter', TONE)
      await expect(icon).toHaveCSS('object-fit', 'contain')
    }
    // 自己紹介の太字の前のアイコンは元の色
    await expect(page.locator('img[data-stack-icon]').first()).toHaveCSS('filter', 'none')
    // Git はアイコンが無いので頭文字の丸
    const git = group(page, 'Tools').getByRole('listitem').filter({ hasText: 'Git' })
    await expect(git.locator('span[aria-hidden="true"]').first()).toHaveText('G')
    await expect(group(page, 'Tools').locator('img')).toHaveCount(0)

    await gotoHydrated(page, '/ja/works/portfolio-cms')
    await expect(page.locator('filter#stack-icon-tone')).toHaveCount(1)
    await expect(page.locator('main').getByRole('list', { name: 'Tech Stack' }).locator('img').first()).toHaveCSS(
      'filter',
      TONE,
    )
  })

  test('ダークモードでは、使用技術の並びのアイコンを白黒反転する。自己紹介の太字の前のアイコンは元の色のまま', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await gotoHydrated(page, '/ja')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    for (const icon of [page.locator('#stack img').first(), page.locator('#works ul:not([inert]) img').first()]) {
      await expect(icon).toHaveCSS('filter', TONE_DARK)
    }
    await expect(page.locator('img[data-stack-icon]').first()).toHaveCSS('filter', 'none')

    await gotoHydrated(page, '/ja/works/portfolio-cms')
    await expect(page.locator('main').getByRole('list', { name: 'Tech Stack' }).locator('img').first()).toHaveCSS(
      'filter',
      TONE_DARK,
    )
  })

  test('P1 の Tech Stack のリンクのチップは ↗ を見せず、読み上げにだけ「別タブで開く」を足す。P2 のチップは ↗ を見せる', async ({
    page,
  }) => {
    await gotoHydrated(page, '/ja')
    const react = group(page, 'Core').getByRole('link', { name: REACT_LINK })
    await expect(react).toHaveAttribute('target', '_blank')
    await expect(react.locator('svg')).toHaveCount(0)

    await gotoHydrated(page, '/ja/works/portfolio-cms')
    const detailReact = page
      .locator('main')
      .getByRole('list', { name: 'Tech Stack' })
      .getByRole('link', { name: REACT_LINK })
    await expect(detailReact.locator('svg')).toBeVisible()
  })

  test('読み込めないアイコンは、SSR の後でも頭文字の丸に替える', async ({ page, local }) => {
    await local.db
      .update(schema.stack)
      .set({ iconUrl: '/media/uploads/missing/go.svg' })
      .where(eq(schema.stack.key, 'go'))
    await gotoHydrated(page, '/ja')
    const go = group(page, 'Languages').getByRole('listitem').filter({ hasText: 'Go' })
    await expect(go.locator('span[aria-hidden="true"]').first()).toHaveText('G')
    await expect(go.locator('img')).toHaveCount(0)
  })

  test('技術の無い群は見出しごと出さない', async ({ page, local }) => {
    await local.db.update(schema.stack).set({ showOnTop: false }).where(eq(schema.stack.category, 'tools'))
    await gotoHydrated(page, '/ja')
    await expect(page.locator('#stack').getByRole('heading', { level: 3 })).toHaveText(GROUPS.slice(0, 4))
    await expect(page.locator('#stack').getByText('Tools', { exact: true })).toHaveCount(0)
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

test.describe('セクションの名前（design-spec 1.4）', () => {
  test('/ja でもセクションの見出しは英語で、英語の発音で読ませる', async ({ page }) => {
    await gotoHydrated(page, '/ja')
    for (const name of ['Career', 'Projects', 'Lab', 'Tech Stack', 'Blog', 'Coding Log']) {
      const heading = page.getByRole('heading', { level: 2, name, exact: true })
      await expect(heading).toBeVisible()
      await expect(heading).toHaveAttribute('lang', 'en')
    }
  })

  test('/ja の作品の詳細ページは、戻るリンクがセクションの名前で、前後のリンクは「前へ」「次へ」', async ({ page }) => {
    await gotoHydrated(page, '/ja/works/portfolio-cms')
    const back = page.getByRole('link', { name: 'Lab へ戻る' })
    // 見える文字はセクションの名前だけで、英語の発音で読ませる（「へ戻る」は読み上げだけ）
    await expect(back.locator('[lang=en]')).toHaveText('Lab')
    await expect(back).toHaveAccessibleName('Lab へ戻る')
    const neighbors = page.getByRole('navigation', { name: '前後のページ' })
    await expect(neighbors.getByText(/^(前へ|次へ)$/).first()).toBeVisible()
    await expect(neighbors).not.toContainText('作品')
    // ページングのまとまりの名前も、見出し（英語）と続く語で作る
    await gotoHydrated(page, '/ja')
    await expect(page.locator('#works').getByRole('group', { name: 'Lab のページ' })).toBeVisible()
  })
})
