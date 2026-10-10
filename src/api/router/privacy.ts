import { privacyPage } from '../../db/schema'
import { languagesOf } from '../../domain/languages'
import { admin, db, toIso } from './base'

async function readPrivacyPage() {
  const row = await db().select().from(privacyPage).limit(1).get()
  if (!row) return null
  const ja = { body: row.bodyJa }
  const en = { body: row.bodyEn }
  return { id: row.id, ja, en, languages: languagesOf('body', ja, en), updatedAt: toIso(row.updatedAt) }
}

export const privacyRouter = {
  get: admin.privacy.get.handler(async ({ errors }) => {
    const result = await readPrivacyPage()
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  update: admin.privacy.update.handler(async ({ input }) => {
    const values = { bodyJa: input.ja.body, bodyEn: input.en.body }
    // 行（1件だけ）の upsert を1文で行う（SDD 5.12）。on conflict do update では $onUpdateFn が効かないので、
    // 公開側の最終更新日になる updated_at を明示して入れる
    await db()
      .insert(privacyPage)
      .values({ singleton: 1, ...values })
      .onConflictDoUpdate({ target: privacyPage.singleton, set: { ...values, updatedAt: new Date() } })
    const result = await readPrivacyPage()
    if (!result) throw new Error('プライバシーのページの保存の直後に行が読めない')
    return result
  }),
}
