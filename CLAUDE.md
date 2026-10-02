# eastx

個人のレジュメ／ポートフォリオサイト eastasian の作り直し。日英2言語の公開サイトと自作の CMS（管理画面）を、1つの Cloudflare Worker で動かす（https://x.eastasian.dev）。

## Tech Stack

- Frontend: TanStack Start（React、TypeScript）。公開側は SSR、管理画面（`/admin/*`）は `ssr: false`
- Styling: Panda CSS（strictTokens）＋ Ark UI。エディタは CodeMirror 6、並べ替えは dnd-kit
- Backend: Elysia（Cloudflare Worker アダプター）＋ oRPC（コントラクト先行、OpenAPIHandler の REST）＋ Zod v4。管理画面は TanStack Query ＋ TanStack Form
- DB: Cloudflare D1 ／ Drizzle ORM（drizzle-kit でマイグレーションを生成し、wrangler で適用）
- Auth: Better Auth（GitHub OAuth、DB セッション。管理者は `ADMIN_GITHUB_USER_ID` で決まる）
- Storage: Cloudflare R2（`/media/*` から配信）
- Markdown: unified（remark-gfm・rehype-sanitize）＋ Shiki
- Infra: Cloudflare Workers（Paid）、Workers Static Assets、Rate Limiting バインディング
- IaC: なし（`wrangler.jsonc`）
- CI/CD: GitHub Actions ＋ wrangler。staging・本番とも昇格 PR（`deploy/{環境}/version`）でデプロイ
- Tooling: Bun（パッケージ管理・スクリプト）、Node.js 24（wrangler・Vite・Vitest）、Biome、Vitest（`@cloudflare/vitest-pool-workers`）、Playwright、Lighthouse CI
- Monitoring: Workers Logs ＋ Sentry
- Monorepo: なし（単一パッケージ）

## Structure

- `src/server.ts`: Worker の入口。`/api/*`・`/media/*` を Elysia へ、それ以外を TanStack Start へ
- `src/api/`: CMS API（`contract/` がコントラクト、`router/` が実装、`middleware/`、`media.ts`）
- `src/auth/`: Better Auth の設定（server・client）
- `src/db/`: Drizzle のスキーマとクライアント
- `src/domain/`: 純粋関数（スラッグ・言語あり・抜粋・公開のルール）
- `src/content/`: 公開側のサーバー関数と、表示用の形への変換
- `src/markdown/`、`src/i18n/`: 描画と辞書・日付の書式（公開側と管理画面で共通）
- `src/routes/`: ルート。`src/site/`（公開側の部品）、`src/admin/`（管理画面の部品）、`src/ui/`（共通の部品）
- `scripts/`: トークンの変換、シード、データ移行、昇格、doc-lint
- `drizzle/migrations/`: マイグレーションの SQL。`deploy/`: 環境ごとのバージョン宣言ファイル
- 全体の構成は `docs/03_dev-setup.md` 2章

## Key Design Decisions

- 入口で API と UI を分ける。公開側はサーバー関数で公開中の中身だけを D1 から読み、CMS API を通さない。書き込みは管理画面から CMS API を通すだけ。公開側のコードから `src/admin/`・`src/api/` を import しない（ADR-001・005・020）
- CMS API はコントラクトが正。形を変えるときは SDD 5章とコントラクト（`src/api/contract/`）を先に直す。認証・レート制限・認可は 5.1 のミドルウェアで全手続きに一律にかけ、手続きごとに付け外ししない
- 見た目はデザイントークンのセマンティック層だけで指定する。色・余白などの値を直接書かず、プリミティブ層も参照しない。値を変えるときは `docs/06_design-tokens.json` を直して `make tokens`（ADR-014）
- 日英は `_ja`／`_en` のカラムで持ち、言語の代替は `src/content/localize.ts`、固定文言は `src/i18n/messages/` の辞書、日時は Asia/Tokyo。仕様の正は design-spec 1.4
- D1 には対話的なトランザクションがない。一緒に確定する書き込みは1回の `db.batch()` で送り、最後の守りは一意インデックスと CHECK 制約。マイグレーションは前進のみで、古いコードでも動く形にする（`docs/03_dev-setup.md` 4章）

## Commands

- `make setup`: 初回セットアップ（依存、`.dev.vars`、生成、ローカル D1、Playwright）
- `make dev`: 開発サーバー（http://localhost:3000）
- `make build`: 本番用のビルド（`CLOUDFLARE_ENV` で環境を選ぶ）
- `make test`: ユニットテストと結合テスト
- `make e2e`: E2E・アクセシビリティ・Lighthouse の検査
- `make lint`: Biome とプリミティブ層の参照の検査
- `make typecheck`: 型チェック
- `make format`: フォーマット
- `make tokens`: デザイントークンから Panda のトークンを生成
- `make db-generate`: マイグレーション SQL の生成
- `make db-migrate`: ローカル D1 へのマイグレーションの適用
- `make db-seed`: デモデータの投入（`make db-seed-empty` はブログ・記録を0件にしたもの）
- `make db-reset`: ローカル D1 の作り直し
- `make db-studio`: Drizzle Studio
- `make doc-lint`: ドキュメントと実体の整合検査（コミット前の検査は pre-commit フックが走らせる）
- `make promote ENV=staging`: 昇格 PR 用のブランチとバージョンファイルを作る

## Docs

Detailed specifications are in `docs/`. This file and `docs/claude-code-prompts.md` are derived from `docs/`. If they disagree, `docs/` is the source of truth:

- `docs/README.md`: ドキュメントの入口。どの事実をどのドキュメントが持つか（所有権マップ）
- `docs/design-spec.md`: 画面一覧・画面の振る舞いと文言・デザインシステムの方針・i18n の仕様・デモデータ（画面遷移は `docs/screen_flow.mermaid`）
- `docs/01_prd.md`: ユーザーストーリー、KPI、スコープ外
- `docs/02-01_system-design-doc.md`: ADR、アーキテクチャ、ルーティング、API、データモデル、セキュリティ、エラー、テスト戦略
- `docs/02-02_feature-design-doc.md`: 変更サイクルの FDD のテンプレート
- `docs/03_dev-setup.md`: リポジトリ構成、環境変数、make のターゲット、ブランチ戦略、コミット規約
- `docs/04_deployment-procedure.md`: CI/CD、初回のクラウド準備、ロールバック
- `docs/05_operation-runbook.md`: 監視、障害対応、定期メンテナンス
- `docs/06_design-tokens.json`: デザイントークン（DTCG 形式。スタイルの値の正。実装のテーマはここから生成し、セマンティック層だけを参照する）

## Implementation Rules

- **先送りしない。完了とは残作業がゼロの状態。** TODO/FIXMEコメント、固定値やモックを返す仮実装、握りつぶした例外、通していない経路、完了報告の「今後の課題」節は、すべて先送りの言い換えでしかない。禁止しているのは形ではなく先送りそのもの。残したくなったら設計に曖昧さがあるサインなので、実装を止めて確認し、設計ドキュメントに反映してから実装する
- **設計の不備を実装で回避しない。** 「設計ドキュメントの記述では要件が満たせない・記述同士が矛盾している・必要な決定が欠けている」と気づいたら、実装側の回避策で辻褄を合わせて進まない。手を止めて不備の内容・影響・直し方を提示し、合意の上で設計ドキュメントを直してから、直った設計を入力に実装を再開する
- **スコープを黙って縮めない。** 縮める判断はユーザーのもの。合意を取り、残りをドキュメントに書き出してから完了とする
- **合意を求めることを完了の代わりにしない。** 合意が要るのはユーザーのスコープを縮めるときだけ。自分の変更が作った穴・自分で見つけた欠陥は、「これも直しますか」と聞かずにその場で閉じる。それは縮小ではなく完了条件
- **残すときは、閉じられない理由を具体的に挙げる。** 「後で」ではなく何がブロックしているか（ユーザーの決定が要る／認証情報や外部リソースが無い／別の作業に依存する）を、先送りするその時点で述べる。理由を具体的に挙げられないなら閉じられるということなので閉じる。残す先はリポジトリ内のファイルだけ。ファイルに書かれていないものは残っておらず、消えている（チャットや完了報告での言及は記録ではない）
- **場当たり的な修正をしない。** エラーやバグは症状を抑えるパッチではなく、根本原因を特定し、原因と修正方針を提示してから直す。症状だけ抑えるパッチは原因の解決を後ろに送る先送りの一形態。設計に関わる修正はユーザーの合意を得てから行う
- **ライブラリの使い方を推測で書かない。** TanStack Start・Elysia の Workers アダプター・oRPC・Better Auth・Panda は版によって API が変わる。`package.json` で固定した版のドキュメントか型定義を確かめてから書く。SDD のコード例は要点を示すもので、細部は固定した版に合わせる。ADR-022 のスパイクで代わりの案に切り替えたら、その ADR を先に直す
- **コメントはコードから読み取れないことだけを書く。** 処理の言い換え（`// ユーザーを取得する` の直後に `getUser()`）は書かない。書くのは「なぜこの実装なのか」「不変条件」「外部制約」「呼び出し側の契約」。密度と体裁は周囲の既存コードに合わせる
- **不要になった `.gitkeep` は削除する。** ディレクトリに実ファイルを追加したら、その中の `.gitkeep` を消す
- **自動メモリに docs/ が所有する事実を転記しない。** MEMORY.md等、ツールがセッション外に蓄積するメモが対象。食い違ったらソースDocが正
- **実装セッションに本番環境の資格情報を渡さない。** 本番への操作は `docs/04_deployment-procedure.md` の手順で行う（セッションが本番リソースへ直接触れる構成にしない）。staging・本番の D1・R2 に対する `--remote` の操作もしない
- **破壊的操作は実行前に明示して確認を取る。** DBのdrop/reset、`rm -rf`、本番リソースの変更は、対象と影響を提示してユーザーの確認を得てから実行する。ローカルの `make db-reset` も、手で入れたデータがあれば先に確認する

## Code Style

- コミットメッセージ: 英語の命令形。1行目に変更の意図を書く。Conventional Commits の接頭辞は付けない（既存の履歴に合わせる）
- コミットのトレーラーは付けない（`Co-Authored-By`、セッションURL等）。ツールや実行環境が既定で付けようとする場合も、この規約が優先する
- コミットのサブジェクトは50字を目安に、72字を超えない。本文は空行を挟んで表示幅72カラムで折り返す（全角は2カラム）
- **コミット本文はdiffから読み取れないことだけを書く。** 書くのは「なぜ変えたか」「採らなかった案」「どこまで検証したか」。変更ファイルの一覧やバージョン番号の更新は `git show --stat` の仕事。長さを既存の履歴に合わせない（直前のコミットを基準にすると単調に膨らむ）
- Biome（lint とフォーマット）と TypeScript strict。設定は `docs/03_dev-setup.md` 10章
- コード中のコメントは日本語で書く（SDD のスキーマの例に合わせる）。公開する関数・型の契約は TSDoc（`/** */`）で書き、`NOTE:` などの接頭辞は使わない
- 日時は API では ISO 8601 の文字列、DB では UNIX ミリ秒、年月は `YYYY-MM` の文字列で扱う（SDD 5.0・6.1）

## Docs Style

<!-- ドキュメントを書くときの規約。決定論的な違反（本文のem dash・表1列目の太字・長すぎる太字）は `make doc-lint` が検出する。 -->

- **テクニカルドキュメントとして書く。** 読んだ人が作業できることだけが目的。装飾・誇張・前置き・総括は情報を足さないので書かない
- **和文の本文でem dashを使わない。** 挿入句の区切りは読点・括弧・文の分割に置き換える。項目と説明を並べるリストは `ラベル: 説明` の形にする
- **太字は段落の頭の短いラベルとUI要素にだけ使う。** 文や表の1列目を太字で覆うと、強調された語が消える
- **対句（「AではなくB」）は意味を運ぶときだけ残す。** リズムのために置くと、対比の無い所に対比があるように読める
- **無生物主語と名詞止めは動詞で言い切る。** 「データは〜を示している」「〜の実施が重要である」は英語構文の残骸
- **概念の名前に英語の直訳をあてない。** 「人手を挟まず」(without human intervention) のような句は、日本語の用法から意味を確定できない。日常の会話にある言い回しから選び、無ければ用語として定義する

<!-- DRAFT: v0.43.0 -->
