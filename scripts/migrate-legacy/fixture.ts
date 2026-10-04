/** テスト用の今のサイトのデータ。今のサイトで実際に見つかった形（空文字・null・識別名の空白や大文字）を入れる */
import type { LegacyResume, LegacyStack } from './legacy'

const T = '2022-11-06T07:02:26.328Z'
const IMG = 'https://plmzmwpmjruswencnerh.supabase.co/storage/v1/object/public'

export const stackOf = (n: number, name: string, extra: Partial<LegacyStack> = {}): LegacyStack => ({
  id: `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`,
  name,
  displayName: name,
  link: '',
  stackImage: `${IMG}/stacks/${name.replace(/\s/g, '-')}.svg`,
  createdAt: T,
  updatedAt: T,
  ...extra,
})

const ts = stackOf(1, 'typescript', { displayName: 'TypeScript' })
const atomic = stackOf(2, 'atomic design', { displayName: 'Atomic Design' })
const sap = stackOf(3, 'SAP', { stackImage: '' })
const node = stackOf(4, 'node', { displayName: 'Node.js', link: 'https://nodejs.org/en/' })
const mantine = stackOf(5, 'mantine', { displayName: 'Mantine UI' })
/** トップの欄には無く、プロジェクトにだけ紐づく技術 */
const bazel = stackOf(6, 'bazel', { displayName: 'Bazel', stackImage: null })

export const LONG_EN = 'a'.repeat(501)

export function legacyFixture(): LegacyResume {
  return {
    id: '552357d4-a772-409a-a849-fa3a6216cdd1',
    name: 'Jun Aida',
    nameJp: '會田 純',
    profileImage: `${IMG}/profiles/profile.jpg`,
    description: 'Web developer from Tokyo.\n',
    descriptionJp: '東京出身のWebエンジニア。',
    snsInstagram: '',
    snsLinkedin: 'https://www.linkedin.com/in/eastasian/',
    snsGithub: 'https://github.com/eastasann',
    createdAt: '2022-10-26T04:11:57.754Z',
    updatedAt: '2025-04-10T03:14:24.809Z',
    experiences: [
      {
        id: 'daede137-00b2-46b2-a727-c70cb3f1ce4d',
        title: 'Frontend Developer',
        titleJp: 'Frontend Developer',
        body: '',
        bodyJp: '',
        organization: 'Sun*',
        location: 'Tokyo, Japan',
        startDate: '2024-10-01T00:00:00.000Z',
        endDate: null,
        createdAt: T,
        updatedAt: T,
      },
    ],
    education: [
      {
        id: '6d38b126-7455-4719-ab4e-67af337c66c0',
        title: 'Bachelor in Engineering',
        titleJp: '工学士',
        body: "I researched a robot's leg mechanisms.",
        bodyJp: '脚機構を研究。',
        organization: 'Tamagawa Univ',
        location: null,
        startDate: '2015-04-01T00:00:00.000Z',
        endDate: '2019-03-18T00:00:00.000Z',
        createdAt: T,
        updatedAt: T,
      },
    ],
    works: [
      {
        id: 'b9525225-66a9-4888-82b6-ff212d41f6e1',
        title: 'eastasian.vercel.app',
        titleJp: 'eastasian.vercel.app',
        body: 'this self introduction page.',
        bodyJp: 'この自己紹介ページ。',
        link: 'https://eastasian.vercel.app/',
        github: '',
        createdAt: T,
        updatedAt: T,
        stacks: [mantine, ts, node],
      },
    ],
    projects: [
      {
        id: '388bb892-bcdd-4ff8-8996-2d7f3f6f6b0f',
        title: 'Online Exhibition Service',
        titleJp: 'オンライン展示会サービス',
        body: 'Joined as a front-end developer.\n',
        bodyJp: 'フロントエンドエンジニアとして途中参画。',
        link: '',
        startDate: '2019-07-18T00:00:00.000Z',
        endDate: '2019-12-31T00:00:00.000Z',
        createdAt: T,
        updatedAt: T,
        stacks: [ts, atomic],
      },
      {
        id: 'ddfb008d-e01f-49f8-b79f-4bd651bb4a66',
        title: 'Online Exhibition Service',
        titleJp: '長い説明のプロジェクト',
        body: LONG_EN,
        bodyJp: '短い説明。',
        link: '',
        startDate: '2024-12-02T00:00:00.000Z',
        endDate: null,
        createdAt: T,
        updatedAt: T,
        stacks: [sap, bazel],
      },
    ],
    stacks: { production: [ts, node, atomic, sap], sideProject: [mantine, ts, node] },
  }
}

/** 画像の置き直し先。テストではファイル名だけを使う */
export const fakeMediaPath = (url: string) => `/media/uploads/legacy/${url.split('/').pop()}`
