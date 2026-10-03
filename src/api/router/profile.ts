import { asc } from 'drizzle-orm'
import { profile, socialLink } from '../../db/schema'
import { languagesOf } from '../../domain/languages'
import { admin, db, toIso } from './base'

async function readProfile() {
  const d = db()
  const [rows, links] = await d.batch([
    d.select().from(profile).limit(1),
    d.select().from(socialLink).orderBy(asc(socialLink.sortOrder)),
  ])
  const row = rows[0]
  if (!row) return null
  const ja = { name: row.nameJa, headline: row.headlineJa, bio: row.bioJa }
  const en = { name: row.nameEn, headline: row.headlineEn, bio: row.bioEn }
  return {
    id: row.id,
    ja,
    en,
    avatarUrl: row.avatarUrl,
    socialLinks: links.map((link) => ({ service: link.service, url: link.url, label: link.label })),
    languages: languagesOf('name', ja, en),
    updatedAt: toIso(row.updatedAt),
  }
}

export const profileRouter = {
  get: admin.profile.get.handler(async ({ errors }) => {
    const result = await readProfile()
    if (!result) throw errors.NOT_FOUND()
    return result
  }),

  update: admin.profile.update.handler(async ({ input }) => {
    const d = db()
    const now = new Date()
    const values = {
      nameJa: input.ja.name,
      nameEn: input.en.name,
      headlineJa: input.ja.headline,
      headlineEn: input.en.headline,
      bioJa: input.ja.bio,
      bioEn: input.en.bio,
      avatarUrl: input.avatarUrl,
    }
    // プロフィールの行（1件だけ）の upsert と SNS リンクの置き換えを、1回の batch でまとめて確定する（SDD 5.5）
    const linkRows = input.socialLinks.map((link, i) => ({ ...link, sortOrder: i }))
    await d.batch([
      d
        .insert(profile)
        .values({ singleton: 1, ...values })
        .onConflictDoUpdate({ target: profile.singleton, set: { ...values, updatedAt: now } }),
      d.delete(socialLink),
      // 1つの文のパラメーターは100個までなので、SNS リンクは1行ずつ入れる（ADR-006）
      ...linkRows.map((row) => d.insert(socialLink).values(row)),
    ])
    const result = await readProfile()
    if (!result) throw new Error('プロフィールの保存の直後に行が読めない')
    return result
  }),
}
