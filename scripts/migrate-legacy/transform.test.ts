import { describe, expect, it } from 'vitest'
import { fakeMediaPath, LONG_EN, legacyFixture, stackOf } from './fixture'
import { extractResume, legacyCounts } from './legacy'
import { clean, imageSources, toYearMonth, transform } from './transform'

const data = () => transform(legacyFixture(), fakeMediaPath)

describe('extractResume', () => {
  it('__NEXT_DATA__ の resume を取り出す', () => {
    const json = JSON.stringify({ props: { pageProps: { resume: legacyFixture() } } })
    const html = `<html><script id="__NEXT_DATA__" type="application/json">${json}</script></html>`
    expect(extractResume(html).name).toBe('Jun Aida')
  })

  it('__NEXT_DATA__ が無い・形が違うときは止める', () => {
    expect(() => extractResume('<html></html>')).toThrow('__NEXT_DATA__')
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>'
    expect(() => extractResume(html)).toThrow()
  })
})

describe('値の整え方', () => {
  it('clean: 前後の空白を取り、空なら null', () => {
    expect(clean('  a\n')).toBe('a')
    expect(clean('')).toBeNull()
    expect(clean(' ')).toBeNull()
    expect(clean(null)).toBeNull()
  })

  it('toYearMonth: 日本時間の年月にする', () => {
    expect(toYearMonth('2019-04-01T00:00:00.000Z')).toBe('2019-04')
    expect(toYearMonth('2024-09-30T15:00:00.000Z')).toBe('2024-10')
    expect(toYearMonth(null)).toBeNull()
  })
})

describe('transform', () => {
  it('プロフィール: 名前・自己紹介を日英に分け、写真を置き直し先のパスにする。肩書き・一言は空', () => {
    const [p] = data().profile
    expect(p).toMatchObject({
      nameJa: '會田 純',
      nameEn: 'Jun Aida',
      bioEn: 'Web developer from Tokyo.',
      headlineJa: null,
      headlineEn: null,
      taglineJa: null,
      taglineEn: null,
      avatarUrl: '/media/uploads/legacy/profile.jpg',
    })
  })

  it('SNS: 空のものは作らず、今のカラムの順に並べる', () => {
    expect(data().socialLinks.map((l) => [l.service, l.sortOrder])).toEqual([
      ['linkedin', 0],
      ['github', 1],
    ])
  })

  it('経歴: 職歴と学歴を kind で分け、所属・場所は日英に同じ値を入れ、下書きで入れる', () => {
    const [job, school] = data().careers
    expect(job).toMatchObject({ kind: 'work', organizationJa: 'Sun*', organizationEn: 'Sun*', endDate: null })
    expect(job?.bodyJa).toBeNull()
    expect(school).toMatchObject({
      kind: 'education',
      titleJa: '工学士',
      titleEn: 'Bachelor in Engineering',
      locationJa: null,
      startDate: '2015-04',
      endDate: '2019-03',
      status: 'draft',
    })
  })

  it('作品: 今の説明を概要に入れ、英語のタイトルからスラッグを作り、使用技術を今の順で紐づける', () => {
    const d = data()
    expect(d.works[0]).toMatchObject({
      slug: 'eastasian-vercel-app',
      summaryEn: 'this self introduction page.',
      summaryJa: 'この自己紹介ページ。',
      bodyEn: null,
      linkUrl: 'https://eastasian.vercel.app/',
      githubUrl: null,
      status: 'draft',
    })
    const key = (id: string) => d.stacks.find((s) => s.id === id)?.key
    expect(d.workStacks.map((ws) => [key(ws.stackId), ws.sortOrder])).toEqual([
      ['mantine', 0],
      ['typescript', 1],
      ['node', 2],
    ])
  })

  it('プロジェクト: 概要の上限を超える説明は日英とも詳細本文に入れる。同じスラッグには連番を付ける', () => {
    const [short, long] = data().projects
    expect(short).toMatchObject({ slug: 'online-exhibition-service', summaryEn: 'Joined as a front-end developer.' })
    expect(long).toMatchObject({
      slug: 'online-exhibition-service-2',
      summaryEn: null,
      summaryJa: null,
      bodyEn: LONG_EN,
      bodyJa: '短い説明。',
      startDate: '2024-12',
      endDate: null,
    })
  })

  it('使用技術: 仕事・個人開発の欄と、中身にだけ紐づく技術を重複なく集め、識別名の形式に直す', () => {
    const stacks = data().stacks
    expect(stacks.map((s) => s.key)).toEqual(['typescript', 'node', 'atomic-design', 'sap', 'mantine', 'bazel'])
    expect(stacks.map((s) => s.sortOrder)).toEqual([0, 1, 2, 3, 4, 5])
    expect(stacks.find((s) => s.key === 'sap')?.iconUrl).toBeNull()
    expect(stacks.filter((s) => !s.showOnTop).map((s) => s.key)).toEqual(['bazel'])
    expect(stacks.find((s) => s.key === 'node')).toMatchObject({
      displayName: 'Node.js',
      linkUrl: 'https://nodejs.org/en/',
      iconUrl: '/media/uploads/legacy/node.svg',
      showOnTop: true,
    })
  })

  it('識別名が同じになる技術には連番を付ける', () => {
    const resume = legacyFixture()
    resume.stacks.production.push(stackOf(99, 'TypeScript'))
    expect(transform(resume, fakeMediaPath).stacks.map((s) => s.key)).toContain('typescript-2')
  })

  it('https:// で始まらない URL は止める', () => {
    const resume = legacyFixture()
    resume.works = resume.works.map((w) => ({ ...w, link: 'http://example.com' }))
    expect(() => transform(resume, fakeMediaPath)).toThrow('https://')
  })

  it('URL として読めない値は止める', () => {
    const resume = legacyFixture()
    resume.works = resume.works.map((w) => ({ ...w, github: 'https://exa mple.com' }))
    expect(() => transform(resume, fakeMediaPath)).toThrow('https://')
  })

  it('1つの中身に同じ技術が2回あれば止める', () => {
    const resume = legacyFixture()
    resume.projects = resume.projects.map((p) => ({ ...p, stacks: [...p.stacks, ...p.stacks] }))
    expect(() => transform(resume, fakeMediaPath)).toThrow('2回')
  })

  it('管理画面で保存できない長さの値は止める', () => {
    const resume = legacyFixture()
    resume.experiences = resume.experiences.map((c) => ({ ...c, title: 'x'.repeat(201) }))
    expect(() => transform(resume, fakeMediaPath)).toThrow('201字')
  })
})

describe('imageSources・legacyCounts', () => {
  it('画像は写真と技術のアイコンを重複なく集め、空のものは落とす', () => {
    expect(imageSources(legacyFixture()).map((u) => u.split('/').pop())).toEqual([
      'profile.jpg',
      'typescript.svg',
      'node.svg',
      'atomic-design.svg',
      'mantine.svg',
    ])
  })

  it('件数は今のデータから数える', () => {
    expect(legacyCounts(legacyFixture())).toEqual({
      profile: 1,
      social_link: 2,
      career: 2,
      stack: 6,
      work: 1,
      work_stack: 3,
      project: 2,
      project_stack: 4,
    })
  })
})
