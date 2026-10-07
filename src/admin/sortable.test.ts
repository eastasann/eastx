import type { ClientRect, DroppableContainer } from '@dnd-kit/core'
import { describe, expect, it } from 'vitest'
import { wrapCollision } from './sortable'

function rect(left: number, top: number, width: number, height = 29): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function collide(collisionRect: ClientRect, rects: Record<string, ClientRect>) {
  const droppableRects = new Map(Object.entries(rects))
  const droppableContainers = Object.keys(rects).map((id) => ({ id, disabled: false }) as unknown as DroppableContainer)
  return wrapCollision({
    active: { id: 'active' } as never,
    collisionRect,
    droppableRects,
    droppableContainers,
    pointerCoordinates: null,
  })[0]?.id
}

describe('折り返す並びの当たり判定（使用技術の並べ替え）', () => {
  it('幅の広い項目を、前の行の狭い項目の位置へ動かすと、その項目を選ぶ（元の位置を選ばない）', () => {
    const rects = { narrow: rect(0, 0, 144), wide: rect(0, 37, 220) }
    // 矢印キーで動かすと、持ち上げた項目の左上が行き先の左上に重なる
    expect(collide(rect(0, 0, 220), rects)).toBe('narrow')
  })

  it('行き先の隣の項目により多く重なっても、左上の重なる行き先を選ぶ', () => {
    const rects = { narrow: rect(0, 0, 60), next: rect(68, 0, 150), wide: rect(0, 37, 220) }
    expect(collide(rect(0, 0, 220), rects)).toBe('narrow')
  })

  it('どれにも重ならないときは、中心の近さで選ぶ', () => {
    const rects = { a: rect(0, 0, 100), b: rect(200, 0, 100) }
    expect(collide(rect(110, 100, 60), rects)).toBe('a')
  })
})
