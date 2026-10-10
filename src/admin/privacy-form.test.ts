import { describe, expect, it } from 'vitest'
import { backupKey } from './backup'
import { firstErrorField } from './editor-rules'
import { BACKUP_TYPE, FIELD_ORDER, parsePrivacyForm, savedNotice, toForm } from './privacy-form'

const saved = (ja: string | null, en: string | null) => ({
  id: 'p1',
  ja: { body: ja },
  en: { body: en },
  languages: { ja: ja !== null, en: en !== null },
  updatedAt: '2026-10-10T03:12:45.000Z',
})

describe('A11 の自動退避（design-spec 6.4、SDD ADR-008）', () => {
  it('種類は privacy で、キーは行の id（行がまだ無ければ new）', () => {
    expect(backupKey(BACKUP_TYPE, 'p1')).toBe('eastx:backup:privacy:p1')
    expect(backupKey(BACKUP_TYPE, null)).toBe('eastx:backup:privacy:new')
  })

  it('今の形の退避はそのまま読み、形の違う退避は読まない', () => {
    const form = { ja: { body: '本文' }, en: { body: '' } }
    expect(parsePrivacyForm(form)).toEqual(form)
    expect(parsePrivacyForm({ ja: { body: '本文' } })).toBeNull()
    expect(parsePrivacyForm({ ja: { body: 1 }, en: { body: '' } })).toBeNull()
  })

  it('行が無いときは空のフォーム、null の本文は空文字', () => {
    expect(toForm(null)).toEqual({ ja: { body: '' }, en: { body: '' } })
    expect(toForm(saved('本文', null))).toEqual({ ja: { body: '本文' }, en: { body: '' } })
  })
})

describe('A11 の誤りの欄の順（design-spec 6.7.3）', () => {
  it('本文（日本語）→ 本文（英語）', () => {
    expect(FIELD_ORDER).toEqual(['ja.body', 'en.body'])
    expect(firstErrorField(FIELD_ORDER, ['en.body', 'ja.body'])).toBe('ja.body')
  })
})

describe('A11 の保存の通知（design-spec 6.7.2）', () => {
  it('本文が日英のどちらかにあれば「保存しました」', () => {
    expect(savedNotice(saved('本文', null))).toBe('保存しました')
    expect(savedNotice(saved(null, 'Body'))).toBe('保存しました')
  })

  it('日英とも空にして保存したら、公開サイトにページとリンクが出ないことを添える', () => {
    expect(savedNotice(saved(null, null))).toBe('保存しました。本文が空なので、公開サイトにはページとリンクが出ません')
  })
})
