/**
 * A10 の表示の文言と数の書き方（design-spec 6.8）。管理画面の数は桁区切りを使う（SDD 9章）
 */
import type { Device } from '~/domain/analytics/bots'
import type { ExpandableSection, LinkKind, PagedSectionName, TopSection } from '~/domain/analytics/events'
import type { AnalyticsRange } from '~/domain/analytics/report'
import { SECTION_LABELS } from './labels'

const integer = new Intl.NumberFormat('ja-JP')

/** 件数（1,234） */
export function formatCount(value: number): string {
  return integer.format(value)
}

/** 前の期間との差（+12%・−5%）。前が0なら「—」 */
export function formatChange(rate: number | null): string {
  if (rate === null) return '—'
  const percent = Math.round(rate * 100)
  if (percent === 0) return '±0%'
  return percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`
}

/** 割合（72%）。null（分母が0）は「—」 */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`
}

export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7日',
  '30d': '30日',
  '90d': '90日',
  '1y': '1年',
  all: 'すべて',
}

/** P1 のセクションの名前（design-spec 1.4）。プロフィールはセクションの名前を持たないので、管理画面の名前 */
export const TOP_SECTION_LABELS: Record<TopSection, string> = { profile: 'Profile', ...SECTION_LABELS }

export const EXPANDABLE_LABELS: Record<ExpandableSection, string> = {
  career: SECTION_LABELS.career,
  projects: SECTION_LABELS.projects,
  works: SECTION_LABELS.works,
}

export const PAGED_LABELS: Record<PagedSectionName, string> = {
  career: SECTION_LABELS.career,
  projects: SECTION_LABELS.projects,
  works: SECTION_LABELS.works,
  blog: SECTION_LABELS.blog,
  coding: SECTION_LABELS.coding,
}

export const LINK_KIND_LABELS: Record<LinkKind, string> = {
  site: 'サイトを見る',
  github: 'GitHub',
  social: 'SNS',
  stack: '使用技術',
  reference: '参考リンク',
  body: '本文のリンク',
}

export const DEVICE_LABELS: Record<Device, string> = {
  mobile: 'モバイル',
  tablet: 'タブレット',
  desktop: 'デスクトップ',
}

/** 記録できなかった値（国の XX、ブラウザの言語の (unknown)） */
const UNKNOWN = '不明'

const regionNames = new Intl.DisplayNames(['ja'], { type: 'region' })
const languageNames = new Intl.DisplayNames(['ja'], { type: 'language' })

/** 国の名前。`XX` は「不明」。Intl が名前を持たないコード（Tor の T1 など）はコードのまま */
export function countryName(code: string): string {
  if (code === 'XX') return UNKNOWN
  try {
    return regionNames.of(code) ?? code
  } catch {
    return code
  }
}

/** ブラウザの言語の名前。`(unknown)` は「不明」。Intl が名前を持たないタグはタグのまま */
export function languageName(tag: string): string {
  if (tag === '(unknown)') return UNKNOWN
  try {
    return languageNames.of(tag) ?? tag
  } catch {
    return tag
  }
}

const DETAIL_KIND_LABELS: Record<string, string> = {
  works: SECTION_LABELS.works,
  projects: SECTION_LABELS.projects,
  blog: SECTION_LABELS.blog,
  coding: SECTION_LABELS.coding,
}

/**
 * ページの名前。タイトル（日本語、なければ英語）に種類の名前を頭に付ける（「Lab: マイアプリ」）。
 * タイトルが無い（P1・P6・C1、消した・スラッグを変えた中身）なら null で、画面はパスだけを出す
 */
export function pageName(path: string, title: { ja: string | null; en: string | null } | null): string | null {
  const name = title?.ja ?? title?.en ?? null
  if (name === null) return null
  const kind = DETAIL_KIND_LABELS[path.split('/')[2] ?? '']
  return kind === undefined ? name : `${kind}: ${name}`
}

/** UTM のキー（`source|medium|campaign`）を3つに分ける */
export function utmParts(key: string): [string, string, string] {
  const [source = '', medium = '', campaign = ''] = key.split('|')
  return [source, medium, campaign]
}
