## 概要

<!-- 何を・なぜ変えるのかを1〜3行で -->

## 関連ドキュメント

<!-- FDD や設計ドキュメントへのリンク。なければ「なし」 -->
- FDD: `docs/features/...`
- 設計: `docs/...`

## 変更内容

-

## 動作確認

<!-- 実施した確認を書く。実施していないものは消す -->
- [ ] `make lint` / `make typecheck` / `make test`
- [ ] `make e2e`
- [ ] ローカル（`make dev`）で画面を確認:

## チェックリスト

- [ ] セルフレビュー済み
- [ ] 関連ドキュメントを更新済み（事実の持ち主は `docs/README.md` の所有権マップ）
- [ ] スキーマ変更がある場合、生成したマイグレーションの SQL を読み、古いコードのままでも壊れない形になっていることを確認済み

<!--
昇格 PR（deploy/staging/version・deploy/production/version の更新）の場合は、上の代わりに次を書く:
- 対象: 環境（staging / production）と SHA、含まれる変更（前回の SHA からの PR の一覧）
- staging での確認結果（production のとき）: 確認した画面・コアフロー
- マイグレーション・環境変数・シークレットの追加の有無
- ロールバック手順: この PR を revert する（緊急時は docs/04_deployment-procedure.md 5章）
-->
