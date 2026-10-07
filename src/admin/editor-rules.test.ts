import { describe, expect, it } from 'vitest'
import {
  blockedReason,
  counterState,
  firstErrorField,
  isSaveShortcut,
  type ShortcutState,
  saveStatusText,
  shortcutAction,
} from './editor-rules'

describe('Cmd/Ctrl+S の割り当て（design-spec 6.7.1）', () => {
  const base: ShortcutState = { kind: 'publishable', status: 'draft', dirty: true, blocked: false, confirming: false }

  it('公開状態を持つもの: 新規作成と下書きは下書き保存、公開中は更新', () => {
    expect(shortcutAction({ ...base, status: null })).toBe('saveDraft')
    expect(shortcutAction(base)).toBe('saveDraft')
    expect(shortcutAction({ ...base, status: 'published' })).toBe('update')
  })

  it('状態を持たないもの（プロフィール・使用技術）は保存', () => {
    expect(shortcutAction({ ...base, kind: 'plain', status: null })).toBe('save')
  })

  it('変更がない・押せない・確認ダイアログが開いているときは送らない', () => {
    expect(shortcutAction({ ...base, dirty: false })).toBeNull()
    expect(shortcutAction({ ...base, status: 'published', dirty: false })).toBeNull()
    expect(shortcutAction({ ...base, blocked: true })).toBeNull()
    expect(shortcutAction({ ...base, confirming: true })).toBeNull()
  })

  it('Cmd か Ctrl と s。IME の変換中は無視する', () => {
    const key = { key: 's', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false }
    expect(isSaveShortcut({ ...key, metaKey: true })).toBe(true)
    expect(isSaveShortcut({ ...key, ctrlKey: true })).toBe(true)
    expect(isSaveShortcut(key)).toBe(false)
    expect(isSaveShortcut({ ...key, metaKey: true, isComposing: true })).toBe(false)
    // Caps Lock 中は key が大文字になる。Shift・Alt 付き（別名で保存など）は除く
    expect(isSaveShortcut({ ...key, key: 'S', ctrlKey: true })).toBe(true)
    expect(isSaveShortcut({ ...key, key: 'S', ctrlKey: true, shiftKey: true })).toBe(false)
    expect(isSaveShortcut({ ...key, metaKey: true, altKey: true })).toBe(false)
  })
})

describe('保存の状態の文言（design-spec 6.7.4）', () => {
  const now = new Date('2026-10-07T05:40:00Z')
  const state = { isNew: false, dirty: false, saving: false, updatedAt: '2026-10-07T05:32:00Z', now }

  it('今日なら時刻、今日でなければ月日と時刻', () => {
    expect(saveStatusText(state)).toEqual({ text: '保存済み 14:32', tone: 'muted' })
    expect(saveStatusText({ ...state, updatedAt: '2026-10-06T05:32:00Z' }).text).toBe('保存済み 10月6日 14:32')
  })

  it('変更あり・保存中・新規作成', () => {
    expect(saveStatusText({ ...state, dirty: true })).toEqual({ text: '未保存の変更', tone: 'changed' })
    expect(saveStatusText({ ...state, dirty: true, saving: true }).text).toBe('保存しています…')
    expect(saveStatusText({ ...state, isNew: true, dirty: true, updatedAt: null }).text).toBe('未保存')
  })
})

describe('ボタンを押せない理由（design-spec 6.7.4）', () => {
  it('保存中 → アップロード中 → スラッグの作成中の順に1つ', () => {
    expect(blockedReason(true, ['slug', 'upload-ja'])).toBe('保存しています')
    expect(blockedReason(false, ['slug', 'upload-image:1'])).toBe('画像をアップロードしています')
    expect(blockedReason(false, ['slug'])).toBe('スラッグを作っています')
    expect(blockedReason(false, [])).toBeNull()
  })
})

describe('最初の誤りの欄（design-spec 6.7.3）', () => {
  const order = [
    'ja.title',
    'ja.summary',
    'en.title',
    'en.summary',
    'ja.body',
    'en.body',
    'slug',
    'stacks',
    'socialLinks',
  ]

  it('言語ごとの欄（日→英）→ 本文 → 設定パネルの順', () => {
    expect(firstErrorField(order, ['slug', 'en.title', 'ja.body'])).toBe('en.title')
    expect(firstErrorField(order, ['slug', 'en.body'])).toBe('en.body')
    expect(firstErrorField(order, ['slug'])).toBe('slug')
  })

  it('配列の欄は頭が一致すれば同じ欄として扱い、その誤りのキーを返す', () => {
    expect(firstErrorField(order, ['socialLinks.1.url', 'socialLinks.0.url'])).toBe('socialLinks.1.url')
  })

  it('並びに無いキーは見つかった順', () => {
    expect(firstErrorField(order, ['other'])).toBe('other')
    expect(firstErrorField(order, [])).toBeNull()
  })
})

describe('文字数の表示（design-spec 6.7.3）', () => {
  it('200字の欄は 161字から出し、201字で赤字', () => {
    expect(counterState('あ'.repeat(160), 200)).toBeNull()
    expect(counterState('あ'.repeat(161), 200)).toEqual({ text: '161 / 200', over: false })
    expect(counterState('あ'.repeat(200), 200)).toEqual({ text: '200 / 200', over: false })
    expect(counterState('あ'.repeat(201), 200)).toEqual({ text: '201 / 200', over: true })
  })

  it('500字の欄は 401字から', () => {
    expect(counterState('a'.repeat(400), 500)).toBeNull()
    expect(counterState('a'.repeat(401), 500)?.text).toBe('401 / 500')
  })

  it('前後の空白は数えない（保存の入力チェックと同じ）', () => {
    expect(counterState(`  ${'a'.repeat(160)}  `, 200)).toBeNull()
  })
})
