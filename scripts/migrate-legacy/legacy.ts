/**
 * 今のサイト（https://eastasian.vercel.app/）のトップページに埋め込まれた `__NEXT_DATA__` の形（design-spec 9章）。
 * 日英は別のページではなく、1つのページの中に英語のフィールドと `…Jp` のフィールドとして両方が入っている。
 * 形が想定と違えば変換に進まずに止まるよう、使うフィールドを Zod で確かめる。
 */
import { z } from 'zod'

export const LEGACY_SITE_URL = 'https://eastasian.vercel.app/'
/** 今の画像（写真・技術アイコン）の置き場（design-spec 9章） */
export const LEGACY_IMAGE_HOST = 'plmzmwpmjruswencnerh.supabase.co'

/** 今の DB は空の値を空文字で持つ。null が入っている所もある */
const text = z.string().nullable()
const isoDateTime = z.iso.datetime()

const legacyStack = z.object({
  id: z.uuid(),
  name: z.string(),
  displayName: z.string(),
  link: text,
  stackImage: text,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

const legacyCareer = z.object({
  id: z.uuid(),
  title: text,
  titleJp: text,
  body: text,
  bodyJp: text,
  organization: text,
  location: text,
  startDate: isoDateTime.nullable(),
  endDate: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
})

const legacyWork = z.object({
  id: z.uuid(),
  title: text,
  titleJp: text,
  body: text,
  bodyJp: text,
  link: text,
  github: text,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  stacks: z.array(legacyStack),
})

const legacyProject = z.object({
  id: z.uuid(),
  title: text,
  titleJp: text,
  body: text,
  bodyJp: text,
  link: text,
  startDate: isoDateTime.nullable(),
  endDate: isoDateTime.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  stacks: z.array(legacyStack),
})

const legacyResume = z.object({
  id: z.uuid(),
  name: text,
  nameJp: text,
  profileImage: text,
  description: text,
  descriptionJp: text,
  snsInstagram: text,
  snsLinkedin: text,
  snsGithub: text,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  experiences: z.array(legacyCareer),
  education: z.array(legacyCareer),
  works: z.array(legacyWork),
  projects: z.array(legacyProject),
  /** トップの「使用技術」の欄。仕事（production）と個人開発（sideProject）の2つに分かれ、同じ技術が両方に出る */
  stacks: z.object({ production: z.array(legacyStack), sideProject: z.array(legacyStack) }),
})

export type LegacyResume = z.infer<typeof legacyResume>
export type LegacyStack = z.infer<typeof legacyStack>

/**
 * 取り出した件数（新しいテーブルごと）。変換の結果からではなく今のデータから数え、D1 に入った件数と照合する（verify.ts）
 */
export function legacyCounts(resume: LegacyResume): Record<string, number> {
  const stackIds = new Set(
    [
      ...resume.stacks.production,
      ...resume.stacks.sideProject,
      ...resume.works.flatMap((w) => w.stacks),
      ...resume.projects.flatMap((p) => p.stacks),
    ].map((s) => s.id),
  )
  return {
    profile: 1,
    social_link: [resume.snsInstagram, resume.snsLinkedin, resume.snsGithub].filter((u) => u?.trim()).length,
    career: resume.experiences.length + resume.education.length,
    stack: stackIds.size,
    work: resume.works.length,
    work_stack: resume.works.reduce((n, w) => n + w.stacks.length, 0),
    project: resume.projects.length,
    project_stack: resume.projects.reduce((n, p) => n + p.stacks.length, 0),
  }
}

const nextData = z.object({ props: z.object({ pageProps: z.object({ resume: legacyResume }) }) })

/** ページの HTML から `__NEXT_DATA__` を取り出し、形を確かめて返す */
export function extractResume(html: string): LegacyResume {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/)
  if (!match?.[1]) throw new Error('ページに __NEXT_DATA__ が無い')
  return nextData.parse(JSON.parse(match[1])).props.pageProps.resume
}
