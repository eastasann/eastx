/**
 * 画像の代わりの表示（design-spec 6.1.5・6.2.3）。読み込めない画像は、壊れた画像のアイコンを出さず、
 * 背景色だけの枠にする。写真・技術のアイコンがないときは、名前の頭文字の丸にする
 */
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { css, cva, cx } from 'styled-system/css'
import { initialOf } from '~/domain/initial'

export interface FallbackImageProps {
  src: string
  /** 代替テキスト（design-spec 4.4: サムネイルはタイトル、技術アイコンは表示名、写真は名前） */
  alt: string
  /** 画像と、代わりの枠の両方に付ける（大きさ・縦横比・角丸）。収め方と地の色は `fit` で決め、ここには書かない */
  className: string
  /**
   * cover（既定）は枠いっぱいに切り抜き、読み込むまで地の色を出す（サムネイル・写真）。contain は切らずに収め、
   * 地の色を付けない（技術のアイコン）。className と同じプロパティを持たせないのは、Panda の別々の原子クラスどうしは
   * クラスの並びではなくスタイルシートの順で勝ち負けが決まり、呼び出し側の指定が負けうるため
   */
  fit?: 'cover' | 'contain'
  /** ファーストビューの外は lazy（SDD 7章） */
  loading?: 'eager' | 'lazy'
  /** 読み込めなかったときに、背景色だけの枠の代わりに出すもの */
  fallback?: ReactNode
}

const frame = css({ display: 'block', bg: 'bg.muted' })

const imageFit = cva({
  variants: {
    fit: {
      cover: { objectFit: 'cover', bg: 'bg.muted' },
      contain: { objectFit: 'contain' },
    },
  },
})

export function FallbackImage({ src, alt, className, loading = 'lazy', fallback, fit = 'cover' }: FallbackImageProps) {
  const ref = useRef<HTMLImageElement>(null)
  const [failed, setFailed] = useState(false)

  // SSR の HTML の画像は、hydrate の前に読み込みに失敗すると onError が React に届かない。
  // 描画のあとに、読み込みが終わった画像を decode() で確かめる（naturalWidth は、大きさを持たない SVG だと
  // 読み込めても 0 になるので使わない）
  useEffect(() => {
    const image = ref.current
    if (!image?.complete) return
    let active = true
    image.decode().catch(() => {
      if (active) setFailed(true)
    })
    return () => {
      active = false
    }
  }, [])

  if (failed) return fallback ?? <span aria-hidden="true" className={cx(frame, className)} />
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={loading}
      decoding="async"
      onError={() => setFailed(true)}
      className={cx(imageFit({ fit }), className)}
    />
  )
}

const initialBadge = cva({
  base: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    aspectRatio: 'avatar',
    borderRadius: 'avatar',
    bg: 'bg.muted',
    color: 'text.muted',
    userSelect: 'none',
  },
  variants: {
    size: {
      avatar: { w: 'avatar-sm', textStyle: 'heading-2' },
      icon: { w: 'icon', textStyle: 'label' },
    },
  },
})

/** 名前の頭文字の丸。名前は隣に出すので、丸は読み上げから外す */
export function InitialBadge({ name, size }: { name: string; size: 'avatar' | 'icon' }) {
  return (
    <span aria-hidden="true" className={initialBadge({ size })}>
      {initialOf(name)}
    </span>
  )
}
