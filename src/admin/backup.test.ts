import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AutoBackup, BACKUP_DELAY_MS, backupKey, clearAllBackups, clearBackup, readBackup, saveBackup } from './backup'

class MemoryStorage implements Storage {
  private items = new Map<string, string>()
  get length() {
    return this.items.size
  }
  clear() {
    this.items.clear()
  }
  getItem(key: string) {
    return this.items.get(key) ?? null
  }
  key(index: number) {
    return [...this.items.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.items.delete(key)
  }
  setItem(key: string, value: string) {
    this.items.set(key, value)
  }
}

const isTitle = (value: unknown): value is { title: string } =>
  typeof value === 'object' && value !== null && 'title' in value && typeof value.title === 'string'

describe('退避の読み書き（design-spec 6.4、SDD 8章）', () => {
  it('キーは eastx:backup:{種類}:{id か new}', () => {
    expect(backupKey('career', 'c1')).toBe('eastx:backup:career:c1')
    expect(backupKey('stack', null)).toBe('eastx:backup:stack:new')
  })

  it('保存した値を読み、消したら読めない', () => {
    const storage = new MemoryStorage()
    saveBackup(storage, 'k', { title: '書きかけ' }, new Date('2026-10-07T05:32:00Z'))
    expect(readBackup(storage, 'k', isTitle)).toEqual({
      savedAt: '2026-10-07T05:32:00.000Z',
      values: { title: '書きかけ' },
    })
    clearBackup(storage, 'k')
    expect(readBackup(storage, 'k', isTitle)).toBeNull()
  })

  it('形の違う値・JSON でない値は無いものとして消す', () => {
    const storage = new MemoryStorage()
    saveBackup(storage, 'shape', { name: 'x' })
    storage.setItem('broken', '{')
    storage.setItem('noTime', JSON.stringify({ values: { title: 'x' } }))
    storage.setItem('badTime', JSON.stringify({ savedAt: 'きのう', values: { title: 'x' } }))
    for (const key of ['shape', 'broken', 'noTime', 'badTime']) expect(readBackup(storage, key, isTitle)).toBeNull()
    expect(storage.length).toBe(0)
  })

  it('ログアウトで eastx:backup: で始まるキーだけを消す', () => {
    const storage = new MemoryStorage()
    saveBackup(storage, backupKey('work', 'w1'), { title: 'a' })
    saveBackup(storage, backupKey('career', null), { title: 'b' })
    storage.setItem('eastx:admin:editor-view', 'split')
    clearAllBackups(storage)
    expect(storage.length).toBe(1)
    expect(storage.getItem('eastx:admin:editor-view')).toBe('split')
  })
})

describe('自動退避の規則（design-spec 6.4）', () => {
  type Form = { title: string }
  const empty: Form = { title: '' }
  const key = backupKey('work', 'w1')
  const NOW = new Date('2026-10-07T05:32:00Z')
  let storage: MemoryStorage

  beforeEach(() => {
    vi.useFakeTimers()
    storage = new MemoryStorage()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const create = (baseline: Form = { title: 'サーバー' }, k = key) =>
    new AutoBackup<Form>({ storage, key: k, baseline, now: () => NOW })
  const stored = (k = key) => readBackup(storage, k, isTitle)?.values ?? null

  it('開いた直後は書きも消しもしない', () => {
    saveBackup(storage, key, { title: '書きかけ' })
    const backup = create()
    vi.advanceTimersByTime(BACKUP_DELAY_MS * 2)
    backup.dispose()
    expect(stored()).toEqual({ title: '書きかけ' })
  })

  it('入力したら1秒待って、比べる元と違えば書く。同じに戻れば消す', () => {
    const backup = create()
    backup.changed({ title: 'サーバー直し' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS - 1)
    expect(stored()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(readBackup(storage, key, isTitle)).toEqual({ savedAt: NOW.toISOString(), values: { title: 'サーバー直し' } })
    backup.changed({ title: 'サーバー' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    expect(stored()).toBeNull()
  })

  it('待っているあいだに続けて入力したら、最後の値だけを書く', () => {
    const backup = create()
    backup.changed({ title: 'a' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS / 2)
    backup.changed({ title: 'ab' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS / 2)
    expect(stored()).toBeNull()
    vi.advanceTimersByTime(BACKUP_DELAY_MS / 2)
    expect(stored()).toEqual({ title: 'ab' })
  })

  describe('復元の提案', () => {
    it('退避が比べる元と違えば、退避の時刻と一緒に提案する', () => {
      saveBackup(storage, key, { title: '書きかけ' }, NOW)
      const offer = create().takeOffer(isTitle, '2026-10-07T05:00:00Z')
      expect(offer).toEqual({ savedAt: NOW.toISOString(), values: { title: '書きかけ' }, serverNewer: false })
    })

    it('サーバーの最終保存の方が新しければ、その旨を添える', () => {
      saveBackup(storage, key, { title: '書きかけ' }, NOW)
      expect(create().takeOffer(isTitle, '2026-10-07T06:00:00Z')?.serverNewer).toBe(true)
    })

    it('新規作成（サーバーの最終保存がない）は添えない', () => {
      const newKey = backupKey('work', null)
      saveBackup(storage, newKey, { title: '書きかけ' }, NOW)
      expect(create(empty, newKey).takeOffer(isTitle, null)?.serverNewer).toBe(false)
    })

    it('退避が比べる元と同じなら、提案せずに消す', () => {
      saveBackup(storage, key, { title: 'サーバー' })
      expect(create().takeOffer(isTitle, null)).toBeNull()
      expect(stored()).toBeNull()
    })

    it('提案しているあいだは、入力しても書きも消しもしない', () => {
      saveBackup(storage, key, { title: '書きかけ' })
      const backup = create()
      backup.takeOffer(isTitle, null)
      backup.changed({ title: 'サーバー' })
      vi.advanceTimersByTime(BACKUP_DELAY_MS)
      expect(stored()).toEqual({ title: '書きかけ' })
    })

    it('「復元する」で、復元した値を最初の退避として書く。以後は入力で書き換わる', () => {
      saveBackup(storage, key, { title: '書きかけ' }, new Date('2026-10-01T00:00:00Z'))
      const backup = create()
      const offer = backup.takeOffer(isTitle, null)
      if (offer === null) throw new Error('提案がない')
      backup.restored(offer.values)
      expect(readBackup(storage, key, isTitle)?.savedAt).toBe(NOW.toISOString())
      backup.changed({ title: '書きかけの続き' })
      vi.advanceTimersByTime(BACKUP_DELAY_MS)
      expect(stored()).toEqual({ title: '書きかけの続き' })
    })

    it('「破棄する」で消す。提案のあいだに入力していれば、今の値で書き直す', () => {
      saveBackup(storage, key, { title: '書きかけ' })
      const backup = create()
      backup.takeOffer(isTitle, null)
      backup.discarded({ title: 'サーバー' })
      expect(stored()).toBeNull()

      saveBackup(storage, key, { title: '書きかけ' })
      const again = create()
      again.takeOffer(isTitle, null)
      again.discarded({ title: '提案のあいだの入力' })
      expect(stored()).toEqual({ title: '提案のあいだの入力' })
    })

    it('提案しているあいだは、保存しても期限が切れても、提案した退避を消しも書き換えもしない', () => {
      saveBackup(storage, key, { title: '書きかけ' })
      const backup = create()
      backup.takeOffer(isTitle, null)
      backup.saved({ key, baseline: { title: '保存した' }, values: { title: '保存した' } })
      backup.flush({ title: '期限切れの前の入力' })
      expect(stored()).toEqual({ title: '書きかけ' })
      expect(backup.isOffering).toBe(true)
    })
  })

  it('保存に成功し、送った値と今の値が同じなら消す', () => {
    const backup = create()
    backup.changed({ title: '直した' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    backup.saved({ key, baseline: { title: '直した' }, values: { title: '直した' } })
    expect(stored()).toBeNull()
  })

  it('保存の通信中にさらに入力していれば、今の値で書き直す', () => {
    const backup = create()
    backup.changed({ title: '直した' })
    backup.saved({ key, baseline: { title: '直した' }, values: { title: '直した。さらに' } })
    expect(stored()).toEqual({ title: '直した。さらに' })
    // 保存の前に待っていた書き込みは捨てる
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    expect(stored()).toEqual({ title: '直した。さらに' })
  })

  it('新規作成で初めて保存したら new のキーを消し、以後は {id} のキー', () => {
    const newKey = backupKey('work', null)
    const backup = create(empty, newKey)
    backup.changed({ title: '新しい' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    expect(stored(newKey)).toEqual({ title: '新しい' })
    backup.saved({ key, baseline: { title: '新しい' }, values: { title: '新しい' } })
    expect(stored(newKey)).toBeNull()
    backup.changed({ title: '新しい2' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    expect(stored()).toEqual({ title: '新しい2' })
  })

  it('削除・移動を選んだら消す', () => {
    const backup = create()
    backup.changed({ title: 'x' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    backup.clear()
    expect(stored()).toBeNull()
  })

  it('期限切れ（UNAUTHORIZED）では待たずに書き、消さない', () => {
    const backup = create()
    backup.changed({ title: '途中' })
    backup.flush({ title: '途中まで' })
    expect(stored()).toEqual({ title: '途中まで' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    expect(stored()).toEqual({ title: '途中まで' })
  })

  it('比べるときの形を渡すと、比較に関係ない値の違いを無視する', () => {
    type Links = { links: { id: string; url: string }[] }
    const k = backupKey('profile', 'p1')
    saveBackup(storage, k, { links: [{ id: 'old', url: 'https://a' }] })
    const isLinks = (value: unknown): value is Links => typeof value === 'object' && value !== null && 'links' in value
    const backup = new AutoBackup<Links>({
      storage,
      key: k,
      baseline: { links: [{ id: 'new', url: 'https://a' }] },
      comparable: (values) => values.links.map((link) => link.url),
    })
    expect(backup.takeOffer(isLinks, null)).toBeNull()
  })
})

describe('退避を使えない・止めたとき', () => {
  it('localStorage を使えなければ何もしない', () => {
    vi.useFakeTimers()
    const backup = new AutoBackup<{ title: string }>({ storage: null, key: 'k', baseline: { title: '' } })
    expect(backup.takeOffer(isTitle, null)).toBeNull()
    backup.changed({ title: 'x' })
    vi.advanceTimersByTime(BACKUP_DELAY_MS)
    backup.flush({ title: 'y' })
    backup.clear()
    vi.useRealTimers()
  })

  it('容量の上限などで書けなくても例外を出さない', () => {
    const full = new MemoryStorage()
    full.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    expect(() => saveBackup(full, 'k', { title: 'x' })).not.toThrow()
  })
})
