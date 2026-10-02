# eastx — ドキュメント

個人のレジュメ／ポートフォリオサイト eastasian を、「自作CMS＋フロント」の構成のまま作り直し、ブログやコーディング記録も載せられる場所にする（https://x.eastasian.dev）。

## 読み順ガイド

初めて読む人は、次の順に読む。

1. `design-spec.md` と `screen_flow.mermaid` — 何を作るか（画面・ロール・振る舞い）
2. `01_prd.md` — なぜ作るか、誰のためか、成功の基準
3. `02-01_system-design-doc.md` — どう作るか（技術選定・API・データモデル・セキュリティ）
4. `03_dev-setup.md` — 手元で動かす
5. 必要に応じて `06_design-tokens.json`（見た目の値）、`04_deployment-procedure.md`（リリース）、`05_operation-runbook.md`（運用）

## ドキュメント一覧

| ファイル | 内容 |
|---|---|
| [concept.md](concept.md) | Phase 0 のコンセプトメモ（何を・誰のために・なぜ） |
| [brainstorm-notes.md](brainstorm-notes.md) | Phase 1 の壁打ちの合意事項 |
| [design-spec.md](design-spec.md) | 設計仕様書。ロール、画面一覧、デザインシステムの方針、各画面の仕様、デモデータ |
| [screen_flow.mermaid](screen_flow.mermaid) | 画面遷移図 |
| [01_prd.md](01_prd.md) | PRD。背景と目的、ターゲット、ユーザーストーリー、KPI、スコープ外 |
| [02-01_system-design-doc.md](02-01_system-design-doc.md) | System Design Doc。ADR、アーキテクチャ、ルーティング、API、データモデル、セキュリティ、エラー、i18n、テスト、監視 |
| [02-02_feature-design-doc.md](02-02_feature-design-doc.md) | Feature Design Doc のテンプレート（変更サイクルで使う。埋めない） |
| [03_dev-setup.md](03_dev-setup.md) | 開発環境の構築、環境変数、make のターゲット、ブランチ戦略とリリースフロー、コミット規約 |
| [04_deployment-procedure.md](04_deployment-procedure.md) | CI/CD、初回のクラウド準備、リリース前チェック、ロールバック |
| [05_operation-runbook.md](05_operation-runbook.md) | ログと監視、よくある障害と対処、定期メンテナンス |
| [06_design-tokens.json](06_design-tokens.json) | デザイントークン（DTCG 形式。プリミティブ＋セマンティック、ライト／ダーク） |

### features/

変更サイクル（`/draft:feature`）で作る Feature Design Doc を、時系列で置くディレクトリ。最初の FDD を作るときにできる。個別の FDD はこの一覧に載せない。

## ドキュメント体系

### 3つの層

| 層 | 何か | 該当するもの | 更新のしかた |
|---|---|---|---|
| ソース | 事実の正。変更はまずここに入れる | `design-spec.md`、`screen_flow.mermaid`、`01_prd.md`、`02-01_system-design-doc.md`、`03`〜`05`、`06_design-tokens.json` | 事実の持ち主のドキュメントだけを更新する（下の所有権マップ） |
| 派生 | ソースから作るもの。手で直さない | Phase 4 で作る `CLAUDE.md` と実装プロンプト集、`06_design-tokens.json` から生成する Panda のトークン、コントラクトから生成する OpenAPI の仕様、`02-02` から作る各 FDD の雛形 | ソースを直してから作り直す |
| アーカイブ | 決めた経緯の記録。今の事実の正ではない | `concept.md`、`brainstorm-notes.md`、実装を終えた `features/` の FDD | 更新しない（食い違っても直さず、ソースを正とする） |

### 事実の所有権マップ

同じ事実は1つのドキュメントにだけ書き、ほかは参照にする。

| 事実 | 持ち主 |
|---|---|
| 目的・ターゲット・ユーザーストーリー・KPI・製品としてのスコープ外 | `01_prd.md` |
| ロール、画面の存在・目的・レイアウト・認証要否、画面の振る舞いと文言、i18n の仕様、デモデータ、機能の拡張候補 | `design-spec.md` |
| 画面遷移 | `screen_flow.mermaid` |
| 技術選定（ADR）、アーキテクチャ、ルーティング（URL）、API、データモデル、権限マトリクス、エラーの形式、テスト戦略、監視の道具 | `02-01_system-design-doc.md` |
| デザイントークンの具体値（色・文字・余白・角丸・影・動き・縦横比） | `06_design-tokens.json`（方針は `design-spec.md` 4.4、ブレークポイントは同 4.3） |
| 開発環境、環境変数の一覧、make のターゲット名、ブランチ戦略、コミット・PR の規約 | `03_dev-setup.md` |
| 実際のコマンド | `Makefile`（Phase 5 で作る） |
| デプロイの仕組み、初回のクラウド準備、ロールバックの手順 | `04_deployment-procedure.md` |
| アラートの閾値、障害対応、定期メンテナンス | `05_operation-runbook.md` |
| 個々の変更の設計 | `features/` の FDD（実装後、事実は上のソースへ反映する） |

## 省略した成果物

なし（Phase 3 の7ドキュメントをすべて作った）。
