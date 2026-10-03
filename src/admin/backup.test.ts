import { describe, expect, it } from 'vitest'
import { backupKey, clearBackup, readBackup, saveBackup } from './backup'

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

describe('期限切れのときの一時保存（design-spec 6.4、SDD 8章）', () => {
  it('キーは eastx:backup:{種類}:{id か new}', () => {
    expect(backupKey('career', 'c1')).toBe('eastx:backup:career:c1')
    expect(backupKey('stack', null)).toBe('eastx:backup:stack:new')
  })

  it('保存した値を読み、消したら読めない', () => {
    const storage = new MemoryStorage()
    saveBackup(storage, 'k', { title: '書きかけ' })
    expect(readBackup(storage, 'k', isTitle)).toEqual({ title: '書きかけ' })
    clearBackup(storage, 'k')
    expect(readBackup(storage, 'k', isTitle)).toBeNull()
  })

  it('形の違う値・JSON でない値は無いものとして消す', () => {
    const storage = new MemoryStorage()
    saveBackup(storage, 'shape', { name: 'x' })
    storage.setItem('broken', '{')
    expect(readBackup(storage, 'shape', isTitle)).toBeNull()
    expect(readBackup(storage, 'broken', isTitle)).toBeNull()
    expect(storage.length).toBe(0)
  })
})
