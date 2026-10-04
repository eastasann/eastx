# Dev Setup — eastx

技術の構成と選定理由は `docs/02-01_system-design-doc.md`（以下 SDD）が持つ。このドキュメントは、手元で開発を始めて、PR を出して、リリースするまでの手順を持つ。

## 1. 必要なツール・アカウント

### ツール

| ツール | バージョン | 用途 |
|--------|-----------|------|
| Bun | 1.3 以上 | パッケージ管理（`bun.lock`）、スクリプトの実行 |
| Node.js | 24（LTS） | wrangler・Vite・Vitest・Playwright・drizzle-kit の実行（SDD ADR-016） |
| Git | 2.40 以上 | |
| make | macOS・Linux に標準 | 主要コマンドの入口（8章）。Windows は WSL で使う |
| wrangler | 4 系（devDependencies に入る。別に入れなくてよい） | ローカルの Workers・D1・R2、デプロイ |
| Playwright の Chromium | `make setup` が入れる | E2E テスト |

### アカウント

| サービス | 用途 | ローカル開発で要るか |
|----------|------|-------------------|
| GitHub | リポジトリ、GitHub Actions、管理画面のログイン（OAuth App） | 要る（ログインを試すときに OAuth App を作る。6章） |
| Cloudflare | Workers・D1・R2・独自ドメイン（`eastasian.dev`） | 要らない（ローカルは wrangler が再現する）。デプロイの準備で使う（`docs/04_deployment-procedure.md`） |
| Sentry | エラー追跡・稼働監視 | 要らない（`SENTRY_DSN` が空なら送らない） |

---

## 2. リポジトリ構成

単一パッケージ（SDD ADR-020）。

```
eastx/
├── .githooks/pre-commit           # コミット前の検査（scripts/doc-lint.sh --staged）
├── .github/
│   ├── workflows/
│   │   ├── ci.yml                 # PR と main への push: lint・型・テスト・ビルド・E2E
│   │   └── deploy.yml             # deploy/*/version の変更で、その環境へデプロイ
│   └── PULL_REQUEST_TEMPLATE.md
├── deploy/
│   ├── staging/version            # staging で動くべきコミット SHA（昇格 PR で更新）
│   └── production/version         # 本番で動くべきコミット SHA（昇格 PR で更新）
├── docs/                          # 設計ドキュメント（docs/README.md が入口）
├── drizzle/migrations/            # drizzle-kit が生成する SQL（D1 に適用する）
├── public/                        # 静的アセット（og/default-{ja,en}.png、favicon.svg）
├── scripts/
│   ├── tokens/build.ts            # docs/06_design-tokens.json → Panda のトークン
│   ├── seed/                      # デモデータの SQL とダミー画像を作る
│   ├── migrate-legacy/            # 今のサイトのデータを移す変換スクリプト
│   ├── og/                        # 既定の OGP 画像を作る
│   ├── lhci/server.ts             # Lighthouse CI が測るプレビュー（gzip で圧縮して中継する。SDD 10章）
│   ├── promote.sh                 # 昇格 PR 用のブランチとバージョンファイルを作る
│   ├── promotion-check.sh         # 昇格 PR の SHA の確認（ci.yml が呼ぶ）
│   └── doc-lint.sh                # ドキュメントと実体の整合検査
├── src/
│   ├── server.ts                  # Worker の入口（/api/*・/media/* → Elysia、それ以外 → TanStack Start）
│   ├── response-headers.ts        # セキュリティヘッダーと X-Robots-Tag（SDD 7章・ADR-019）
│   ├── monitoring/                # Sentry（サーバー・ブラウザ。SDD 11章）
│   ├── api/                       # CMS API（Elysia ＋ oRPC）
│   │   ├── app.ts                 #   Elysia のアプリ
│   │   ├── contract/              #   oRPC のコントラクト（パス・入出力・エラー）
│   │   ├── router/                #   コントラクトの実装
│   │   ├── middleware/            #   認証・レート制限・認可（順序は SDD 5.1）
│   │   └── media.ts               #   /media/* の配信
│   ├── auth/                      # Better Auth（server.ts・client.ts）
│   ├── db/                        # Drizzle のスキーマとクライアント
│   ├── domain/                    # 純粋関数: スラッグ・言語あり・抜粋・公開のルール
│   ├── content/                   # 公開側のサーバー関数と、表示用の形への変換
│   ├── markdown/                  # Markdown の描画（公開側とプレビューで共通）
│   ├── i18n/                      # 辞書（messages/ja.ts・en.ts）と日付の書式
│   ├── routes/                    # TanStack Start のルート（SDD 4章）
│   ├── site/                      # 公開側の画面の部品
│   ├── admin/                     # 管理画面の部品・フック・API クライアント
│   ├── ui/                        # Ark UI に見た目を付けた共通の部品
│   └── styles/                    # グローバルな CSS、tokens.generated.ts（生成物）
├── tests/
│   ├── integration/               # Workers 上の結合テスト（CMS API・サーバー関数）
│   └── e2e/                       # Playwright
├── .dev.vars.example              # ローカルの環境変数の見本
├── CLAUDE.md                      # 実装エージェントの前提知識（AGENTS.md はこのファイルへのリンク）
├── biome.json
├── drizzle.config.ts
├── lighthouserc.cjs               # Lighthouse CI の対象のページと目標（SDD 10章）
├── Makefile                       # 主要コマンドの唯一の真実源（8章）
├── package.json / bun.lock
├── panda.config.ts
├── playwright.config.ts
├── README.md                      # リポジトリの入口（始め方と docs/README.md への案内）
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── wrangler.jsonc                 # Workers・バインディング・環境の設定（5章）
```

Git に入れないもの: `.dev.vars`、`.wrangler/`（ローカルの D1・R2 のデータ）、`coverage/`・`.lighthouseci/`・`test-results/`（テストの出力）、`styled-system/`（Panda の生成物）、`src/styles/tokens.generated.ts`、`src/routeTree.gen.ts`、`worker-configuration.d.ts`（wrangler の型）、`dist/`、`node_modules/`。

---

## 3. 環境構築手順（30分以内）

### 3.1 手順

1. ツールを入れる（1章）。`bun --version` と `node --version`（v24）で確かめる。
2. リポジトリを取ってきて、セットアップする。

   ```bash
   git clone git@github.com:eastasann/eastx.git
   cd eastx
   make setup
   ```

   `make setup` は、依存のインストール、`.dev.vars.example` から `.dev.vars` の作成（すでにあれば上書きしない）、トークンと Panda のコード生成、ローカル D1 へのマイグレーションの適用、デモデータの投入、Playwright の Chromium のインストールを行う。
3. 開発サーバーを起動する。

   ```bash
   make dev
   ```

   http://localhost:3000 を開くと `/ja` か `/en` に移り、デモデータのトップが出る。ここまででログイン以外は動く。
4. 管理画面を試すときは、GitHub の OAuth App を作り（6章）、`.dev.vars` を埋めて `make dev` を起動し直す。http://localhost:3000/admin から GitHub でログインすると、初回のログインで管理者として登録され（SDD ADR-009）、ダッシュボードが出る。

### 3.2 環境変数

Worker が読む値。ローカルは `.dev.vars`、staging・本番は `wrangler.jsonc` の `vars` か `wrangler secret`（`docs/04_deployment-procedure.md` 3章）に置く。

| 名前 | 種類 | ローカルの値 | 説明 |
|---|---|---|---|
| `ENVIRONMENT` | 変数 | `local` | `local` ／ `staging` ／ `production`。エラーの詳細表示・noindex・Sentry の環境名に使う |
| `SITE_URL` | 変数 | `http://localhost:3000` | 公開サイトの origin。Better Auth の `baseURL`・`trustedOrigins`、OGP の絶対 URL に使う |
| `ADMIN_GITHUB_USER_ID` | 変数 | 自分の GitHub の数値 ID | 管理者として通す GitHub アカウント（SDD ADR-009）。調べ方: `curl -s https://api.github.com/users/{ユーザー名}` の `id` |
| `GITHUB_CLIENT_ID` | 変数 | ローカル用 OAuth App の Client ID | |
| `GITHUB_CLIENT_SECRET` | シークレット | ローカル用 OAuth App の Client secret | |
| `BETTER_AUTH_SECRET` | シークレット | `openssl rand -base64 32` の出力 | Cookie の署名などに使う。変えると全セッションが切れる。`local` 以外で空だと Better Auth の初期化を拒否し、CMS API がすべて 500 になる（公開されている既定の値で黙って動かさないため） |
| `SENTRY_DSN` | 変数 | 空 | 空なら Sentry に送らない |

バインディング（`wrangler.jsonc` で設定。ローカルは wrangler が自動で用意する）:

| 名前 | 種類 | 用途 |
|---|---|---|
| `DB` | D1 | データベース |
| `MEDIA` | R2 | 画像 |
| `AUTH_RATE_LIMITER` | Rate Limiting | ログインの開始と GitHub からの戻りのレート制限（対象の正は SDD ADR-021） |
| `ADMIN_RATE_LIMITER` | Rate Limiting | `/api/admin/*` のレート制限 |

型は `wrangler types` で `worker-configuration.d.ts` に生成する（8章の「生成」に含まれる）。

---

## 4. D1 コマンド一覧

ローカルの D1 は `.wrangler/state/` に保存される。どれもローカルだけを触る（staging・本番の D1 は CI のデプロイが触る。`docs/04_deployment-procedure.md`）。

| ターゲット | 説明 |
|---|---|
| `make db-generate` | `src/db/schema.ts` の変更から、drizzle-kit で `drizzle/migrations/` に SQL を生成する。生成した SQL は必ず読んでからコミットする |
| `make db-migrate` | 未適用のマイグレーションをローカルの D1 に適用する |
| `make db-seed` | デモデータ（design-spec 8章）をローカルの D1 に入れ、ダミー画像をローカルの R2 に置く。中身のテーブル（プロフィール〜コーディング記録）は消してから入れる。管理者・セッションのテーブルと R2 の既存の画像は残す。`make setup`・`make e2e` もこれを呼ぶので、ローカルの管理画面で手で入れた中身は消える。`CLOUDFLARE_ENV` が設定されていると止まる |
| `make db-seed-empty` | ブログとコーディング記録を0件にしたデモデータを入れる（セクションとメニューが消えることの確認用） |
| `make db-reset` | ローカルの D1 を消して、マイグレーションの適用とデモデータの投入をやり直す |
| `make db-studio` | Drizzle Studio でローカルの D1 を開く（https://local.drizzle.studio）。ポート（既定 4983）がふさがっていれば `STUDIO_PORT=` で変える |

- 管理者はシードで作らない（SDD ADR-009）。ログインの準備は6章。
- スキーマを変えたら `make db-generate` → `make db-migrate` の順。`drizzle-kit push` は使わない（SDD ADR-007）。
- マイグレーションは、staging・本番で古いコードのまま動いても壊れない形にする（列の追加 → データの移行 → 古い列の削除を、別々のリリースに分ける）。ロールバックではスキーマが戻らないため（SDD ADR-017）。
- テーブルを作り直す SQL（`PRAGMA foreign_keys=OFF` → 新しいテーブル → コピー → `DROP` → `RENAME`）が生成されたら、そのまま使わない。D1 ではこの PRAGMA が効かず、親のテーブルの `DROP` で子の行が `ON DELETE CASCADE` で消えるおそれがある（SDD ADR-007）。`PRAGMA defer_foreign_keys = on` に置き換えるか、子のテーブルの行を退避・復元する SQL を手で足す。
- テーブルを作り直す変更は、本番のデータを書き出したもの（`docs/04_deployment-procedure.md` 5章の `d1 export`）をローカルの D1 に入れて適用し、各テーブルの件数が変わらないことを確かめてから出す。

---

## 5. IaC（wrangler.jsonc）

Terraform などは使わず、`wrangler.jsonc` でインフラを管理する（SDD ADR-017）。トップレベルはローカル専用（デプロイしない）で、staging と本番は `env` に分ける。バインディングと `vars` は環境ごとに書く（`env` の中では引き継がれない）。

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "eastx-local",
  "main": "src/server.ts",
  "compatibility_date": "2026-09-01",
  "compatibility_flags": ["nodejs_compat"],
  "observability": { "enabled": true, "head_sampling_rate": 1 },
  "vars": { "ENVIRONMENT": "local", "SITE_URL": "http://localhost:3000" },
  "d1_databases": [
    { "binding": "DB", "database_name": "eastx-db-local", "database_id": "local", "migrations_dir": "drizzle/migrations" }
  ],
  "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "eastx-media-local" }],
  "ratelimits": [
    { "name": "AUTH_RATE_LIMITER", "namespace_id": "1001", "simple": { "limit": 10, "period": 60 } },
    { "name": "ADMIN_RATE_LIMITER", "namespace_id": "1002", "simple": { "limit": 300, "period": 60 } }
  ],
  "env": {
    "staging": {
      "name": "eastx-staging",
      "routes": [{ "pattern": "x-staging.eastasian.dev", "custom_domain": true }],
      "vars": {
        "ENVIRONMENT": "staging",
        "SITE_URL": "https://x-staging.eastasian.dev",
        "ADMIN_GITHUB_USER_ID": "<GitHub の数値 ID>",
        "GITHUB_CLIENT_ID": "<staging 用 OAuth App の Client ID>",
        "SENTRY_DSN": "<Sentry の DSN>"
      },
      "d1_databases": [
        { "binding": "DB", "database_name": "eastx-db-staging", "database_id": "<作成時に出た ID>", "migrations_dir": "drizzle/migrations" }
      ],
      "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "eastx-media-staging" }],
      "ratelimits": [
        { "name": "AUTH_RATE_LIMITER", "namespace_id": "2001", "simple": { "limit": 10, "period": 60 } },
        { "name": "ADMIN_RATE_LIMITER", "namespace_id": "2002", "simple": { "limit": 300, "period": 60 } }
      ]
    },
    "production": {
      "name": "eastx",
      "routes": [{ "pattern": "x.eastasian.dev", "custom_domain": true }],
      "vars": {
        "ENVIRONMENT": "production",
        "SITE_URL": "https://x.eastasian.dev",
        "ADMIN_GITHUB_USER_ID": "<GitHub の数値 ID>",
        "GITHUB_CLIENT_ID": "<本番用 OAuth App の Client ID>",
        "SENTRY_DSN": "<Sentry の DSN>"
      },
      "d1_databases": [
        { "binding": "DB", "database_name": "eastx-db", "database_id": "<作成時に出た ID>", "migrations_dir": "drizzle/migrations" }
      ],
      "r2_buckets": [{ "binding": "MEDIA", "bucket_name": "eastx-media" }],
      "ratelimits": [
        { "name": "AUTH_RATE_LIMITER", "namespace_id": "3001", "simple": { "limit": 10, "period": 60 } },
        { "name": "ADMIN_RATE_LIMITER", "namespace_id": "3002", "simple": { "limit": 300, "period": 60 } }
      ]
    }
  }
}
```

- `wrangler.jsonc` の変更は、コードと同じ PR で出す。反映されるのは、その SHA を各環境に昇格したとき。
- D1・R2 の作成、シークレットの登録、独自ドメインの準備は、初回だけ手で行う（`docs/04_deployment-procedure.md` 3章）。
- レート制限の値（`ratelimits`）の正は SDD ADR-021。
- `compatibility_date` の見直しは `docs/05_operation-runbook.md` 6章。

---

## 6. OAuth開発用セットアップ

ログインは GitHub だけ（SDD ADR-009）。OAuth App のコールバック URL は1つしか登録できないので、ローカル・staging・本番で別の OAuth App を作る。ローカル用は次のとおり。

1. [GitHub Settings > Developer settings > OAuth Apps](https://github.com/settings/developers) → New OAuth App
2. 入力する値:
   - Application name: `eastx (local)`
   - Homepage URL: `http://localhost:3000`
   - Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
3. Client ID と、Generate a new client secret で作った secret を、`.dev.vars` の `GITHUB_CLIENT_ID`・`GITHUB_CLIENT_SECRET` に入れる。
4. `.dev.vars` の `ADMIN_GITHUB_USER_ID` に、自分の GitHub の数値 ID を入れる（3.2）。

staging・本番の OAuth App は `docs/04_deployment-procedure.md` 3章。

---

## 7. テスト実行

| ターゲット | 中身 |
|---|---|
| `make test` | Vitest のユニットテスト（Node.js）と結合テスト（`@cloudflare/vitest-pool-workers` で workerd 上、ローカルの D1・R2）を走らせる。ユニットテストではカバレッジ（SDD 10章の目標）も測り、目標を下回ると失敗する。v8 のカバレッジは workerd の上で動かないので、結合テストでは測らない |
| `make e2e` | ビルドしたアプリをローカルで起動し、デモデータを入れて、Playwright（Chromium）で E2E とアクセシビリティの検査、Lighthouse CI（`lighthouserc.cjs`）で PRD 5章の Lighthouse の目標の検査を走らせる。コアフローの E2E（`tests/e2e/core-flows.spec.ts`）は受入スイートを兼ねる |

- 何をどの層で確かめるか、カバレッジの目標は SDD 10章。
- 結合テストは、テストファイルごとにマイグレーションを当てた空の D1 で走る（`@cloudflare/vitest-pool-workers` はテストファイルごとに保存先を分ける）。同じファイルの中のテストは D1 を共有するので、ほかのテストが入れた行に頼らず、一意の値がぶつからないように書く。手元の `.wrangler/` のデータは使わない。
- 結合テストの `ADMIN_GITHUB_USER_ID`・`BETTER_AUTH_SECRET`・GitHub のキーは `vitest.config.ts` で固定の値にする（手元の `.dev.vars` と CI の有無に左右されない）。管理者・管理者でないセッションは `tests/integration/helpers.ts` が D1 に作り、署名した Cookie を返す。
- E2E のログインは、`tests/e2e/fixtures.ts` の `login` がプレビューと同じローカルの D1（`.wrangler/`）にユーザーとセッションを作り、署名したセッションの Cookie をブラウザに入れる（GitHub には行かない）。`login({ admin: true })` は `.dev.vars` の `ADMIN_GITHUB_USER_ID` の管理者のセッションで、管理画面に入る流れに使う。そのため `make e2e` には `.dev.vars` の `ADMIN_GITHUB_USER_ID` が要る（空ならフィクスチャが理由を出して失敗する）。手元でログインして作った管理者の行があればそれを使い、消さない。`login()` は管理者でないユーザーのセッションで、テストごとに作って終わりに消す。
- E2E は1つのワーカーで順に走らせる（`playwright.config.ts` の `workers: 1`）。ワーカーのプロセスとプレビューの Worker が同じ SQLite のファイルへ同時に書くと、miniflare の D1 はロックを待たずに `SQLITE_BUSY` で失敗するため。
- CI では、どちらも PR ごとに走る。`deploy/*/version` だけを変えた昇格 PR では省く（`docs/04_deployment-procedure.md` 2章）。

---

## 8. 主要コマンド（Makefile）

**Makefile が実コマンドの唯一の真実源。** docs・CLAUDE.md・実装プロンプトは以下の標準ターゲット名だけを参照し、スタック固有の実コマンド（bun・wrangler・drizzle-kit など）は Makefile の中にだけ書く。コマンドを変えるときは Makefile だけを直す。Makefile は Phase 5 の最初のステップで作る。

| ターゲット | 説明 |
|-----------|------|
| `make setup` | 初回セットアップ（依存のインストール、`.dev.vars` の作成、トークンと Panda の生成、ローカル D1 のマイグレーションとシード、Playwright の Chromium） |
| `make dev` | 生成をしてから、開発サーバーを http://localhost:3000 で起動（Vite ＋ Cloudflare プラグイン。ローカルの D1・R2 を使う） |
| `make build` | 生成をしてから、本番用にビルド。環境は `CLOUDFLARE_ENV`（`staging` ／ `production`。空ならローカル）で選ぶ |
| `make test` | 生成をしてから、ユニットテストと結合テスト（7章） |
| `make e2e` | 生成をしてから、E2E・アクセシビリティ・Lighthouse の検査（7章） |
| `make lint` | 生成をしてから、Biome のチェック（lint とフォーマットの差分の検出）と、`src/` からデザイントークンのプリミティブ層を参照していないかの検査（SDD ADR-014） |
| `make typecheck` | 生成をしてから、TypeScript の型チェック |
| `make format` | Biome でフォーマットを直す |
| `make tokens` | `docs/06_design-tokens.json` から Panda のトークンを生成し、Panda のコード生成を走らせる（生成の一部） |
| `make db-generate` | マイグレーション SQL の生成（4章） |
| `make db-migrate` | ローカルの D1 にマイグレーションを適用（4章） |
| `make db-seed` | ローカルにデモデータを投入（4章） |
| `make db-seed-empty` | ブログとコーディング記録が0件のデモデータを投入（4章） |
| `make db-reset` | ローカルの D1 を作り直す（4章） |
| `make db-studio` | Drizzle Studio を起動（4章） |
| `make doc-lint` | ドキュメントと実体の整合検査（`scripts/doc-lint.sh --docs`） |
| `make promote ENV=staging` ／ `make promote ENV=production` | 昇格 PR 用のブランチを作り、`deploy/{ENV}/version` を書き換えてコミットする（9章）。`SHA=` で SHA を指定できる |

- 「生成」は、Git に入れない生成物（2章）を作り直すこと: デザイントークンと Panda のコード（`make tokens`）、TanStack Router のルートの木（`routeTree.gen.ts`）、wrangler の型（`worker-configuration.d.ts`）。CI はチェックアウト直後に `make lint` から走るので、生成物を読むターゲットは必ず最初に生成をする。
- テンプレートの標準ターゲットのうち `db-push` は置かない（D1 ではマイグレーションだけを使うため。SDD ADR-007）。
- makeは macOS・Linux に標準搭載。Windows で開発する場合は WSL を使う。

---

## 9. ブランチ戦略・リリースフロー

GitHub Flow ＋ GitOps の環境プロモーション。長命ブランチは `main` だけで、リリースはブランチではなく、環境ごとのバージョン宣言ファイルで管理する。**staging も本番も、昇格 PR をマージしたときだけデプロイする**（`main` へのマージではデプロイしない。SDD ADR-017）。

```
feature/xxx ──squash──▶ main ──（CI だけ。デプロイしない）
fix/xxx     ──squash──▶   │
                          ├─ 昇格 PR（deploy/staging/version）────▶ staging
                          └─ 昇格 PR（deploy/production/version）─▶ 本番
                               ※ staging で確かめた SHA だけを出す
```

| ブランチ | 用途 |
|----------|------|
| `main` | 唯一の長命ブランチ。直接 push しない |
| `feature/xxx` | 新機能。例: `feature/blog-editor` |
| `fix/xxx` | バグ修正。例: `fix/paging-height` |
| `promote/{環境}-{短い SHA}` | 昇格 PR（`make promote` が作る） |

### マージ方式

- コードの PR（feature・fix → main）は**常に squash マージ**。1 PR ＝ 1コミット ＝ 1つの意図になり、`main` の履歴が PR 単位で読める。
- 環境ブランチ（develop など）は使わない。

### リリースフロー（環境プロモーション）

`deploy/{環境}/version` に書いた **`main` のコミット SHA（40桁）** が、その環境で動くべきバージョンの唯一の真実。

1. コードの PR を `main` に squash マージする（CI だけが走る）。
2. staging に出す: `make promote ENV=staging`（`origin/main` の先頭の SHA を書く）→ push して PR を作り、マージする → `deploy.yml` が staging にデプロイする。
3. staging（https://x-staging.eastasian.dev）で確かめる。
4. 本番に出す: `make promote ENV=production`（`deploy/staging/version` の SHA を書く）→ PR を作り、マージする → `deploy.yml` が本番にデプロイする。

昇格 PR での CI の確認、デプロイの中身、ロールバックの手順は `docs/04_deployment-procedure.md` の2章・5章。

### PR ルール

- `main` へのマージは PR 必須（squash）。
- CI が通ること（lint・型・テスト・ビルド・E2E）。
- セルフレビュー可（1人開発のため）。
- コミットメッセージ: 英語の命令形で、1行目に変更の意図を書く（例: `Add the blog editor preview`）。Conventional Commits の接頭辞（`feat:` など）は付けない（既存の履歴に合わせる）。
- コミットメッセージの言語: 英語（サブジェクト・ボディとも）。
- コミットのトレーラーは付けない（`Co-Authored-By`、セッション URL など）。ツールや実行環境が既定で付けようとする場合も、この規約が優先する。
- コミットのサブジェクトは50字を目安に、72字を超えない。本文はサブジェクトとの間に空行を置き、表示幅72カラムで折り返す（全角は2カラム）。
- コミット本文には diff から復元できないこと（なぜ変えたか・採らなかった案・検証範囲）だけを書く。変更ファイルの一覧やバージョン番号の更新は `git show --stat` が持っているので書かない。長さの基準に既存の履歴を使わない（直前のコミットに合わせると単調に膨らむ）。
- PR は `.github/PULL_REQUEST_TEMPLATE.md` に従って書く。昇格 PR には、対象の SHA・staging での確認結果（本番のとき）・ロールバック手順を書く。

---

## 10. Linter / Formatter

| ツール | 設定 |
|--------|------|
| Biome | `biome.json`。lint とフォーマットを1つで行う。インデント2スペース、シングルクォート、セミコロンなし、行の長さ 120。`noRestrictedImports` で、公開側（`src/site/`・`src/content/`・`src/routes/$lang/`）から `src/admin/` と `src/api/` を import させない（SDD ADR-020）。生成物（`styled-system/`・`*.gen.ts`・`tokens.generated.ts`・`worker-configuration.d.ts`）は対象外 |
| TypeScript | `tsconfig.json` で `strict: true`、`noUncheckedIndexedAccess: true`。`make typecheck` で検査する |
| Panda CSS | `strictTokens: true`・`strictPropertyValues: true`。トークン以外の色・余白などは型エラーになる（SDD ADR-014） |
| EditorConfig | `.editorconfig`（UTF-8、LF、末尾の改行） |

---

## 11. よくあるトラブルシューティング

| 問題 | 解決策 |
|------|--------|
| 起動すると `no such table` のエラー | ローカルの D1 にマイグレーションが当たっていない。`make db-migrate`（データも欲しければ `make db-seed`） |
| `styled-system` や `tokens.generated` が見つからない | 生成物がない。`make tokens` |
| `routeTree.gen` が見つからない・ルートの型が合わない | TanStack Router のルートの木が古い。`make typecheck` などの生成をするターゲットを走らせると作り直される |
| GitHub で「redirect_uri is not associated with this application」 | OAuth App のコールバック URL が `http://localhost:3000/api/auth/callback/github` と完全に一致しているか確かめる（ポート・パスも） |
| ローカルのログインで「管理者でないアカウント」として拒否される（design-spec 6.4） | `.dev.vars` の `ADMIN_GITHUB_USER_ID` が、ユーザー名ではなく数値 ID になっているか確かめる（3.2） |
| ログインしても管理画面に入れず、ログイン画面に戻る | `BETTER_AUTH_SECRET` が空、または `SITE_URL` が `http://localhost:3000` と違う（Cookie が付かない）。`.dev.vars` を直して `make dev` を起動し直す |
| ポート 3000 が使われている | ほかのプロセスを止める。ポートを変えると OAuth App のコールバック URL も変える必要がある |
| ローカルのデータがおかしくなった | `make db-reset` |
| E2E でブラウザが見つからない | `make setup` を走らせ直す。Claude Code のクラウド環境では Chromium が用意済み（`PLAYWRIGHT_BROWSERS_PATH`）なので、インストールは要らない |
| `wrangler` がログインを求める | ローカル開発では要らない。staging・本番を触る作業（`docs/04_deployment-procedure.md`）のときだけ `bunx wrangler login` |
| `bun run` で Node.js のバージョンのエラー | `node --version` が 24 か確かめる（wrangler・Vite は Node.js で動く。SDD ADR-016） |
