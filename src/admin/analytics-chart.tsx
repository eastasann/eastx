/**
 * A10 の推移のグラフ（design-spec 6.8）。区切りごとに閲覧数の棒と、訪問者数の印（棒の上の横線）を SVG で描く。
 * SVG は読み上げから外し、同じ値を見えない表で持つ。棒の上に区切りごとのボタンを重ね、ポインターとキーボードで
 * ツールチップに値を出す（Tab で入るのは1つだけで、← → Home End で区切りを移る）
 */
import { type KeyboardEvent, useRef, useState } from 'react'
import { css } from 'styled-system/css'
import { formatAdminDate } from '~/i18n/format'
import { Tooltip } from '~/ui/tooltip'
import { formatCount } from './analytics-labels'

export interface TrendPoint {
  start: string
  pageViews: number
  visitors: number
}

/** SVG の座標（viewBox）。区切り1つの幅と、棒の両脇の隙間。描く大きさはトークンの size.chart と幅いっぱいで決まる */
const SLOT = 10
const GAP = 1
const HEIGHT = 100

function pointLabel(point: TrendPoint): string {
  return `${formatAdminDate(point.start)}〜　閲覧 ${formatCount(point.pageViews)}・訪問者 ${formatCount(point.visitors)}`
}

export function TrendChart({ points }: { points: readonly TrendPoint[] }) {
  const [selected, setActive] = useState(points.length - 1)
  // 期間を変えて区切りの数が減っても、Tab で入れる区切りを1つ残す
  const active = Math.min(selected, points.length - 1)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const max = Math.max(1, ...points.map((point) => point.pageViews))
  const scale = (value: number) => (value / max) * HEIGHT
  const first = points[0]
  const last = points.at(-1)

  const move = (event: KeyboardEvent, index: number) => {
    const next =
      event.key === 'ArrowLeft'
        ? index - 1
        : event.key === 'ArrowRight'
          ? index + 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? points.length - 1
              : null
    if (next === null || next < 0 || next >= points.length) return
    event.preventDefault()
    setActive(next)
    buttons.current[next]?.focus()
  }

  return (
    <figure className={css({ display: 'flex', flexDirection: 'column', gap: 'inline' })}>
      <div className={css({ position: 'relative', h: 'chart' })}>
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox={`0 0 ${points.length * SLOT} ${HEIGHT}`}
          preserveAspectRatio="none"
          className={css({ display: 'block', w: '[100%]', h: '[100%]' })}
        >
          {points.map((point, i) => {
            const x = i * SLOT + GAP
            const barHeight = scale(point.pageViews)
            const visitorsY = HEIGHT - scale(point.visitors)
            return (
              <g key={point.start}>
                <rect
                  x={x}
                  y={HEIGHT - barHeight}
                  width={SLOT - GAP * 2}
                  height={barHeight}
                  className={css({ fill: 'text.muted' })}
                />
                {point.visitors > 0 && (
                  // 棒と同じく縦横に伸びる座標なので、線の太さだけは画面の太さのまま描く
                  <line
                    x1={x}
                    x2={x + SLOT - GAP * 2}
                    y1={visitorsY}
                    y2={visitorsY}
                    vectorEffect="non-scaling-stroke"
                    strokeWidth={2}
                    className={css({ stroke: 'text.default' })}
                  />
                )}
              </g>
            )
          })}
        </svg>
        {/* biome-ignore lint/a11y/useSemanticElements: 区切りのボタンをまとめて読み上げる。fieldset はフォームの部品ではないので使わない */}
        <div
          role="group"
          aria-label="推移の区切り"
          className={css({ position: 'absolute', inset: 'none', display: 'flex' })}
        >
          {points.map((point, i) => (
            <Tooltip key={point.start} content={pointLabel(point)} openDelay={0}>
              <button
                ref={(element) => {
                  buttons.current[i] = element
                }}
                type="button"
                tabIndex={i === active ? 0 : -1}
                aria-label={pointLabel(point)}
                onFocus={() => setActive(i)}
                onKeyDown={(event) => move(event, i)}
                className={css({
                  flex: '1',
                  minW: '[0]',
                  bg: 'transparent',
                  cursor: 'default',
                  _focusVisible: { outlineWidth: 'focus-ring', outlineStyle: 'solid', outlineColor: 'focus-ring' },
                })}
              />
            </Tooltip>
          ))}
        </div>
      </div>
      {first !== undefined && last !== undefined && (
        <div
          aria-hidden="true"
          className={css({ display: 'flex', justifyContent: 'space-between', textStyle: 'meta', color: 'text.muted' })}
        >
          <span>{formatAdminDate(first.start)}</span>
          {last !== first && <span>{formatAdminDate(last.start)}</span>}
        </div>
      )}
      <table className={css({ srOnly: true })}>
        <caption>推移（区切りごとの閲覧と訪問者）</caption>
        <thead>
          <tr>
            <th scope="col">区切りの最初の日</th>
            <th scope="col">閲覧</th>
            <th scope="col">訪問者</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.start}>
              <td>{formatAdminDate(point.start)}</td>
              <td>{formatCount(point.pageViews)}</td>
              <td>{formatCount(point.visitors)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
