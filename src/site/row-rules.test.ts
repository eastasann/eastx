import { describe, expect, it } from 'vitest'
import type { CareerItem, ProjectItem, WorkItem } from '~/content/types'
import { isExpandable } from './row-rules'

const availability = { lang: 'ja', fallback: false } as const
const title = { value: 'タイトル', lang: 'ja' } as const

/** 広げた中に出すものを何も持たない作品 */
const bareWork: WorkItem = {
  id: 'w1',
  slug: 'bare',
  title,
  summary: null,
  thumbnailUrl: null,
  linkUrl: null,
  githubUrl: null,
  hasDetail: false,
  stacks: [],
  availability,
}

describe('isExpandable', () => {
  it('経歴は中身が最小でも広げられる（種類ラベルをいつも持つ）', () => {
    const career: CareerItem = {
      id: 'c1',
      kind: 'work',
      period: { start: '2024-04', end: null },
      title,
      organization: null,
      location: null,
      body: null,
      availability,
    }
    expect(isExpandable({ section: 'careers', item: career })).toBe(true)
  })

  it('プロジェクトは中身が最小でも広げられる（期間をいつも持つ）', () => {
    const project: ProjectItem = {
      id: 'p1',
      slug: 'bare',
      title,
      summary: null,
      period: { start: '2024-04', end: '2024-12' },
      thumbnailUrl: null,
      linkUrl: null,
      hasDetail: false,
      stacks: [],
      availability,
    }
    expect(isExpandable({ section: 'projects', item: project })).toBe(true)
  })

  it('作品は、広げた中に出すものも行き先も無ければ広げられない', () => {
    expect(isExpandable({ section: 'works', item: bareWork })).toBe(false)
  })

  it.each<[string, Partial<WorkItem>]>([
    ['サムネイル', { thumbnailUrl: '/media/thumb.png' }],
    ['概要', { summary: { value: '概要', lang: 'ja' } }],
    ['使用技術', { stacks: [{ key: 'react', displayName: 'React', iconUrl: null, linkUrl: null }] }],
    ['詳細本文', { hasDetail: true }],
    ['外部リンク', { linkUrl: 'https://example.com' }],
    ['GitHub', { githubUrl: 'https://github.com/example/repo' }],
  ])('作品は%sだけを持つときも広げられる', (_, fields) => {
    expect(isExpandable({ section: 'works', item: { ...bareWork, ...fields } })).toBe(true)
  })
})
