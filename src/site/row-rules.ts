/**
 * トップの行の規則（design-spec 6.1.3・6.1.4）。公開側の表示だけの規則なので、管理画面と共通の `src/domain/` には置かない
 */
import type { CareerItem, ProjectItem, WorkItem } from '~/content/types'

export type ExpandableRow =
  | { section: 'careers'; item: CareerItem }
  | { section: 'projects'; item: ProjectItem }
  | { section: 'works'; item: WorkItem }

/**
 * 行を広げられるか。広げた中に出すもの（入口のリンクを含む）が1つでもあれば広げられる。
 * 経歴は種類ラベルを、プロジェクトは期間をいつも持つので、いつも広げられる
 */
export function isExpandable(row: ExpandableRow): boolean {
  if (row.section !== 'works') return true
  const { item } = row
  return (
    item.thumbnailUrl !== null ||
    item.summary !== null ||
    item.stacks.length > 0 ||
    item.hasDetail ||
    item.linkUrl !== null ||
    item.githubUrl !== null
  )
}
