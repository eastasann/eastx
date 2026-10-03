/**
 * 作品・プロジェクトの詳細ページの有無（SDD 6.3）。詳細本文が日英のどちらかにあれば詳細ページを持つ。
 * 公開側のカードの行き先と、管理画面の一覧の「詳細ページの有無」列が共有する。
 */
import { isFilled } from './languages'

export function hasDetailPage(bodyJa: string | null, bodyEn: string | null): boolean {
  return isFilled(bodyJa) || isFilled(bodyEn)
}
