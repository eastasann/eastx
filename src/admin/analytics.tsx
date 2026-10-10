/**
 * A10 アクセス解析（design-spec 6.8、SDD 5.13）。期間を選び、閲覧・訪問者・外部へ、推移、ページ・流入元・行動・属性を見る。
 * 管理画面の原則（一覧性）に合わせ、カードの枠を使わず区切り線と見出しで分ける
 */
import { useQuery } from '@tanstack/react-query'
import { useRouter } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { css, cx } from 'styled-system/css'
import type { z } from 'zod'
import type { analyticsOutput } from '~/api/contract/analytics'
import { ANALYTICS_RANGES, type AnalyticsRange, changeRateOf } from '~/domain/analytics/report'
import { SegmentGroup } from '~/ui/segment-group'
import { TrendChart } from './analytics-chart'
import {
  countryName,
  DEVICE_LABELS,
  EXPANDABLE_LABELS,
  formatChange,
  formatCount,
  formatRate,
  LINK_KIND_LABELS,
  languageName,
  PAGED_LABELS,
  pageName,
  RANGE_LABELS,
  TOP_SECTION_LABELS,
  utmParts,
} from './analytics-labels'
import { ANALYTICS_RANGE_KEY, resolveRange } from './analytics-range'
import { api } from './api'
import { browserStorage } from './backup'
import { ListLayout } from './layouts'
import { LoadError, Skeleton } from './states'
import { writeStoredView } from './view-preference'

type Report = z.infer<typeof analyticsOutput>

export interface AnalyticsSearch {
  range?: AnalyticsRange
}

const RANGE_ITEMS = ANALYTICS_RANGES.map((value) => ({ value, label: RANGE_LABELS[value] }))

const section = css({
  display: 'flex',
  flexDirection: 'column',
  gap: 'inline',
  pt: 'stack-dense',
  borderTopWidth: 'default',
  borderTopStyle: 'solid',
  borderTopColor: 'border.default',
})
const sectionHeading = css({ textStyle: 'heading-3' })
const note = css({ textStyle: 'body-sm', color: 'text.muted' })
const notice = css({ textStyle: 'body-sm', color: 'text.default' })
const table = css({ w: '[100%]', borderCollapse: 'collapse', textStyle: 'body-sm' })
// 寄せ（textAlign）は headCell に持たせず、textCell か numberCell のどちらか1つだけで付ける。
// 同じプロパティのクラスを2つ並べると、並べた順ではなくスタイルシートの順で勝ち負けが決まる
const headCell = css({
  textStyle: 'label',
  color: 'text.muted',
  px: 'inset-dense',
  py: 'inset-dense',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
  whiteSpace: 'nowrap',
})
const cell = css({
  px: 'inset-dense',
  py: 'inset-dense',
  borderBottomWidth: 'default',
  borderBottomStyle: 'solid',
  borderBottomColor: 'border.default',
  verticalAlign: 'middle',
  overflowWrap: 'anywhere',
})
const numberCell = css({ textAlign: 'end', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' })
const textCell = css({ textAlign: 'start' })
/** モバイル幅では主要な列（名前と閲覧・件数）だけを残す（design-spec 4.3） */
const wideOnly = css({ hideBelow: 'tablet' })
const pathText = css({ textStyle: 'meta', color: 'text.muted' })
const link = css({
  color: 'link.default',
  textDecoration: 'underline',
  textDecorationColor: 'link.underline',
  _hover: { textDecorationColor: 'link.default' },
})

interface Column<T> {
  header: string
  render: (row: T) => ReactNode
  numeric?: boolean
  /** モバイル幅で隠す */
  wide?: boolean
}

function DataTable<T>({ caption, columns, rows }: { caption: string; columns: Column<T>[]; rows: T[] }) {
  return (
    <table className={table}>
      <caption className={css({ srOnly: true })}>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th
              key={column.header}
              scope="col"
              className={cx(headCell, column.numeric ? numberCell : textCell, column.wide && wideOnly)}
            >
              {column.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td colSpan={columns.length} className={cx(cell, note)}>
              まだありません
            </td>
          </tr>
        ) : (
          rows.map((row, i) => (
            // 行は期間で合計した上位で、同じ値の行は無い。並びの位置で区別する
            // biome-ignore lint/suspicious/noArrayIndexKey: 上の理由
            <tr key={i}>
              {columns.map((column) => (
                <td key={column.header} className={cx(cell, column.numeric && numberCell, column.wide && wideOnly)}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={section}>
      <h2 className={sectionHeading}>{title}</h2>
      {children}
    </section>
  )
}

function PageCell({ path, title }: { path: string; title: Report['pages'][number]['title'] }) {
  const name = pageName(path, title)
  const pathLink = (
    <a href={path} target="_blank" rel="noopener noreferrer" className={link}>
      {path}
      <span className={css({ srOnly: true })}>（別タブで開く）</span>
    </a>
  )
  if (name === null) return pathLink
  return (
    <span className={css({ display: 'flex', flexDirection: 'column' })}>
      <span>{name}</span>
      <span className={pathText}>{pathLink}</span>
    </span>
  )
}

const count = <T extends { count: number }>(header = '件数'): Column<T> => ({
  header,
  numeric: true,
  render: (row) => formatCount(row.count),
})
const visitors = <T extends { visitors: number }>(): Column<T> => ({
  header: '訪問者',
  numeric: true,
  wide: true,
  render: (row) => formatCount(row.visitors),
})

function Totals({ totals }: { totals: Report['totals'] }) {
  const items = [
    { label: '閲覧', key: 'pageViews' },
    { label: '訪問者', key: 'visitors' },
    { label: '外部へ', key: 'outbound' },
  ] as const
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <dl className={css({ display: 'flex', flexDirection: { base: 'column', tablet: 'row' }, gap: 'stack' })}>
        {items.map((item) => (
          <div key={item.key} className={css({ display: 'flex', flexDirection: 'column' })}>
            <dt className={css({ textStyle: 'label', color: 'text.muted' })}>{item.label}</dt>
            <dd className={css({ textStyle: 'heading-1', fontVariantNumeric: 'tabular-nums' })}>
              {formatCount(totals[item.key])}
            </dd>
            {totals.previous !== null && (
              <dd className={cx(note, css({ fontVariantNumeric: 'tabular-nums' }))}>
                {formatChange(changeRateOf(totals[item.key], totals.previous[item.key]))}
                <span className={css({ srOnly: true })}>（前の期間との差）</span>
              </dd>
            )}
          </div>
        ))}
      </dl>
      <p className={note}>訪問者は日ごとの訪問者数の合計です</p>
    </div>
  )
}

function ReachBars({ rows }: { rows: Report['sectionReach'] }) {
  return (
    <table className={table}>
      <caption className={css({ srOnly: true })}>P1 のセクション到達率</caption>
      <thead>
        <tr>
          <th scope="col" className={cx(headCell, textCell)}>
            セクション
          </th>
          <th scope="col" className={cx(headCell, textCell, wideOnly)}>
            <span className={css({ srOnly: true })}>棒</span>
          </th>
          <th scope="col" className={cx(headCell, numberCell)}>
            到達率
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.section}>
            <td className={cx(cell, css({ whiteSpace: 'nowrap' }))} lang="en">
              {TOP_SECTION_LABELS[row.section]}
            </td>
            <td className={cx(cell, wideOnly, css({ w: '[100%]' }))}>
              <svg
                aria-hidden="true"
                focusable="false"
                viewBox="0 0 100 1"
                preserveAspectRatio="none"
                className={css({ display: 'block', w: '[100%]', h: 'meter', bg: 'bg.muted' })}
              >
                <rect
                  x={0}
                  y={0}
                  width={Math.min(1, row.rate ?? 0) * 100}
                  height={1}
                  className={css({ fill: 'text.muted' })}
                />
              </svg>
            </td>
            <td className={cx(cell, numberCell)}>{formatRate(row.rate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function OtherActions({ actions }: { actions: Report['otherActions'] }) {
  const rows: { label: string; count: number }[] = [
    { label: '言語の切り替え: 日本語へ', count: actions.langSwitch.ja },
    { label: '言語の切り替え: 英語へ', count: actions.langSwitch.en },
    { label: 'テーマの切り替え: OSに合わせる', count: actions.themeSwitch.system },
    { label: 'テーマの切り替え: ライト', count: actions.themeSwitch.light },
    { label: 'テーマの切り替え: ダーク', count: actions.themeSwitch.dark },
    { label: 'コードのコピー', count: actions.codeCopy },
    ...Object.entries(actions.paging).map(([key, value]) => ({
      label: `ページング: ${PAGED_LABELS[key as keyof typeof PAGED_LABELS]}`,
      count: value,
    })),
  ]
  return (
    <DataTable
      caption="その他の操作"
      columns={[{ header: '操作', render: (row) => row.label }, count<(typeof rows)[number]>()]}
      rows={rows}
    />
  )
}

type KeyRow = Report['audience']['countries'][number]

function AudienceTable({ title, rows, name }: { title: string; rows: KeyRow[]; name: (key: string) => string }) {
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline', minW: '[0]' })}>
      <h3 className={css({ textStyle: 'label', color: 'text.muted' })}>{title}</h3>
      <DataTable
        caption={title}
        columns={[{ header: '名前', render: (row) => name(row.key) }, count<KeyRow>('閲覧'), visitors<KeyRow>()]}
        rows={rows}
      />
    </div>
  )
}

function ReportView({ report }: { report: Report }) {
  const empty = report.series.points.every((point) => point.pageViews === 0)
  return (
    <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
        <Totals totals={report.totals} />
        {!report.today.included && <p className={notice}>今日の分を読めませんでした。表示は昨日までです</p>}
        {report.missingDays > 0 && (
          <p className={notice}>
            集計していない日があります（{formatCount(report.missingDays)}日）。毎日 0:15 の集計で埋まります
          </p>
        )}
      </div>
      {empty ? <p className={note}>この期間のデータはまだありません</p> : <TrendChart points={report.series.points} />}
      <Section title="ページ">
        <DataTable
          caption="ページ"
          columns={[
            { header: 'ページ', render: (row) => <PageCell path={row.path} title={row.title} /> },
            { header: '閲覧', numeric: true, render: (row) => formatCount(row.pageViews) },
            visitors(),
          ]}
          rows={report.pages}
        />
      </Section>
      <Section title="流入元">
        <DataTable
          caption="流入元"
          columns={[{ header: 'ホスト名', render: (row) => row.key }, count<KeyRow>(), visitors<KeyRow>()]}
          rows={report.referrers}
        />
      </Section>
      {/* 使わない人には常に空なので、0件なら出さない（design-spec 6.8） */}
      {report.utm.length > 0 && (
        <Section title="キャンペーン（UTM）">
          <DataTable
            caption="キャンペーン（UTM）"
            columns={[
              { header: 'source', render: (row) => utmParts(row.key)[0] },
              { header: 'medium', render: (row) => utmParts(row.key)[1] },
              { header: 'campaign', render: (row) => utmParts(row.key)[2] },
              count<KeyRow>(),
              visitors<KeyRow>(),
            ]}
            rows={report.utm}
          />
        </Section>
      )}
      <Section title="P1 のセクション到達率">
        <ReachBars rows={report.sectionReach} />
      </Section>
      <Section title="広げた行">
        <DataTable
          caption="広げた行"
          columns={[
            { header: '種類', render: (row) => <span lang="en">{EXPANDABLE_LABELS[row.section]}</span> },
            { header: 'タイトル', render: (row) => row.title?.ja ?? row.title?.en ?? '削除済み' },
            count(),
            visitors(),
          ]}
          rows={report.rowExpands}
        />
      </Section>
      <Section title="押した外部リンク">
        <DataTable
          caption="押した外部リンク"
          columns={[
            { header: '種類', render: (row) => LINK_KIND_LABELS[row.linkKind] },
            { header: 'ホスト名', render: (row) => row.host },
            count(),
            visitors(),
          ]}
          rows={report.outbounds}
        />
      </Section>
      <Section title="最後まで読まれたページ">
        <DataTable
          caption="最後まで読まれたページ"
          columns={[
            { header: 'ページ', render: (row) => <PageCell path={row.path} title={row.title} /> },
            count(),
            visitors(),
          ]}
          rows={report.readCompletes}
        />
      </Section>
      <Section title="その他の操作">
        <OtherActions actions={report.otherActions} />
      </Section>
      <Section title="訪問者の属性">
        <div
          className={css({
            display: 'grid',
            gridTemplateColumns: { base: 'minmax(0, 1fr)', desktop: 'minmax(0, 1fr) minmax(0, 1fr)' },
            gap: 'stack',
          })}
        >
          <AudienceTable title="国" rows={report.audience.countries} name={countryName} />
          <AudienceTable
            title="デバイス"
            rows={report.audience.devices}
            name={(key) => DEVICE_LABELS[key as keyof typeof DEVICE_LABELS] ?? key}
          />
          <AudienceTable title="ブラウザの言語" rows={report.audience.browserLangs} name={languageName} />
          <AudienceTable title="/ja と /en" rows={report.audience.siteLangs} name={(key) => `/${key}`} />
        </div>
      </Section>
    </div>
  )
}

function LoadingView() {
  return (
    <div aria-busy="true" className={css({ display: 'flex', flexDirection: 'column', gap: 'stack' })}>
      <div className={css({ display: 'flex', gap: 'stack' })}>
        <Skeleton className={css({ flex: '1' })} />
        <Skeleton className={css({ flex: '1' })} />
        <Skeleton className={css({ flex: '1' })} />
      </div>
      <Skeleton className={css({ h: 'chart' })} />
      <Skeleton />
      <Skeleton />
      <Skeleton />
    </div>
  )
}

export function AnalyticsPage({ search }: { search: AnalyticsSearch }) {
  const router = useRouter()
  const range = resolveRange(search.range, browserStorage())
  const query = useQuery({ queryKey: ['analytics', range], queryFn: () => api.analytics.get({ range }) })

  const select = (next: AnalyticsRange) => {
    // 覚えるのは押したときだけ。URL は置き換え、履歴を増やさない（design-spec 6.8）
    writeStoredView(ANALYTICS_RANGE_KEY, next)
    void router.navigate({ to: '/admin/analytics', search: { range: next }, replace: true })
  }

  return (
    <ListLayout
      title="アクセス解析"
      actions={<SegmentGroup label="期間" items={RANGE_ITEMS} value={range} onValueChange={select} />}
    >
      <div className={css({ display: 'flex', flexDirection: 'column', gap: 'stack-dense' })}>
        {query.data?.measuring === false && (
          <p className={notice}>この環境では計測していません。表示しているのは保存済みの集計だけです</p>
        )}
        {query.status === 'error' ? (
          <LoadError onRetry={() => query.refetch()} />
        ) : query.data === undefined ? (
          <LoadingView />
        ) : (
          <ReportView report={query.data} />
        )}
      </div>
    </ListLayout>
  )
}
