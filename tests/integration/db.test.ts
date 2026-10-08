import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'

// スキーマの最後の守り（SDD 6.1・ADR-006）が D1 の上で実際に効くことを確かめる。
// drizzle-kit が出した SQL をそのまま当てた D1（tests/integration/setup.ts）に対して、生の SQL で書き込む

const NOW = Date.now()

/** 1行を insert する。`values` に無いカラムは既定値か NULL になる */
async function insert(table: string, values: Record<string, string | number | null>): Promise<void> {
  const row: Record<string, string | number | null> = {
    id: crypto.randomUUID(),
    created_at: NOW,
    updated_at: NOW,
    ...values,
  }
  const cols = Object.keys(row)
  await env.DB.prepare(`insert into ${table} (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`)
    .bind(...Object.values(row))
    .run()
}

const work = (values: Record<string, string | number | null>) =>
  insert('work', { title_ja: '作品', sort_order: 0, ...values })

describe('CHECK 制約: スラッグの形式', () => {
  it.each([
    ['大文字', 'My-App'],
    ['空白', 'my app'],
    ['アンダースコア', 'my_app'],
    ['日本語', 'さくひん'],
    ['空文字', ''],
  ])('%s を含むスラッグは入らない', async (_, slug) => {
    await expect(work({ slug })).rejects.toThrow(/CHECK constraint failed: work_slug_format/)
  })

  it('英小文字・数字・ハイフンだけのスラッグは入る', async () => {
    await expect(work({ slug: 'my-app-2' })).resolves.toBeUndefined()
  })

  it('下書きならスラッグは NULL でよく、NULL どうしは一意インデックスで重複とみなさない', async () => {
    await expect(work({ slug: null })).resolves.toBeUndefined()
    await expect(work({ slug: null })).resolves.toBeUndefined()
  })

  it('同じスラッグは一意インデックスで入らない', async () => {
    await work({ slug: 'dup-slug' })
    await expect(work({ slug: 'dup-slug' })).rejects.toThrow(/UNIQUE constraint failed: work\.slug/)
  })

  it('使用技術のカテゴリは4つのどれか', async () => {
    await expect(
      insert('stack', { key: 'cat-bad', display_name: 'x', sort_order: 0, category: 'databases' }),
    ).rejects.toThrow(/CHECK constraint failed: stack_category/)
  })

  it('使用技術の key も同じ形式', async () => {
    await expect(insert('stack', { key: 'Next.js', display_name: 'Next.js', sort_order: 0 })).rejects.toThrow(
      /CHECK constraint failed: stack_key_format/,
    )
  })
})

describe('CHECK 制約: 公開時に必須の項目', () => {
  it('公開の作品はスラッグが要る', async () => {
    await expect(work({ status: 'published', slug: null })).rejects.toThrow(
      /CHECK constraint failed: work_published_slug/,
    )
  })

  it('公開のプロジェクトはスラッグが要る', async () => {
    await expect(
      insert('project', { title_ja: 'P', start_date: '2024-04', status: 'published', sort_order: 0 }),
    ).rejects.toThrow(/CHECK constraint failed: project_published_slug/)
  })

  it('公開のプロジェクトは開始年月が要る', async () => {
    await expect(
      insert('project', { title_ja: 'P', slug: 'p-no-start', status: 'published', sort_order: 0 }),
    ).rejects.toThrow(/CHECK constraint failed: project_published_start/)
  })

  it('公開の経歴は開始年月が要る', async () => {
    await expect(insert('career', { title_ja: '職歴', status: 'published' })).rejects.toThrow(
      /CHECK constraint failed: career_published_start/,
    )
  })

  it.each(['blog_post', 'coding_log'])('公開の %s はスラッグと公開日が要る', async (table) => {
    await expect(
      insert(table, { title_ja: 'T', status: 'published', slug: `${table.replace('_', '-')}-x` }),
    ).rejects.toThrow(new RegExp(`CHECK constraint failed: ${table}_published`))
    await expect(insert(table, { title_ja: 'T', status: 'published', published_at: NOW })).rejects.toThrow(
      new RegExp(`CHECK constraint failed: ${table}_published`),
    )
  })

  it('タイトルは日英のどちらかが要る（下書きでも）', async () => {
    await expect(insert('work', { sort_order: 0 })).rejects.toThrow(/CHECK constraint failed: work_title_required/)
  })

  it('status は draft と published だけ', async () => {
    await expect(work({ status: 'archived' })).rejects.toThrow(/CHECK constraint failed: work_status/)
  })

  it('終了年月は開始年月より前にできない', async () => {
    await expect(insert('career', { title_ja: '職歴', start_date: '2024-04', end_date: '2024-03' })).rejects.toThrow(
      /CHECK constraint failed: career_period/,
    )
  })

  it.each(['2024/04', '2024-00', '2024-13', '2024-4'])(
    '年月は YYYY-MM の形で月は 01〜12（%s は入らない）',
    async (start_date) => {
      await expect(insert('career', { title_ja: '職歴', start_date })).rejects.toThrow(
        /CHECK constraint failed: career_start_date/,
      )
    },
  )

  it('プロフィールは1件だけ', async () => {
    await insert('profile', { name_ja: '名前' })
    await expect(insert('profile', { name_ja: '名前2' })).rejects.toThrow(
      /UNIQUE constraint failed: profile\.singleton/,
    )
  })
})

describe('CHECK 制約: URL', () => {
  it.each([
    ['link_url', 'http://example.com', 'work_link_url'],
    ['github_url', 'javascript:alert(1)', 'work_github_url'],
    ['thumbnail_url', 'https://example.com/a.png', 'work_thumbnail_url'],
  ])('%s に %s は入らない', async (col, value, constraint) => {
    await expect(work({ [col]: value })).rejects.toThrow(new RegExp(`CHECK constraint failed: ${constraint}`))
  })

  it.each([
    ['project', { title_ja: 'P', sort_order: 0, link_url: 'http://example.com' }, 'project_link_url'],
    ['project', { title_ja: 'P', sort_order: 0, thumbnail_url: '/MEDIA/x.png' }, 'project_thumbnail_url'],
    ['stack', { key: 'url-a', display_name: 'A', sort_order: 0, link_url: 'ftp://example.com' }, 'stack_link_url'],
    ['stack', { key: 'url-b', display_name: 'B', sort_order: 0, icon_url: '/media-x/a.svg' }, 'stack_icon_url'],
    ['coding_log', { title_ja: 'T', reference_url: 'HTTPS://example.com' }, 'coding_log_reference_url'],
    ['profile', { name_ja: '名前', avatar_url: 'https://example.com/a.png' }, 'profile_avatar_url'],
  ] as const)('%s: %o は入らない（%s）', async (table, values, constraint) => {
    await expect(insert(table, values)).rejects.toThrow(new RegExp(`CHECK constraint failed: ${constraint}`))
  })

  it('外部リンクは https、画像は /media/ で始まるパスなら入る', async () => {
    await expect(
      work({
        link_url: 'https://example.com',
        github_url: 'https://github.com/example/x',
        thumbnail_url: '/media/uploads/2026/10/x.png',
      }),
    ).resolves.toBeUndefined()
  })

  it('SNS リンクは https で、other のときは表示名が要る', async () => {
    await expect(
      insert('social_link', { service: 'github', url: 'http://github.com/x', sort_order: 0 }),
    ).rejects.toThrow(/CHECK constraint failed: social_link_url/)
    await expect(
      insert('social_link', { service: 'other', url: 'https://example.com', sort_order: 0 }),
    ).rejects.toThrow(/CHECK constraint failed: social_link_other_label/)
  })
})

describe('外部キー: ON DELETE CASCADE', () => {
  async function count(sql: string, id: string): Promise<number> {
    const row = await env.DB.prepare(sql).bind(id).first<{ n: number }>()
    return row?.n ?? -1
  }

  it('作品を消すと work_stack の行も消え、使用技術は残る', async () => {
    const workId = crypto.randomUUID()
    const stackId = crypto.randomUUID()
    await work({ id: workId })
    await insert('stack', { id: stackId, key: 'cascade-a', display_name: 'A', sort_order: 0 })
    await env.DB.prepare('insert into work_stack (work_id, stack_id, sort_order) values (?, ?, 0)')
      .bind(workId, stackId)
      .run()

    await env.DB.prepare('delete from work where id = ?').bind(workId).run()

    expect(await count('select count(*) as n from work_stack where work_id = ?', workId)).toBe(0)
    expect(await count('select count(*) as n from stack where id = ?', stackId)).toBe(1)
  })

  it('使用技術を消すと work_stack・project_stack の行が消え、作品・プロジェクトは残る', async () => {
    const workId = crypto.randomUUID()
    const projectId = crypto.randomUUID()
    const stackId = crypto.randomUUID()
    await work({ id: workId })
    await insert('project', { id: projectId, title_ja: 'P', sort_order: 0 })
    await insert('stack', { id: stackId, key: 'cascade-b', display_name: 'B', sort_order: 0 })
    await env.DB.batch([
      env.DB.prepare('insert into work_stack (work_id, stack_id, sort_order) values (?, ?, 0)').bind(workId, stackId),
      env.DB.prepare('insert into project_stack (project_id, stack_id, sort_order) values (?, ?, 0)').bind(
        projectId,
        stackId,
      ),
    ])

    await env.DB.prepare('delete from stack where id = ?').bind(stackId).run()

    expect(await count('select count(*) as n from work_stack where stack_id = ?', stackId)).toBe(0)
    expect(await count('select count(*) as n from project_stack where stack_id = ?', stackId)).toBe(0)
    expect(await count('select count(*) as n from work where id = ?', workId)).toBe(1)
    expect(await count('select count(*) as n from project where id = ?', projectId)).toBe(1)
  })

  it('管理者を消すとセッションとアカウントの紐づけも消える', async () => {
    const userId = crypto.randomUUID()
    await insert('admin_user', {
      id: userId,
      name: 'admin',
      email: 'admin@example.com',
      github_user_id: '1',
      github_login: 'admin',
    })
    await insert('admin_session', { user_id: userId, token: 'tok', expires_at: NOW + 1000 })
    await insert('admin_account', { user_id: userId, account_id: '1', provider_id: 'github' })

    await env.DB.prepare('delete from admin_user where id = ?').bind(userId).run()

    expect(await count('select count(*) as n from admin_session where user_id = ?', userId)).toBe(0)
    expect(await count('select count(*) as n from admin_account where user_id = ?', userId)).toBe(0)
  })

  it('存在しない作品への紐づけは入らない（外部キーが有効）', async () => {
    const stackId = crypto.randomUUID()
    await insert('stack', { id: stackId, key: 'cascade-c', display_name: 'C', sort_order: 0 })
    await expect(
      env.DB.prepare('insert into work_stack (work_id, stack_id, sort_order) values (?, ?, 0)')
        .bind(crypto.randomUUID(), stackId)
        .run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/)
  })
})

describe('マイグレーション: 使用技術のカテゴリと Core', () => {
  it('category は既定値 tools・NOT NULL、is_core は既定値 false・NOT NULL', async () => {
    const { results } = await env.DB.prepare('pragma table_info(stack)').all<{
      name: string
      notnull: number
      dflt_value: string | null
    }>()
    const column = (name: string) => results.find((row) => row.name === name)
    expect(column('category')).toMatchObject({ notnull: 1, dflt_value: "'tools'" })
    expect(column('is_core')).toMatchObject({ notnull: 1, dflt_value: 'false' })
  })

  it('2つのカラムを書かない insert（古いコードの insert）は Tools・0 で入る', async () => {
    await insert('stack', { key: 'old-code', display_name: 'Old', sort_order: 0 })
    const row = await env.DB.prepare("select category, is_core from stack where key = 'old-code'").first()
    expect(row).toEqual({ category: 'tools', is_core: 0 })
  })
})
