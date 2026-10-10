# System Design Doc — eastx

入力: `docs/design-spec.md`（画面・ロール・振る舞いの正）、`docs/screen_flow.mermaid`
このドキュメントが持つもの: 技術選定（ADR）、アーキテクチャ、ルーティング、API、データモデル、セキュリティ、エラーハンドリング、i18nの実装方針、テスト戦略、モニタリング。
画面の存在・目的・レイアウト・認証要否・振る舞いは design-spec が持つので、ここには書かずに章番号で参照する。

---

## 1. Goal / Non-Goal

### Goal

- design-spec 3章の全画面を、1つの Cloudflare Worker で動かす。
- 公開側は、ページを返す前に中身をすべて用意して SSR する（design-spec 6.1.5）。管理画面で保存した変更は、次のリクエストからすぐ公開側に出る（ADR-011）。
- 管理画面が使う CMS API を、OpenAPI で説明できる REST API として持ち、管理画面からは型付きで呼ぶ。API を使えるのは管理者だけにする。
- 見た目の値は `docs/06_design-tokens.json` から生成したトークンだけで指定し、トークン以外の値を型エラーにする。
- 今のサイト（eastasian）のデータを移せるデータモデルにする（design-spec 9章）。
- PRD 5章の性能と運用コストの目標を満たす構成にする。
- 公開側の閲覧と行動を Cookie を使わずに集計し、管理画面で見る（ADR-023）。

### Non-Goal

技術的なものだけを書く。製品としてのスコープ外は PRD 6章。

- 同時編集の競合検出（楽観ロックなど）。管理者は1人なので、競合は 409 で返すだけにする（ADR-006）。
- CORS を開けること。CMS API は同じ origin の管理画面からだけ使う。
- 公開ページの HTML のエッジキャッシュや ISR（ADR-011）。
- 動的な OGP 画像の生成、画像の自動リサイズ・形式変換（ADR-010・ADR-019）。
- ジョブキュー。定期実行（Cron）は解析の日ごとの集計だけ（ADR-023）。

---

## 2. アーキテクチャ概要

```
                         ┌──────────────────────── Cloudflare ────────────────────────┐
  訪問者 ──HTTPS──┐      │  x.eastasian.dev（本番）／ x-staging.eastasian.dev（staging）│
                  ├────▶ │  ┌──────────────────────────────────────────────────────┐  │
  管理者 ──HTTPS──┘      │  │ 静的アセット（ビルド済みJS/CSS・フォント・画像）        │  │
                         │  │   一致すれば Worker を通さずに返す                     │  │
                         │  └──────────────────────────────────────────────────────┘  │
                         │  ┌──────── Worker（src/server.ts）──────────────────────┐  │
                         │  │ /api/* と /media/* ──▶ Elysia                         │  │
                         │  │    ├ /api/auth/*  ─▶ Better Auth（GitHubログイン）      │  │
                         │  │    ├ /api/admin/* ─▶ oRPC OpenAPIHandler（CMS API）    │  │
                         │  │    ├ /api/collect ─▶ 解析の受け口（訪問者の送信）        │  │
                         │  │    └ /media/*     ─▶ R2 から画像を配信                  │  │
                         │  │ それ以外 ─────────▶ TanStack Start（SSR）               │  │
                         │  │    ├ /, /ja, /en, /{lang}/...  公開側（ローダー → サーバー関数）│
                         │  │    └ /admin/*                  管理画面（クライアント描画）│  │
                         │  │ scheduled（本番の Cron）─▶ 解析の日ごとの集計            │  │
                         │  └──────────────────────────────────────────────────────┘  │
                         │     │ Drizzle             │ R2 API          │ Rate Limiting  │
                         │  ┌──▼──────┐        ┌─────▼─────┐    ┌──────▼──────┐        │
                         │  │ D1 (DB) │        │ R2 (MEDIA)│    │ *_RATE_LIMITER│      │
                         │  └─────────┘        └───────────┘    └─────────────┘        │
                         │  本番だけ: Analytics Engine（ANALYTICS）・KV（ANALYTICS_SALTS）│
                         └─────────────────────────────────────────────────────────────┘
                                │ OAuth          │ SQL API（解析の読み取り） │ エラー・稼働監視
                           github.com     api.cloudflare.com              Sentry
```

### 通信フロー

| フロー | 経路 |
|---|---|
| 公開側の初回表示（例: `/ja`） | Worker → TanStack Start のルートのローダー → サーバー関数（`src/content/`）→ Drizzle → D1（1回の `batch` でまとめて読む）→ SSR した HTML を返す |
| 公開側の画面移動（例: トップ → 作品詳細） | ブラウザのルーター → ローダーがサーバー関数を呼ぶ（TanStack Start が内部の HTTP エンドポイントに変換する）→ JSON → クライアントで描画 |
| 管理画面の表示 | `/admin/*` はクライアント描画（`ssr: false`）。Better Auth のクライアントでセッションを確かめ、oRPC のクライアント（`OpenAPILink`）と TanStack Query で `/api/admin/*` を呼ぶ |
| CMS API | Elysia → oRPC の OpenAPIHandler → CSRF・認証・レート制限・認可（順序は 5.1）→ 手続き → Drizzle → D1 ／ R2 |
| ログイン | A1 → `POST /api/auth/sign-in/social` → github.com で認可 → `GET /api/auth/callback/github` → Better Auth が管理者か確かめてセッションを作り、Cookie を付けて元の画面へ戻す |
| 画像 | 管理画面 → `POST /api/admin/uploads` → R2 に保存 → `/media/...` のパスを返す。公開側・管理画面は `/media/...` を `<img>` で読む（Worker が Cache API か R2 から返す。ADR-010） |
| 解析の送信 | 公開側のブラウザ（`ANALYTICS_BEACON` が `on`）→ `navigator.sendBeacon` で `POST /api/collect` → Elysia → 検査・レート制限・除外 → Analytics Engine に1件書く（本番だけ。ADR-023・5.14） |
| 解析の集計 | Cron（本番、毎日 00:15 JST）→ `scheduled` → Analytics Engine の SQL API → D1 の `analytics_daily`・`analytics_rollup`（1日ぶんを1回の `batch`）。明日の日ごとの値を KV に作る（ADR-023） |
| 解析の表示 | A10 → `GET /api/admin/analytics` → 確定した日は D1、今日の分は SQL API（5.13）。A2 は D1 だけ（5.4） |

### インフラ管理

| 対象 | 管理方法 |
|---|---|
| Worker・バインディング（D1・R2・Rate Limiting・本番だけの Analytics Engine と KV）・Cron のトリガー（本番だけ）・独自ドメイン・環境変数 | `wrangler.jsonc`（リポジトリで管理。トップレベル = ローカル、`env.staging`、`env.production`） |
| D1・R2・KV の作成、Analytics Engine の有効化 | 初回だけ wrangler CLI とダッシュボードで行う（`docs/04_deployment-procedure.md` 3章）。作った ID を `wrangler.jsonc` に書く。Analytics Engine は、最初のデータセット（`eastx_analytics`）をダッシュボードで作って有効にしてからデプロイする |
| DB スキーマ | Drizzle のスキーマ（`src/db/schema.ts`）→ drizzle-kit で SQL のマイグレーションを生成 → wrangler で D1 に適用 |
| シークレット | ローカルは `.dev.vars`（Git に入れない）、staging・本番は `wrangler secret put` |
| DNS | `eastasian.dev` のゾーンを Cloudflare で管理する。Worker の Custom Domain を作ると DNS レコードと証明書が自動で用意される |
| IaC ツール | 使わない（ADR-017） |

---

## 3. 技術選定と判断理由（ADR）

確定したスタックの一覧:

| 層 | 選定 | ADR |
|---|---|---|
| アプリの形 | 一体型（1つの Worker の入口で、API と UI に振り分ける） | 001 |
| ホスティング | Cloudflare Workers（Paid プラン）＋ Workers Static Assets、独自ドメイン | 002 |
| UI | TanStack Start（React） | 003 |
| HTTP の入口 | Elysia（Cloudflare Worker アダプター） | 004 |
| 通信方式・データ取得 | 管理画面は oRPC（コントラクト先行の REST）＋ TanStack Query。公開側はサーバー関数で D1 を直接読む | 005 |
| DB | Cloudflare D1 | 006 |
| ORM・マイグレーション | Drizzle ORM ／ drizzle-kit ＋ wrangler | 007 |
| バリデーション・フォーム | Zod ／ TanStack Form | 008 |
| 認証 | Better Auth（GitHub OAuth、DB セッション） | 009 |
| 画像 | Cloudflare R2（Worker の `/media/*` から配信、Cache API） | 010 |
| 反映のタイミング・キャッシュ | 毎回 SSR（保存した瞬間に反映）、Markdown の描画結果だけキャッシュ | 011 |
| Markdown | unified（remark-gfm・rehype-sanitize）＋ Shiki | 012 |
| i18n | 自前の型付き辞書 ＋ Intl | 013 |
| スタイル・UI 部品 | Panda CSS（strictTokens）＋ Ark UI | 014 |
| エディタ・並べ替え | CodeMirror 6 ／ dnd-kit | 015 |
| ツール | Bun、Node.js 24、make、Biome、Vitest、Playwright ＋ axe | 016 |
| CI/CD・IaC | GitHub Actions ＋ wrangler、昇格 PR でデプロイ、IaC ツールなし | 017 |
| 監視 | Workers Logs ＋ Sentry | 018 |
| SEO・OGP | 静的なルールで作る、OGP 画像は生成しない | 019 |
| リポジトリ | 単一パッケージ | 020 |
| レート制限 | Workers の Rate Limiting バインディング | 021 |
| 依存の版と検証 | 版を固定し、Phase 5 の最初にスパイクで確かめる | 022 |
| アクセス解析 | Workers Analytics Engine に書き、日ごとの集計を Cron で D1 に残す | 023 |

### ADR-001: アプリの形は一体型（1つの Worker の入口で API と UI に振り分ける）

**決定:** 公開サイト・管理画面・CMS API を1つのリポジトリ、1つのパッケージ、1つの Worker にまとめる。Worker の入口（`src/server.ts`）で、`/api/*` と `/media/*` を Elysia に、それ以外を TanStack Start に振り分ける。

**理由:** 今のサイトの保守がつらかった原因は、Nx モノレポと別ホストの Express API という構成の重さだった（PRD 2章）。管理者1人・訪問者向けの読み取り中心という規模なら、デプロイ先と設定を1つに保つのが最も手を入れやすい。それでも「CMS ＋ フロント」の分離は、入口の振り分けと、管理画面が API 経由でしかデータを書かないという境界でコード上に残せる。この境界の例外は訪問者の解析の送信（`POST /api/collect`）だけで、中身のデータ（D1）は書かず、Analytics Engine にだけ書く（ADR-023）。

**トレードオフ:**
- 弱点: 管理画面だけを変えても、公開側ごとデプロイになる。API の不具合（Worker ごと落ちる例外など）が公開側に及びうる。Worker のバンドルにすべての依存が入る。
- 対処: 管理画面は別のチャンクにし、公開側の読み込みには入れない。エラーは Sentry でルートごとに見分ける。バンドルの大きさは ADR-022 のスパイクで確かめる。`src/api/` はそのまま別 Worker に移せる構成にしておく。
- 捨てた案:
  - 2アプリ（公開サイトと「管理画面＋API」を別の Worker にする）: デプロイ先・環境変数・共通のコード（Markdown の描画・型）が2つに分かれ、今のサイトの「別ホスト」の重さが戻る。
  - 3分割（公開サイト・管理画面の SPA・独立した API）: 今の構成に最も近く、保守がつらかった原因そのもの。
  - BaaS ＋ フロント（今の DB である Supabase をそのまま使う）: 認証と CRUD を Supabase に任せると、CMS API を自作して見せるという目的（PRD 2章）が薄れる。行単位のセキュリティ（RLS）で書く権限設計と、OpenAPI で説明できる REST の両立も難しい。

### ADR-002: ホスティングは Cloudflare Workers（Paid）と独自ドメイン

**決定:** Cloudflare Workers の Paid プラン（月 $5）で動かす。ビルドした JS・CSS・フォントなどは Workers Static Assets で配信する（一致すれば Worker を通さずに返る）。本番は `x.eastasian.dev`、staging は `x-staging.eastasian.dev`（どちらも Worker の Custom Domain）。`eastasian.dev` のゾーンは Cloudflare で管理する。

**理由:**
- D1・R2・Rate Limiting をバインディングで直接使え、ローカルでも wrangler（Miniflare）で同じものが動く。
- R2 は下り転送が無料で、画像の配信のコストが伸びない。
- Paid にするのは、Markdown の描画（Shiki）や Better Auth の処理が Free プランの CPU 時間（1リクエスト 10ms）を超えうるのと、Worker のサイズの上限（Free は圧縮後 3MB、Paid は 10MB）に TanStack Start・Elysia・Better Auth・Shiki が Free では収まらない見込みのため。
- staging を `x.eastasian.dev` の下（2階層目のサブドメイン）ではなく `x-staging.eastasian.dev` にするのは、Universal SSL の証明書がカバーするのが1階層目のサブドメインまでで、2階層目には追加の証明書が要る場合があるため。

**トレードオフ:**
- Workers は Node.js と完全には互換でなく（`nodejs_compat` で主要な API は使える）、CPU 時間にも上限がある。Paid でもサイズは圧縮後 10MB までなので、収まるかを ADR-022 のスパイクで確かめる。
- `eastasian.dev` のネームサーバーがまだ Cloudflare でなければ、移す作業が要る（`.dev` は HTTPS が必須のドメインだが、Custom Domain の証明書で満たせる）。
- 捨てた案:
  - Vercel: Next.js 向けで、DB とストレージは Marketplace の外部サービス（Neon・Blob など）を組み合わせる形になり、転送量で費用が伸びる。
  - Fly.io・Cloud Run（コンテナ常駐）: DB とストレージを別に用意して接続を管理する必要があり、常駐させると固定費が月 $5 を超える。

### ADR-003: UI フレームワークは TanStack Start（React）

**決定:** 公開側と管理画面の UI を TanStack Start で作る。公開側のルートはサーバーのローダーで中身を用意して SSR し、管理画面のルート（`/admin/*`）は `ssr: false` でクライアント描画にする。Cloudflare へは `@cloudflare/vite-plugin` で載せる。

**理由:** 1つのフレームワークで「公開側は SSR、管理画面は SPA」を使い分けられる。ルートの型が強く、`/$lang` のようなパラメーターも型付きで扱える。oRPC に TanStack Query との連携があり、管理画面のデータの取得・更新・キャッシュの無効化をまとめて書ける（ADR-005）。Workers への載せ方が公式に用意されている。

**トレードオフ:**
- Next.js（今のサイトで経験がある）に比べて新しく、情報が少ない。Workers での動作は ADR-022 のスパイクで確かめ、駄目なら React Router v7 に切り替える（React の部品はそのまま使え、サーバー関数はローダー・アクションに置き換わる）。
- 捨てた案:
  - React Router v7: Cloudflare での実績は最も多いが、ルートの型安全は型生成で補う形で、TanStack Query・TanStack Form との統合も TanStack Start ほど直接ではない。代わりの候補として残す。
  - Next.js（OpenNext）: Workers では変換アダプターを挟み、バンドルが大きく、ISR などに追加の設定が要る。
  - Astro ＋ React: 公開側には最適だが、管理画面を React のアイランドで作ることになり、UI の作り方が2種類になる。

### ADR-004: HTTP の入口は Elysia（Cloudflare Worker アダプター）

**決定:** `/api/*` と `/media/*` を Elysia で受ける。この構成で Elysia が受け持つのは、ルートのまとめ（`/api/auth/*` → Better Auth、`/api/admin/*` → oRPC、`/media/*` → R2）、リクエスト全体の前後処理（リクエストID・セキュリティヘッダー）、`/media/*` と解析の受け口 `/api/collect`（5.14）の処理。Cloudflare Worker アダプター（`elysia/adapter/cloudflare-worker`）を `aot: false` で使う（AOT の `.compile()` は実行時のコード生成（`new Function`）を使い、workerd が拒否することを ADR-022 のスパイクで確認した）。oRPC と Better Auth には本文を Elysia に読ませずに渡す。`aot: false` の動的ハンドラーは `parse: 'none'` を解釈せず Content-Type に従って本文を読んでしまう（Elysia 1.4.30）ので、本文に触れずに印の値を返す parse の関数を指定する（parse の関数が値を返すと、Elysia はそれを本文として扱い読み込みを飛ばす）。

**理由:** ユーザーの指定。HTTP の入口（認証の受け口・API・画像の配信）を1か所にまとめ、`src/api/` だけで CMS API の HTTP 層が完結する。

**トレードオフ:**
- Elysia は Bun を主な実行環境としていて、Workers のアダプターは比較的新しい。Workers は実行時のコード生成（`new Function`）を許さないため、アダプターの設定に依存する。本文の解析を oRPC と Better Auth に任せるので、Elysia 自身の機能（入力の検証など）はほとんど使わず、役割が薄いわりに互換性のリスクは最も大きい。
- 対処: ADR-022 のスパイク（ローカル）で、AOT（`.compile()`）は workerd で動かないことを確認し、`aot: false` に切り替えた。staging でも確かめる。それでも駄目なら、`src/server.ts` から oRPC と Better Auth の fetch ハンドラーを直接呼ぶ形に変える。各ハンドラーは Elysia に依存しない形で書いておき、差し替えを `src/api/app.ts` の中だけで済ませる。
- 捨てた案: Hono（Workers での実績が最も多い）は、ユーザーの指定により選ばなかった。

### ADR-005: 通信方式は oRPC（コントラクト先行の REST）＋ TanStack Query。公開側はサーバー関数で直接読む

**決定:**
- 管理画面 ↔ サーバーは oRPC。`@orpc/contract` でコントラクト（HTTP メソッド・パス・入出力の Zod スキーマ・定義済みのエラー）を先に書き、サーバーはそれを実装する。サーバーは `OpenAPIHandler` で REST として公開し、管理画面は `OpenAPILink` の型付きクライアントで呼ぶ。OpenAPI の仕様は `GET /api/admin/openapi.json` で出す。
- 管理画面のデータの取得・更新・キャッシュの無効化は、TanStack Query（`@orpc/tanstack-query`）で行う。
- 公開側は CMS API を通さない。TanStack Start のサーバー関数（`createServerFn`）がサーバーの中で D1 から公開中の中身だけを読み、表示用の形（ビューモデル）にして返す。
- リアルタイム通信（WebSocket・SSE）は使わない（要件がない）。

**理由:** コントラクトが API の設計書と実装の両方の正になり、5章をそのまま実装に移せる。REST にしておくと、curl や OpenAPI のツールで確かめられ、将来 API を別ホストに切り出しても形が変わらない。公開側を API 経由にしないのは、SSR のたびに自分自身へ HTTP を投げる無駄を避け、公開中の中身しか返さない読み取り専用の経路を分けておくため。

**トレードオフ:**
- `OpenAPILink` は JSON にできる型しか運べないので、日時は ISO 8601 の文字列で受け渡す（Date 型は使わない）。oRPC 標準の `RPCHandler` より、リクエストが少し冗長になる。
- 読み取りの経路が2つ（公開側の `src/content/` と管理画面の `src/api/`）になり、クエリと変換が一部重なる。共通の判定（言語あり・詳細ページの有無など）は `src/domain/` に寄せる。
- サーバー関数は、TanStack Start が作る HTTP のエンドポイント（`/_serverFn/...`）として誰でも呼べる。入力（`lang`・`slug`）は検証し、公開中だけを読む条件は共通のクエリ部品で守る（7章）。
- 捨てた案:
  - REST を Hono ＋ zod-openapi で作る: 型付きのクライアントを別に生成する必要があり、コントラクトから型付きクライアントと OpenAPI を同時に得られない（Hono 自体も ADR-004 で選んでいない）。
  - tRPC: REST として呼べず、HTTP の API としては説明しにくい。
  - Server Actions: API の境界が画面に溶け、「CMS とフロントを分ける」構成が見えにくくなる。
  - GraphQL: 画面ごとの取得の違いが小さく、サーバーの実装の手間に見合わない。

### ADR-006: DB は Cloudflare D1

**決定:** D1（SQLite）を使う。作成時に場所のヒントを `apac` にする。本番と staging で別の DB を持つ。

**理由:** Worker からバインディングで直接読め、接続の管理が要らない。ローカルは wrangler だけで動き、Docker が要らない。個人サイトの件数（数百件）なら容量・性能とも十分で、無料枠に収まる。Time Travel（Paid で30日）で任意の時点に戻せる。

**トレードオフ:**
- SQLite なので、UUID・enum・日付の型を持たない（文字列と CHECK 制約で表す。6章）。書き込みは1か所（プライマリ）に集まる。
- 対話的なトランザクションがない（Drizzle の `db.transaction()` は使えず、まとめて確定できるのは `db.batch()` の単位だけ）。そのため、確認してから書く処理（スラッグの重複の確認、並べ替えの ID の集合の照合、`sort_order` の最小値 − 1）は原子的にならない。対処: 一意インデックスを最後の守りにして、制約違反を `SLUG_CONFLICT`・`STACK_KEY_CONFLICT` に変える。管理者は1人なので、残りの競合は 409 で返すだけにする（Non-Goal）。いっしょに確定すべき書き込み（作品の更新と `work_stack` の置き換えなど）は、1回の `batch` で送る。
- 1つの文に入れられるパラメーターは100個まで。複数行の insert（シード・SNS リンクの置き換え）は件数を分ける。データ移行の SQL はファイルで流すので値を文に埋め込み、パラメーターの代わりに1文の長さ（100,000バイト）の上限に収まるよう文を分ける。
- データの移行は、今の公開サイトから抽出したデータ（design-spec 9章）を変換するスクリプトで行う（今の DB のダンプは使わない）。
- 捨てた案: Postgres ＋ Hyperdrive（Neon など）は、型が豊富で今の DB と同じ系統だが、外部サービスが1つ増え、ローカルに Docker が要る。

### ADR-007: ORM は Drizzle、マイグレーションは drizzle-kit で生成して wrangler で適用

**決定:** スキーマは Drizzle（`drizzle-orm/sqlite-core`）で書く。`drizzle-kit generate` で `drizzle/migrations/` に SQL を作り、`wrangler d1 migrations apply` で適用する（`wrangler.jsonc` の `migrations_dir` をこのディレクトリにする）。マイグレーションは前進のみで、戻すときは新しいマイグレーションを足す。

**理由:** Drizzle は D1 に正式に対応していて軽く、Workers のバンドルを圧迫しない。`db.batch()` で複数のクエリを1往復にまとめられる。SQL のファイルがリポジトリに残るので、何が適用されるかをレビューできる。

**トレードオフ:**
- drizzle-kit は SQLite で CHECK 制約などを変えるとき、テーブルを作り直す SQL（`PRAGMA foreign_keys=OFF` → 新しいテーブル → コピー → `DROP` → `RENAME`）を出す。D1 は外部キーを常に有効にしていてこの PRAGMA が効かないため、親のテーブル（`work`・`project`・`stack`）を `DROP` すると、`ON DELETE CASCADE` で `work_stack`・`project_stack` の行が消えるおそれがある。対処の決まりは `docs/03_dev-setup.md` 4章（生成した SQL を必ず読む、作り直しには `PRAGMA defer_foreign_keys` か子の行の退避と復元を手で足す、本番のコピーで件数を比べる）。列を足すだけの変更（CHECK を伴うものを含む）は、作り直しの SQL を列の追加に置き換えてテーブルを作り直さない（手順は同じ 4章）。
- Prisma（今のサイトで使っていた）ほどのリレーションの表現力はない。`drizzle-kit push` は D1 のローカルと相性が悪いので使わない。
- 捨てた案:
  - Prisma: Workers では重く、D1 にはドライバーアダプターが要り、マイグレーションの中身も見えにくい。
  - Kysely: クエリビルダーだけで、スキーマとマイグレーションを別に用意する必要がある。

### ADR-008: バリデーションは Zod、管理画面のフォームは TanStack Form

**決定:**
- API の入出力は Zod（v4）で定義する。oRPC の OpenAPI の仕様は `@orpc/zod` の変換器で作る。
- 管理画面のフォームは TanStack Form で作り、同じ Zod のスキーマで入力をチェックする（Standard Schema）。フィールドの名前は API の `fieldErrors` のキー（例: `ja.title`）と同じにして、サーバーのエラーをそのまま入力欄に対応させる。日英の両方の入力を1つのフォームの状態に持ち、言語タブと表示の切り替え（「日英」）は見せ方を変えるだけにする。編集ビューの一時保存（自動退避。design-spec 6.4）は、保存していない変更があるあいだ、このフォームの状態を `{ savedAt, values }`（`savedAt` はブラウザの時計の ISO 8601）の形で localStorage の `eastx:backup:{種類}:{id か new}` に置く。1件だけの画面（A3 プロフィール・A11 プライバシー）も行の `id` を使い、行がまだ無ければ `new` にする。書く・消す時は `src/admin/backup.ts` の `AutoBackup` が design-spec 6.4 の表のとおりに決める。比べる元（最後に読んだ・保存した内容）との比較はフォームの状態を JSON にして行い、比較に関係ない値（SNS リンクの並べ替えの目印の ID）は外してから比べる。

**理由:** oRPC が Standard Schema に対応していて、Zod のスキーマがそのままコントラクトと OpenAPI の仕様になり、サーバーとフォームでルールが食い違わない。TanStack Form は Standard Schema をそのまま使え、入れ子の項目（`ja`・`en`）と配列（SNS リンク・使用技術）を扱える。

**トレードオフ:**
- 公開時の必須チェック（言語ありの判定など）は状態によって変わるので、Zod だけでは書かず `src/domain/` の関数で行う（5.3）。
- Zod は管理画面のバンドルを少し大きくする（公開側には入れない）。Zod v4 と `@orpc/zod`（`ZodToJsonSchemaConverter`）の組み合わせで、全手続きの openapi.json が生成でき、`OpenAPILink` の型付きクライアントから呼べることを ADR-022 のスパイク（ローカルの結合テスト）で確認した。
- 捨てた案:
  - Valibot・ArkType: バンドルは小さいが、oRPC の OpenAPI の変換と周辺の情報は Zod が最も厚い。
  - React Hook Form: 成熟しているが、スキーマはリゾルバーを挟む形で、TanStack の部品とのつながりが TanStack Form ほど直接ではない。
  - 自前の状態管理: 入力チェック・変更の検出・配列の操作をすべて自分で書くことになる。

### ADR-009: 認証は Better Auth（GitHub OAuth）、管理者は環境変数の GitHub ID で決める

**決定:**
- Better Auth を Drizzle アダプター（D1）で使い、GitHub のソーシャルログインだけを有効にする。セッションは DB に持ち、HttpOnly の Cookie で渡す（有効期限30日、1日ごとに延長）。
- 管理者として通す GitHub アカウントは、環境変数 `ADMIN_GITHUB_USER_ID`（GitHub の数値 ID）で決める。初めてログインしたときに、その ID の人だけ `admin_user` が作られる（`databaseHooks.user.create.before` でそれ以外を拒否する）。セッションを作るとき（`databaseHooks.session.create.before`）と、API の認可（5.1）でも同じ ID かを確かめる。シードでは管理者を作らない。
- Better Auth のテーブルは `admin_user`・`admin_session`・`admin_account`・`auth_verification` とする（6章）。

**理由:** ユーザーの指定。OAuth の state・PKCE、Cookie の署名、セッションの延長と失効など、自前で書くと間違えやすい部分をライブラリに任せられる。Elysia・Drizzle・D1 との組み合わせ方が公式に用意されている。管理者の登録をシードではなく環境変数と初回ログインで行うので、本番の DB に手で行を入れる作業がない。

**トレードオフ:**
- 管理者1人には大きめのライブラリで、Better Auth の都合のテーブル（`admin_account`・`auth_verification`）とカラム（`email` など）が増える。GitHub のアクセストークンが `admin_account` に保存される（スコープは `read:user` と `user:email` だけで、リポジトリの権限は持たない）。
- テーブル名の変更・`additionalFields`・hooks で拒否したときのエラーコードは版によって変わりうる。版を固定し（ADR-022）、実際の値をスパイクで確かめる。
- GitHub の OAuth App はコールバック URL を1つしか持てないので、ローカル・staging・本番で別々の OAuth App を作る（`docs/04_deployment-procedure.md` 3章）。
- 捨てた案:
  - Arctic（OAuth だけのライブラリ）＋ 自前のセッション: コードは小さいが、自分で守る範囲が広い。
  - Cloudflare Access（GitHub でログインでき、無料）: ホスト名・パスの単位でエッジで守る仕組みで、ローカルでは同じ方式で動かせない。API の認可も Access の JWT の検証に頼ることになる。アプリの中で完結し、ローカルでも同じに動く認証を選んだ。

### ADR-010: 画像は R2 に置き、Worker の `/media/*` から配信する

**決定:**
- 画像は R2 のバケット（`MEDIA` バインディング。場所のヒントは `apac`）に `uploads/{yyyy}/{mm}/{uuid}.{拡張子}`（年月は UTC）のキーで置く。DB には `/media/uploads/...` というルート相対のパスを持つ。今のサイトから移した画像だけは、UUID の代わりに中身のハッシュを入れた `uploads/legacy/` のキーで置く（6.5）。
- `/media/*` は Elysia が処理する。まず Cache API（`caches.default`）を見て、なければ R2 から読み、`Cache-Control: public, max-age=31536000, immutable` を付けて Cache API に入れてから返す。
- アップロードの上限と形式は 5.10。

**理由:**
- キーに UUID を使うので、同じ URL の中身は変わらない。ブラウザにも Cloudflare の拠点（Cache API）にも長く置ける。Worker が返すレスポンスはエッジのキャッシュに自動では入らないので、Cache API に明示的に入れる。
- 同じ origin から配信するので、CSP の `img-src 'self'` で済み、SVG に専用の CSP ヘッダーを付けられる（5.10）。
- ルート相対のパスにすると、ローカル・staging・本番で同じデータが使え、独自ドメインを変えても DB を書き換えずに済む。R2 は下り転送が無料。

**トレードオフ:**
- 拠点ごとの最初のリクエストは、Worker を起動して R2 を読む（Workers のリクエスト数に数えられる）。
- 画像のリサイズや形式変換はしない（サムネイルは CSS で同じ縦横比に切り抜く）。
- 使われなくなった画像は残る（掃除はスコープ外。design-spec 9章）。下書きの中身に使った画像も、URL を知っていれば見られる（UUID なので推測はできない）。
- 捨てた案:
  - R2 のパブリックバケット＋独自ドメイン（例: `media.eastasian.dev`）: エッジのキャッシュは自動で効くが、origin が分かれ、環境ごとに URL が変わり、SVG に専用のヘッダーを付けるには別の設定が要る。
  - Cloudflare Images: リサイズ・形式変換ができるが、費用が増え、今の要件では要らない。

### ADR-011: 公開側は毎回 SSR し、HTML はキャッシュしない（保存した瞬間に反映）

**決定:**
- 公開側のページは、リクエストのたびに D1 から読んで SSR する。HTML にはエッジのキャッシュをかけない（`Cache-Control: private, no-cache`）。
- 重い処理である Markdown の描画の結果だけを、Workers の Cache API に保存する。キーは URL の形で `https://md-cache.internal/{RENDER_VERSION}/{種類}/{id}/{言語}/{updated_at}`。`{種類}` は本文を持つ中身の種類（`profile`・`career`・`work`・`project`・`blog-post`・`coding-log`・`privacy`）で、1件だけの中身（プロフィール・プライバシーのページ）の `{id}` は行の `id`。使用技術を渡した描画（自己紹介。ADR-012）だけ、末尾に使用技術の版のセグメント `/s-{版}` を足す（`.../{updated_at}/s-3f9a1c0b`）。版は、使用技術を識別名の昇順に並べ、各項目を `{key}\u0000{displayName}\u0000{iconUrl ?? ''}`、項目どうしを改行で連ねた文字列の SHA-256 の先頭8桁（16進）。描画結果に効く3つだけで作るので、並べ替えと「トップに表示する」の変更では変わらず、追加・削除・表示名・識別名・アイコンの変更で変わる。プロフィールの `updated_at` は使用技術を変えても変わらないため、版がないと古いアイコンの結果が出続ける。`RENDER_VERSION` は `src/markdown/` の定数で、描画の処理（プラグイン・サニタイズのスキーマ・Shiki の設定）を変えたら上げる。保存するレスポンスには `Cache-Control: max-age=604800`（7日）を付ける。

**理由:** design-spec 9章の「公開サイトに変更を反映するタイミング」を「保存した瞬間」に決める。個人サイトのアクセス量なら毎回の D1 の読み取りで足り、キャッシュの無効化を考えずに済む。Markdown のキャッシュは、キーに `updated_at` と `RENDER_VERSION` を含むので、中身を保存しても描画の処理を変えても別のキーになり、古い結果が出ない。

**トレードオフ:**
- アクセスが急に増えると D1 の読み取りが増える（Paid の無料枠は月 250 億行で、余裕がある）。
- Cache API は拠点ごとなので、最初のアクセスは描画からやり直しになる。
- 捨てた案:
  - ページ単位のキャッシュや ISR: 保存のたびに無効化が要り、今のアクセス量では割に合わない。
  - 保存のときに HTML を描画して DB に持つ: カラムが増え、描画の処理を変えたら全件を作り直す必要がある。

### ADR-012: Markdown は unified ＋ rehype-sanitize ＋ Shiki で、公開側とプレビューで同じ描画をする

**決定:** `src/markdown/` に描画の関数を1つ持ち、公開側（サーバー）と管理画面のプレビュー（ブラウザ）の両方から使う。処理は remark-parse → remark-gfm → remark-rehype（生の HTML は通さない）→ rehype-sanitize（GitHub のスキーマ）→ 太字と使用技術の照合（`stacks` を渡したときだけ）→ 見出しのレベルと外部リンクの処理 → Shiki（コードの色分け）→ 元の行番号の属性（`sourceLines` を渡したときだけ）→ HTML の文字列。太字と使用技術の照合は design-spec 6.3.1 の規則で、一致した太字の前に技術のアイコン（`img`。`alt` は空にして装飾として扱う。表示名は隣の太字にある）か、アイコンがなければ頭文字の丸を入れる。サニタイズの後に入れるのでスキーマは広げず、`src` は DB の `iconUrl`（CHECK 制約 `stack_icon_url` で `/media/` 始まり）だけ。`stacks` を渡すのは自己紹介の描画（公開側の `getTopPage` と A3 のプレビュー）だけ。オプションの `sourceLines` を渡すと、最上位のブロック（コードブロックは包みの要素）に Markdown の元の行番号を `data-source-line` で付ける。付けるのは最後（サニタイズの後。GitHub のスキーマは `data-*` を消す）で、値は構文木の位置から作る数字だけ。渡すのは L5 のプレビュー（ブラウザでの描画で、Cache API を通らない）だけで、エディタのスクロールにプレビューを追従させるのに使う。公開側の描画は渡さないので、公開側の HTML・キャッシュのキー・`RENDER_VERSION` は変わらない。Shiki は JavaScript の正規表現エンジンと、使う言語だけを読み込む細かいバンドルにする。テーマはライト・ダークの2つを CSS 変数で切り替える。テーマは、トークンの色がすべてコードブロックの地の色（`bg.subtle`）に対して 4.5:1 以上になるもの（ライトは `github-light-high-contrast`、ダークは `github-dark-default`）にする（SDD 10章のアクセシビリティの検査）。コードブロックの「コピー」ボタンは描画結果に含めず、本文を出す部品（`src/ui/markdown-body.tsx`）がブラウザで付ける。描画結果を UI の言語に依らない形に保ち、本文の言語をキーにした Cache API（ADR-011）でそのまま使い回すため。

**理由:** design-spec 6.3.1 のルールを1か所で実装し、プレビューと公開の見た目を一致させる。HTML の文字列を返すので、Cache API に入れやすい（ADR-011）。サニタイズを Shiki より前に置くのは、Shiki が付けるスタイルを消さないため。

**トレードオフ:**
- Shiki は重いので、管理画面ではエディタを開いたときにだけ読み込む。対応する言語を増やすとバンドルと CPU 時間が増える（初期は ts・tsx・js・jsx・json・bash・html・css・python・go・rust・sql・yaml・markdown・diff）。描画にかかる CPU 時間は ADR-022 のスパイクで確かめる。
- 捨てた案:
  - markdown-it・marked: 速いが、構文木を変換する処理とサニタイズをプラグインで別に組む必要がある。
  - react-markdown: React の要素を返すので、HTML の文字列としてキャッシュしにくい。
  - MDX: 本文の中で JSX を実行できてしまい、生の HTML を無効にする方針と合わない。
  - Prism・highlight.js: 軽いが、色分けの正確さとライト・ダークの切り替えは Shiki が上。

### ADR-013: i18n はライブラリを使わず、型付きの辞書と Intl で行う

**決定:** 固定文言は `src/i18n/messages/ja.ts` と `en.ts` に持ち、日本語の辞書の型をもう一方に満たさせる（`satisfies`）。日付は `Intl.DateTimeFormat` で整形する。詳しくは9章。

**理由:** 公開側の2言語だけで、文言も少ない。URL の言語（`/ja`・`/en`）が常に正なので、ライブラリの言語判定の仕組みは要らない。

**トレードオフ:**
- 複数形や言語が増えたときの仕組みは自分で足すことになる（3言語目は PRD 6章でスコープ外）。
- 捨てた案:
  - Paraglide JS: コンパイル時にメッセージを関数にでき、使わない文言を落とせるが、百前後の文言のためにビルドの手順が増える。
  - use-intl・react-i18next: 実行時のライブラリで、言語の判定や読み込みの機能が今の要件では要らない。

### ADR-014: スタイルは Panda CSS（strictTokens）、UI 部品は Ark UI。トークンは自作スクリプトで変換する

**決定:**
- Panda CSS を使い、`strictTokens: true` と `strictPropertyValues: true` で、トークン以外の値を型エラーにする。
- `docs/06_design-tokens.json` を正とし、`scripts/tokens/build.ts`（Bun で実行）が Panda の `tokens`（プリミティブ層）と `semanticTokens`（セマンティック層。ライト・ダークは条件付きの値）を `src/styles/tokens.generated.ts` に書き出す。`panda.config.ts` はそれを読む。生成物は Git に入れず、生成物を読むターゲット（setup・dev・build・lint・typecheck・test・e2e）の最初に作り直す（`docs/03_dev-setup.md` 8章）。
- ダークモードは `<html data-theme="light|dark">` で切り替え、Panda の `_dark` の条件を `[data-theme=dark] &` に設定する。OS に合わせる設定のときは、`<head>` の小さなスクリプトが `prefers-color-scheme` を見て `data-theme` を描画の前に入れる。
- ブレークポイントは design-spec 4.3 の値を `panda.config.ts` に設定する。
- UI 部品（ダイアログ・メニュー・トースト・タブ・セレクト・スイッチ・コンボボックス・ツールチップ・セグメントグループ）は Ark UI（ヘッドレス）で作り、見た目は Panda のレシピで付ける。ダイアログは、画面の左端（モバイル幅のメニュー）・右端（L5 の設定パネルの引き出し）から開く引き出しとしても使う。設定の引き出しは、閉じているあいだも中身を描いたまま隠す（中のスラッグの欄が英語のタイトルに追従し続けるため）。セグメントグループは編集ビューの表示の切り替えに使う。入力欄のレシピは、枠の無い形（下の線だけを持ち、ホバー・フォーカス・誤りで線を出す）を持つ。
- 06 の型と Panda の対応: color → `colors`、space → `spacing`、size → `sizes`、radius → `radii`、border-width → `borderWidths`、shadow → `shadows`、duration → `durations`、cubicBezier → `easings`、opacity → `opacities`、z-index → `zIndex`、aspect-ratio → `aspectRatios`、fontFamily・fontWeight・font.size・letter-spacing → `fonts`・`fontWeights`・`fontSizes`・`letterSpacings`。typography（合成値）は Panda の `textStyles` に、transition（合成値）は `durations` と `easings` のセマンティックトークンの組に展開する。
- Panda ではプリミティブ層もトークンになり、型では「セマンティック層だけを参照する」を止められない。そこでプリミティブは `primitive` の名前空間に出し、`make lint` の中で `src/` からの `primitive.` の参照を検査して止める。
- スタイルは静的に書けるもの（`css()` に渡すオブジェクト、レシピとそのバリアント）だけにし、実行時に組み立てない。
- トークンを通さない値は、ライブラリが実行時に渡す値を受ける CSS 変数と、画像の処理の種類を示す値だけにする。前者は Ark UI のトーストの積み重ね（`var(--x)`・`var(--z-index)` など）、Shiki のテーマの色（`var(--shiki-light)`・`var(--shiki-dark)`。ADR-012）、dnd-kit のドラッグ中の位置と遷移（要素の `style` に `--drag-transform`・`--drag-transition` として渡し、`transform`・`transition` で読む。ADR-015）で、どれもデザインの値ではなく、ライブラリの出力をそのまま使う。後者は公開側の使用技術の並びのアイコンのフィルター（design-spec 4.4）で、色・余白のようなデザインの値ではなく、DTCG にも Panda にも filter のトークンの型が無いため。グレースケールと、薄い濃さを濃くするトーンカーブは、`src/site/content-parts.tsx` の SVG フィルター（`feColorMatrix` の `saturate` 0 と、`feComponentTransfer` の `gamma` の指数 2）で行う。フィルターは `SiteChrome` が公開側の画面ごとに1つ置き、CSS の `filter: '[url(#stack-icon-tone)]'` で参照する。ダークモードは後ろに `invert(1)` を足す。CSS の `brightness`・`contrast` では、黒と白を動かさずに中間だけを濃くできない（`brightness` は地の塗られたアイコンの白い文字も暗くし、`contrast` は薄いグレーをさらに薄くする）ため、SVG のフィルターにする。`gamma` の指数は見比べて選んだ値だが、06 のトークンにはしない。SVG の要素の属性は Panda のトークンでは指定できず、06 に置いても生成した値を JSX に読み込む経路を別に作ることになる。値はこのフィルターの中だけで使い、テーマで変わらない（ダークモードは同じ値のあとに反転するだけ）。

**理由:** design-spec 4.4 の「見た目はすべてデザイントークン経由で指定し、コンポーネントに値を直接書かない」を、レビューではなく型の仕組みで守れる。Panda のトークンは「プリミティブ＋セマンティック（条件付き）」の2層で、06 の構造にそのまま対応する。ビルド時に CSS を生成するので、SSR でもランタイムの負荷がない。Ark UI は Panda と同じチームが作っていて、キーボード操作や読み上げをライブラリに任せられる。Style Dictionary を使わないのは、06 で使う DTCG の型が少なく（color・dimension・fontFamily・fontWeight・duration・cubicBezier・number・shadow・typography・transition）、出力先も Panda の2層だけなので、設定と変換の仕組みを1つ増やすより、短いスクリプトの方が単純なため。

**トレードオフ:**
- Panda はソースを静的に解析して CSS を作るので、実行時に組み立てたスタイルは CSS にならない（上の決まりで避ける）。TanStack Start・Vite（PostCSS）との組み合わせは ADR-022 のスパイクで確かめる。
- Tailwind ＋ shadcn/ui に比べて情報とコピーして使える部品が少なく、部品の見た目は自分で作る。変換スクリプトを自分で保守する。
- 捨てた案:
  - Tailwind v4 ＋ shadcn/ui: 情報と部品は最も多いが、`bg-[#fff]` のような直接の指定も書けてしまい、原則を守るには Lint の追加の設定が要る。
  - CSS Modules ＋ React Aria: 依存が最も少なく長持ちするが、トークン以外の値を型で止める仕組みがなく、書く CSS の量も最も多い。
  - vanilla-extract ＋ Radix: テーマの契約（`createThemeContract`）でトークンを型付きにできるが、2層とライト・ダークの条件を自分で組む必要がある。スタイルと UI 部品が別のチームの組み合わせになる。

### ADR-015: 管理画面のエディタは CodeMirror 6、並べ替えは dnd-kit

**決定:**
- Markdown のエディタは CodeMirror 6（`@codemirror/lang-markdown`）。React とのつなぎは自前の薄い部品（`EditorView` を `useEffect` で作る）にする。画像の貼り付け・ドロップでアップロードし、カーソルの位置に画像の記法を入れる処理を拡張で足す。部品の外の「画像を挿入」ボタンは、選んだファイルを同じアップロードの処理に渡す（拡張ではない）。ほかの拡張は、検索（`@codemirror/search` の検索のパネルと keymap。文言は日本語にする）、`Mod-s` の既定の動き（ブラウザの「ページを保存」）を止める keymap（保存は編集ビューの最上位の `keydown` が行うので、打鍵は止めずに上へ届ける）、見えている先頭の行を知らせるスクロールの処理（L5 の「並べる」でプレビューを追従させる。ADR-012 の `sourceLines`）。エディタは言語ごとに `EditorView` を1つずつ作り、表示の切り替え（「日英」を含む）や画面の幅が変わっても作り直さずに、見せる・隠すだけを変える（作り直すと元に戻す履歴とアップロード中の画像の行き先が消える）。CodeMirror は自分の基本のスタイルを CSS のレイヤーの外に入れ、それが Panda のレイヤーの中のスタイルに勝つので、CodeMirror が値を持つプロパティ（余白・高さ・キャレットの色・フォント・フォーカスの枠）は Panda から `!important` を付けたトークンで上書きする（ADR-014 のトークンだけで見た目を付ける方針はそのまま）。
- 一覧の並べ替えと、作品・プロジェクトの使用技術のチップの並べ替えは、dnd-kit の安定版（`@dnd-kit/core`・`@dnd-kit/sortable`）で行い、キーボードでも並べ替えられるようにする。

**理由:** CodeMirror 6 は拡張で貼り付けやドロップを扱いやすく、軽い。つなぎを自前にするのは、貼り付けの拡張とエディタの作り直しのタイミングを自分で決めるため。dnd-kit はキーボード操作と読み上げに対応している。

**トレードオフ:**
- WYSIWYG にはしない（Markdown をそのまま書く）。どちらも管理画面のチャンクだけに入れ、公開側のバンドルには含めない。
- dnd-kit は新しい API（`@dnd-kit/react`）に移る途中なので、安定版の API で書き、移行は依存の更新（ADR-022）で判断する。
- 捨てた案:
  - Monaco: 重く、スマホで使いにくい。
  - ただの textarea: 貼り付けでのアップロードや記法の色分けを、自分で一から作ることになる。
  - TipTap・Milkdown（WYSIWYG）: Markdown との往復で書いた記法が変わることがある。
  - `@uiw/react-codemirror`: 手軽だが、拡張とエディタの作り直しの制御が間接的になる。
  - pragmatic-drag-and-drop: 軽いが、キーボードでの並べ替えと読み上げを自分で作る範囲が広い。

### ADR-016: ツールは Bun・Node.js 24・make・Biome・Vitest・Playwright

**決定:**
- パッケージ管理（`bun install`、`bun.lock`）とスクリプトの実行（`bun run`、`bun scripts/*.ts`）は Bun。
- wrangler・Vite・Vitest・Playwright・drizzle-kit は Node.js 24 で動かす（`bun run` は各 CLI の shebang に従って Node.js で起動する）。
- 主要なコマンドの入口は make（`docs/03_dev-setup.md` 8章）。
- Linter・Formatter は Biome。テストは Vitest（Workers の結合テストは `@cloudflare/vitest-pool-workers`）と Playwright（アクセシビリティの検査は `@axe-core/playwright`）。PRD 5章の Lighthouse の目標は、Lighthouse CI（`@lhci/cli`）で、ビルドしたもののローカルのプレビューに対して測る。

**理由:**
- Bun: ユーザーの指定。インストールが速く、TypeScript のスクリプト（トークンの変換・シードの生成）をそのまま実行できる。
- Node.js 24: wrangler と Workers 用の Vitest が Node.js を前提としているため。24 は今の Active LTS で、2028年まで保守される。本番はどちらでもなく Workers のランタイム（workerd）で動く。
- make: パッケージ管理やツールを変えても、入口のコマンド名を変えずに済む。ドキュメントと CLAUDE.md はターゲットの名前だけを参照する。
- Biome: lint とフォーマットを1つのツールで速く行え、ADR-020 の import の制限にも使える。
- Vitest: Vite と同じ設定で動き、workerd の上で D1・R2 を使った結合テストができる。
- Playwright: E2E の定番で、Claude Code のクラウド環境には Chromium が入っている。axe でアクセシビリティの違反を自動で見つけられる。
- Lighthouse CI: PRD 5章の Lighthouse の目標を、PR ごとに機械で確かめられる。

**トレードオフ:**
- 開発者のマシンに Bun と Node.js の両方が要る。`bun test` は workerd で動かせないので使わない。
- `@cloudflare/vitest-pool-workers` は対応する Vitest の版が限られるので、Vitest はそれに合わせて固定する（ADR-022）。
- Lighthouse CI は、ローカルのプレビューで測るので、本番のネットワークや Cloudflare の拠点を通した値とは違う。本番の体感は Sentry の Web Vitals（7章）で見る。
- 捨てた案: pnpm・npm（ユーザーが Bun を指定）、ESLint ＋ Prettier（ツールと設定が2つになる）、Jest（workerd の上で動かす仕組みがない）、Cypress（Playwright より遅く、Chromium 以外での確認もしにくい）、手で Lighthouse を走らせる（測り忘れる）、PageSpeed Insights の API（公開された URL が要り、PR の段階で測れない）。

### ADR-017: CI/CD は GitHub Actions ＋ wrangler。staging・本番とも昇格 PR でデプロイし、IaC ツールは使わない

**決定:**
- コードの PR では、lint・型チェック・テスト・ビルド・E2E を GitHub Actions で走らせる。`main` へのマージではデプロイしない。
- 環境ごとのバージョン宣言ファイル `deploy/staging/version` と `deploy/production/version`（中身は `main` のコミット SHA）を更新する昇格 PR をマージしたときだけ、その環境へデプロイする。ロールバックは昇格 PR の revert。パイプラインの中身と手順は `docs/04_deployment-procedure.md` が持つ。
- 緊急のときは `wrangler rollback` で前の Worker のバージョンに戻してよい（そのあとバージョン宣言ファイルを合わせる）。
- インフラは `wrangler.jsonc` と、初回だけ使う wrangler CLI で管理し、Terraform などは使わない。

**理由:** ユーザーの指定で、staging にも昇格 PR で出す。どのバージョンがどの環境で動くべきかが Git の履歴だけでわかり、デプロイもロールバックも PR で行える。Cloudflare の構成要素は少なく、`wrangler.jsonc` で十分に表せる。

**トレードオフ:**
- `main` にマージしても自動では staging に出ないので、確かめたいときは昇格 PR を作る手間がある（`make promote` で減らす）。
- マイグレーションは前進のみなので、ロールバックしてもスキーマは戻らない。マイグレーションは古いコードでも動く形で書く（`docs/03_dev-setup.md` 4章）。
- 捨てた案:
  - Workers Builds（Cloudflare の Git 連携）: push でビルドとデプロイができるが、バージョン宣言ファイルでの昇格や、「staging に出した SHA だけを本番に出す」確認を表せない。
  - `main` へのマージで staging に自動で出す: ユーザーが、staging も昇格 PR で出すことを選んだ。
  - Terraform: 管理する資源が少なく、`wrangler.jsonc` と重なる。

### ADR-018: 監視は Workers Logs ＋ Sentry

**決定:** Workers Logs（`observability.enabled`）で全リクエストのログを持つ。エラーは Sentry に送る（サーバーは `@sentry/cloudflare` で Worker の入口を包み、ブラウザは `@sentry/react`）。稼働監視は Sentry の Uptime Monitoring。ログとエラーには、リクエストID（Cloudflare の `cf-ray`）を付ける。設定は11章。

**理由:** 1人で運用するので、エラーと停止にメールで気づければよい。Workers Logs は設定だけで使え、Sentry は Workers に公式に対応していて、エラーをまとめて見られる。

**トレードオフ:**
- Sentry の無料枠（エラーの件数・トレースの件数）を超えるとデータが落ちる。対処: 送るのは 5xx と想定外の例外だけにし、本番のトレースは間引く（11章）。Sentry の使用量の通知を有効にし、超えたときは Workers Logs（7日）で補う。
- アクセス解析は ADR-023。解析の受け口 `/api/collect` はトレースしない（`tracesSampler` で0。訪問者の表示と操作のたびに呼ばれ、無料枠を食う）。
- 捨てた案:
  - Cloudflare の通知だけ: Worker のエラー率はわかるが、エラーの中身をまとめて見られない。
  - UptimeRobot などの外形監視: サービスが1つ増える。Sentry の稼働監視で足りる。
  - Logpush: 送り先の用意が要り、個人サイトには過剰。

### ADR-019: ページのタイトル・説明・OGP は静的なルールで作り、OGP 画像は動的に生成しない

**決定:** design-spec 9章の「各ページのタイトル・説明・OGP 画像の作り方」を次に決める。`{サイト名}` は design-spec 6.1.2 のサイト名。

| ページ | `<title>` | 説明（description・og:description） | og:image |
|---|---|---|---|
| P1 トップ | `{サイト名} — {プロフィールの名前}`。プロフィールがなければ `{サイト名}` | プロフィールの肩書き。なければ自己紹介の抜粋。プロフィールがなければなし | 言語ごとの既定の画像 `/og/default-{lang}.png` |
| P2・P3 | `{タイトル} — {サイト名}` | 概要。なければ詳細本文の抜粋 | サムネイル。なければ既定の画像 |
| P4・P5 | `{タイトル} — {サイト名}` | 本文の抜粋 | サムネイル。なければ既定の画像 |
| P6 | `{プライバシーの辞書の文言} — {サイト名}` | 出している本文（片方の言語しかなければ、その言語の本文）の抜粋 | 既定の画像 |
| C1・C2 | `{C1・C2 の見出し（辞書の文言）} — {サイト名}` | なし | 既定の画像 |

- テキストは表示中の言語のもの（項目単位の代替表示は design-spec 1.4 に従う）。抜粋の作り方は design-spec 6.1.4。
- `og:image` などの絶対 URL は `SITE_URL` から作る。`og:locale` は `ja_JP` ／ `en_US`、`og:locale:alternate` にもう一方を入れる。
- P1〜P6 に `<link rel="canonical">` と、`hreflang` の `ja`・`en`・`x-default`（`x-default` はルート `/`）を出す。P6 は片方の言語しか本文が無くても3つとも出す（両方の URL が、もう片方の言語の本文と注記で表示できる）。C1・C2 は存在しない・表示できない URL なので出さない。
- 検索エンジンへの指示: 管理画面は `<meta name="robots" content="noindex">`。Worker が返すレスポンスのうち、`/admin/*`・`/api/*` と staging のすべてに `X-Robots-Tag: noindex, nofollow` を付ける。`/robots.txt` は静的ファイルにせず Worker が環境ごとに返す（本番は `/admin` と `/api` を拒否、staging とローカルはすべてを拒否）。静的アセット（JS・CSS・フォント）には付かないが、検索の対象になるページはすべて Worker を通る。
- sitemap.xml は作らない。RSS はスコープ外（design-spec 9章）。

**理由:** OGP 画像の動的生成（Satori など）は CPU とバンドルを食い、個人サイトでは割に合わない。サムネイルがあればそれで十分伝わる。sitemap を作らないのは、ページが少なく、トップからすべての詳細ページへリンクがあり、クローラーがたどれるため。

**トレードオフ:**
- サムネイルのない記事は、どれも同じ既定の画像になる。
- 記事が増えて検索での見つけやすさが問題になったら、sitemap.xml を足す（ADR を追加する）。
- 捨てた案: Satori などで OGP 画像を動的に作る（上の理由）。

### ADR-020: リポジトリは単一パッケージ

**決定:** モノレポにせず、1つの `package.json` で全体を持つ。`src/` の中で公開側・管理画面・API・共有のコードを分ける（`docs/03_dev-setup.md` 2章）。

**理由:** 今のサイトの Nx モノレポが保守の重さの原因だった。デプロイの単位が1つなので、パッケージを分ける利点がない。

**トレードオフ:**
- 公開側のコードが管理画面の依存を誤って読み込まないよう、公開側から `src/admin/` と `src/api/` を import しない決まりを Biome のルール（`noRestrictedImports`）で守る。ディレクトリごとの設定と相対パスの import で意図どおりに止められるかを ADR-022 のスパイクで確かめ、駄目なら make lint の中の小さな検査スクリプトに置き換える。
- 捨てた案: モノレポ（pnpm・Bun のワークスペースや Nx）は、パッケージの境界で依存を強制できるが、今のサイトで重さの原因だった。

### ADR-021: レート制限は Workers の Rate Limiting バインディング

**決定:** Workers の Rate Limiting バインディングを3つ使う。`AUTH_RATE_LIMITER` はログインの開始と GitHub からの戻り（`POST /api/auth/sign-in/*`・`GET /api/auth/callback/*`）を IP ごとに 60秒 10回（画面を開くたびに呼ぶセッションの確認 `get-session` とログアウトは数えない）、`ADMIN_RATE_LIMITER` は `/api/admin/*` をユーザーごとに 60秒 300回に制限する（認証の後で数えるので、未認証のリクエストは 401 で先に止まる。5.1）。`COLLECT_RATE_LIMITER` は訪問者の解析の送信（`POST /api/collect`）を IP ごとに 60秒 120回に制限する（5.14）。公開側のほかの経路には独自の制限をかけず、Cloudflare 標準の DDoS 対策に任せる。

**理由:** バインディングなので保存先が要らず、ローカルでも wrangler で動く。設定が `wrangler.jsonc` に残る。公開側で解析の受け口だけを例外にするのは、ここが訪問者から届く書き込みの経路で、ボットの大量の送信がそのままデータと費用（Analytics Engine の書き込みの数）を膨らませるため。120回は、1つの表示で送るイベント（約8件）に、ページングや行の開閉を続けた分の余裕を足した数。

**トレードオフ:**
- IP ごとのキーは、IPv6 では上位 64 ビット（/64）にする。利用者1人に /64 がまとめて割り当てられ、その中で送り元を自由に変えられるため。
- 数えるのは Cloudflare の拠点ごとで、正確でもない。期間は 10秒か60秒しか選べない。そのため総当たりを厳密に防ぐものではない。ログインは GitHub の OAuth でパスワードを持たないので、目的は認証の入口と API の乱用を抑えることに留める。
- 捨てた案:
  - WAF のレート制限のルール: 拠点をまたいで数えられるが、設定がリポジトリの外（ダッシュボード）に出る。
  - D1 で数える: リクエストのたびに書き込みが増え、遅くなる。

### ADR-022: 依存は版を固定し、Phase 5 の最初にスパイクで確かめる

**決定:**
- `package.json` の依存は正確な版で固定する（`^` を付けない）。更新は PR で行い、大きな更新は1つずつ出す（頻度は `docs/05_operation-runbook.md` 6章）。
- Phase 5 で各ライブラリを最初に入れるステップの冒頭で、その上に実装を積む前に次を確かめる（スパイク）。まずローカル（`make dev` と、ビルドしたもののプレビュー）で確かめ、staging でしか見られないもの（Custom Domain の上での動作、実際にデプロイしたバンドル）は、初回の staging のデプロイ（`docs/04_deployment-procedure.md` 3章 Step 7）のあとに確かめる。駄目だったときの代わりも決めておく。

| 確かめること | 関係する ADR | 駄目だったときの代わり |
|---|---|---|
| TanStack Start の SSR とサーバー関数が Workers で動く | 003 | React Router v7 |
| Elysia のアダプターで `/api/*`・`/media/*` を振り分けられる（AOT は workerd で動かず `aot: false` を採用済み） | 004 | 入口から各ハンドラーを直接呼ぶ |
| oRPC の `OpenAPIHandler`・`OpenAPILink` と、Zod v4 からの openapi.json の生成 | 005・008 | `RPCHandler` ＋ `RPCLink` に切り替え、OpenAPI は生成だけにする |
| Better Auth の GitHub ログイン、hooks での拒否、実際のエラーコード（1.7.7 の実ログインで確認済み。additionalFields の input: false は mapProfileToUser 由来も拒むため外し、update-user を塞ぐ形に 5.2 を直した） | 009 | 5.2 のエラーコードの表を実際の値に直す |
| 生成したトークンでの Panda（strictTokens）のビルド | 014 | Panda の PostCSS の設定を見直す |
| 長くコードの多い記事の Markdown の描画にかかる CPU 時間（Node.js 24（V8）で計測済み。ハイライターの生成は約 30ms。コード20個の普通の記事は初回約 140ms・2回目から約 10ms。16万字・コード1,600行・10言語の記事は初回約 590ms・2回目から約 270ms。Workers の CPU 時間の上限に十分収まり、描画結果は Cache API に入るので、言語は減らさない。workerd の上での描画とキャッシュは結合テストで通す） | 012 | Shiki の言語を減らす、描画結果のキャッシュを確かめる |
| `wrangler deploy --dry-run` でのバンドルの大きさが圧縮後 10MB に収まる | 002 | 重い依存の見直し、管理画面の依存の遅延読み込み |
| Biome の `noRestrictedImports` で公開側からの import を止められる | 020 | 検査スクリプト |
| drizzle-kit の SQL が D1 に適用できる | 007 | SQL を手で直す |
| 本番だけに書いたバインディング・変数（Analytics Engine・KV・`CF_ACCOUNT_ID`）の `Env` の型（wrangler 4.147.0 の `wrangler types` で、省けるもの（`ANALYTICS?` など）になることを確認済み。使う側で有無を確かめる） | 023 | 有無を確かめる部品を1つ置き、ほかから直接読まない |
| `withSentry` で包んだ `scheduled` が動き、例外が Sentry に送られる（@sentry/cloudflare 11.4.0 のソースで、`scheduled` も包み例外を送ることを確認済み。`src/server.ts` は TanStack Start の仮想モジュールに依存し結合テストから呼べないので、`scheduled` は集計の関数を呼ぶだけにし、集計の関数を結合テストで呼ぶ） | 018・023 | — |
| `@cloudflare/vitest-pool-workers`（0.22.0）で Analytics Engine と KV のバインディングを使い、`writeDataPoint` を確かめる（テストの設定の `analyticsEngineDatasets`・`kvNamespaces` で足せ、`writeDataPoint` を spy できることを確認済み。0.22.0 は `fetchMock` を持たないので、SQL API は `fetch` の spy で返す） | 016・023 | 書き込みの部品にバインディングを渡す形にし、記録用の偽物を渡す |
| Analytics Engine の SQL API: `_sample_interval`、記録の値と訪問者のハッシュ（`blob14`）の組の `GROUP BY`、日時の条件（`toDateTime(UNIX 秒)`）、最も古い `timestamp`（`min`）。公式の文書で、どれも使えることと、サンプリングは index ごとに均す（index に入れた訪問者の行は残る）こと、1回の応答で返す行数のデータセットごとの上限は `LIMIT` を書かない問い合わせには足されないことを確認済み。数え方は 5.13。値の無い blob は空文字で書いてそろえる。本番での実際の応答は、デプロイの後の確認（`docs/04_deployment-procedure.md` 6章）で確かめる | 023 | 次元ごとに `count(DISTINCT blob14)` で数え、A10 が今日の分を待つ上限（3秒）を見直す |
| Workers KV の期限切れ・消した値を利用者が戻す仕組みが無い（公式の文書で、期限が来た値は消え、読むと無いのと同じになり、戻す仕組みの記述が無いことを確認済み） | 023 | 置き場所を選び直す |
| `wrangler deploy` で `triggers` を書かない設定をデプロイしたときに、既存の Cron が外れるか（wrangler 4.147.0 のソースで、`triggers.crons` が無ければ Cron の設定を送らず、既存の Cron が残ることを確認済み。`wrangler rollback` も前のバージョンへのデプロイを作るだけで、Cron の設定を送らない） | 017・023 | ロールバックの手順に Cron を外す操作を足す（`docs/04_deployment-procedure.md` 5章） |

**理由:** TanStack Start・Elysia の Workers アダプター・oRPC・Better Auth・Panda は、どれも比較的新しく、版によって設定や振る舞いが変わる。組み合わせとしての実績も少ない。実装を積み上げる前に確かめれば、駄目だったときの作り直しが小さくて済む。

**トレードオフ:** 各ステップの冒頭が確認の作業になり、画面ができるのが少し遅れる。版を固定すると、セキュリティの修正を取り込むのが遅れうる（月1回の更新で補う）。

### ADR-023: アクセス解析は Workers Analytics Engine に書き、日ごとの集計を D1 に残す

**決定:**
- 公開側（P1〜P6 と、URL の言語の下の C1）のブラウザが、表示と行動のイベントを同じ origin の受け口 `POST /api/collect`（5.14）へ `navigator.sendBeacon` で送り、受け口が Workers Analytics Engine（データセット `eastx_analytics`、バインディング `ANALYTICS`）に1件ずつ書く。サーバー関数（`/_serverFn/...`）の呼び出しでは数えない。
- 訪問者は Cookie を使わずに、日ごとに変わるハッシュで数える。ハッシュ = SHA-256(日ごとの値・日本時間の日付・IP（IPv6 は上位64ビット）・User-Agent) の先頭16バイト。日ごとの値は32バイトのランダムな値で、Workers KV（バインディング `ANALYTICS_SALTS`）のキー `salt:{YYYY-MM-DD}` に、日本時間のその日の終わり＋10分を期限（`expiration`）にして置く。Cron が前日に翌日の値を作り、無ければ受け口がその場で作る。受け口は isolate の中に5分だけ持つ。IP・User-Agent は残さない。数えられるのは日ごとの訪問者数までで、期間の訪問者数は日ごとの訪問者数の合計。
- 除くもの: 管理者のセッションを持つ送信、ボットの User-Agent、DNT・GPC を送るブラウザ（ブラウザとサーバーの両方で見る）、自動操作のブラウザ（`navigator.webdriver`）。計測は本番だけで、`ANALYTICS`・`ANALYTICS_SALTS`・Cron は `wrangler.jsonc` の本番にだけ書く。ブラウザが送るかは変数 `ANALYTICS_BEACON`（本番・ローカルは `on`、staging は `off`）で決め、ローカルは受け口まで送って E2E で確かめる（バインディングが無いので書かない）。
- Analytics Engine の保持は3か月なので、毎日 00:15 JST の Cron（`triggers.crons` の `15 15 * * *`）が SQL API で日ごとに集計し、D1 の `analytics_daily`（次元ごとに上位100件と `(other)`）と `analytics_rollup`（集計を終えた日）に残す。集計するのは昨日と一昨日（遅れて届いた送信を拾うため毎回やり直す）と、Analytics Engine に残っている範囲（今日の89日前から）の3日前までの未集計の日で、1回に7日まで。集計する日の起点は、`analytics_rollup` の最も古い日と Analytics Engine の最も古いイベント（`MIN(timestamp)`）の日の早い方（最初の日の集計が失敗して翌日が先に確定しても、最初の日を埋めるため）。起点より前の日は集計しない（計測前の空の日で埋めない）。A10 の「計測の開始日」は `analytics_rollup` の最も古い日（5.13）。1日ぶんは1回の `db.batch()` で書き直すので、何度集計しても結果は同じ。
- 見るのは管理画面の A10（5.13）と A2 の要約（5.4）。確定した日は D1、今日の分だけ SQL API から読む。SQL API のトークン（`ANALYTICS_API_TOKEN`、Account Analytics: Read）とアカウント ID（`CF_ACCOUNT_ID`）は本番だけに置く。

**理由:**
- 持ち主が知りたいのは、閲覧数・流入元・サイト内の行動（P1 のどこまで読まれたか、実物まで進んだか）・訪問者の属性で、コアフロー（design-spec 2.2）が届いているかを確かめるため。行動はブラウザでしか取れないので、ブラウザから送る。サーバー関数で数えると、リンクにポインターを乗せた先読みと JavaScript を動かさないボットの SSR が混ざる。
- Analytics Engine は Workers Paid に含まれる枠（書き込み月1,000万件・読み取り月100万回）で足り（1日1,000閲覧・1閲覧あたり約8件で月約24万件）、バインディングで書けて外部の送信先が増えない（CSP の `connect-src 'self'` のまま）。
- 日ごとの値を KV に置くのは、期限で消えた値を戻す仕組みが無く、日が終われば IP と User-Agent が分かってもハッシュと結び付けられないため（ADR-022 のスパイク）。D1 は Time Travel（ADR-006）で消した行を30日戻せ、固定のシークレットは知る人が過去の日のハッシュを作り直して照合できる。
- 受け口を CMS API の外に置くのは、CMS API が管理者だけの API で、5.1 のミドルウェアを全手続きに一律にかける決まりのため。

**トレードオフ:**
- 日をまたいだ訪問者の識別（再訪・リテンション）、セッション単位の集計（滞在時間・直帰率）、リアルタイムの表示はできない。期間の訪問者数は、同じ人を日ごとに数え直した合計になる。
- KV は「無ければ書く」を原子的にできないので、その日の値が無いまま（初回のデプロイの当日・Cron が失敗した日）送信が来ると、最初の数十秒は拠点ごとに別の値ができ、同じ人が別の訪問者に数えられうる。受け口が isolate に持つのを5分にして、伝わり終えた後は同じ値に寄せる。同じキーへの書き込みは1秒に1回までなので、一斉に作ると書き込みが断られうるが、その送信は作った値で数える（WARN のログ `salt put failed`）。
- Cron が長く失敗すると、Analytics Engine の保持（3か月）を過ぎた日は埋められない。失敗は Sentry に送る（11章）。
- ロールバックで `triggers` を書かない古い版をデプロイしても、wrangler は既存の Cron を外さない（ADR-022）。外す操作をロールバックの手順に入れる（`docs/04_deployment-procedure.md` 5章）。
- `analytics_daily`・`analytics_rollup` は、行が日と次元とキーで決まり、Cron が丸ごと書き直すだけなので、`id`・`created_at`・`updated_at` を持たない（6.1 の例外）。
- 捨てた案:
  - Cloudflare Web Analytics: 無料で Cookie を使わないが、カスタムイベントが無く行動が取れない。見る場所も Cloudflare のダッシュボードに分かれる。
  - 外部の解析サービス（Umami Cloud・PostHog・GA4）: 外部のスクリプトと送信先が増え、CSP と7章の方針を変えることになる。GA4 は Cookie を使い重い。有料のプランは PRD 5章の費用を超える。
  - D1 に1件ずつ書く: 送信のたびに D1 への書き込みが増え、行も増え続ける（ADR-021 で D1 の数え方を捨てた理由と同じ）。
  - 画面を開いたときに集計して D1 に残す（Cron を使わない）: 3か月以上 A2・A10 を開かないと、その間が欠ける。
  - ファーストパーティの Cookie で再訪を数える: 訪問者を識別する値を持つことになり、7章の方針と同意の扱いを変える必要がある。
  - 計測を staging にも広げ、環境ごとにデータセットを分ける: 持ち主が本番だけを選んだ。

---

## 4. ルーティング

<!-- 画面の存在・目的・レイアウト・認証要否は design-spec.md が所有する。ここはルートと画面の対応だけを持ち、転記しない。 -->

### 4.1 画面のルート（TanStack Start のファイルルート。`src/routes/` からの相対パス）

| ルート | ファイル | 画面（design-spec参照） |
|--------|---------|------------------------|
| `/` | `index.tsx`（サーバーハンドラーで 302） | 画面なし。design-spec 1.4 の振り分けで `/ja` か `/en` へ |
| `/ja`、`/en` | `$lang/index.tsx` | P1 トップ |
| `/{lang}/works/{slug}` | `$lang/works.$slug.tsx` | P2 作品詳細 |
| `/{lang}/projects/{slug}` | `$lang/projects.$slug.tsx` | P3 プロジェクト詳細 |
| `/{lang}/blog/{slug}` | `$lang/blog.$slug.tsx` | P4 ブログ記事 |
| `/{lang}/coding/{slug}` | `$lang/coding.$slug.tsx` | P5 コーディング記録詳細 |
| `/{lang}/privacy` | `$lang/privacy.tsx` | P6 プライバシー |
| 公開側で一致しないパス、`$lang` が `ja`・`en` 以外、中身が見つからない | `$lang/route.tsx` の `notFoundComponent`（`__root.tsx` の `notFoundComponent` は、どのルートにも当たらないパスの受け皿） | C1（HTTP 404） |
| 公開側で中身の取得に失敗 | `$lang/route.tsx` の `errorComponent` と、ルーターの `defaultErrorComponent`（公開側の各画面のルート） | C2（HTTP 500） |
| `/admin/login` | `admin/login.tsx` | A1 |
| `/admin` | `admin/_authed/index.tsx` | A2 |
| `/admin/profile` | `admin/_authed/profile.tsx` | A3 |
| `/admin/careers`、`/admin/careers/{id}` | `admin/_authed/careers.index.tsx`、`careers.$id.tsx` | A4（一覧、編集） |
| `/admin/projects`、`/admin/projects/{id}` | `admin/_authed/projects.index.tsx`、`projects.$id.tsx` | A6 |
| `/admin/works`、`/admin/works/{id}` | `admin/_authed/works.index.tsx`、`works.$id.tsx` | A5 |
| `/admin/stacks`、`/admin/stacks/{id}` | `admin/_authed/stacks.index.tsx`、`stacks.$id.tsx` | A7 |
| `/admin/blog`、`/admin/blog/{id}` | `admin/_authed/blog.index.tsx`、`blog.$id.tsx` | A8 |
| `/admin/coding`、`/admin/coding/{id}` | `admin/_authed/coding.index.tsx`、`coding.$id.tsx` | A9 |
| `/admin/analytics` | `admin/_authed/analytics.tsx` | A10 |
| `/admin/privacy` | `admin/_authed/privacy.tsx` | A11 |
| 管理画面で一致しないパス | `admin/_authed/$.tsx`（スプラット。`beforeLoad` で `/admin` へ移す） | 画面なし。design-spec 6.6 の「存在しない管理画面の URL」の扱い |

- 管理画面の一覧は、絞り込みをクエリで持つ: `?status=draft|published`（A4〜A6・A8・A9）、`?kind=work|education`（A4）、`?kind=learning_log|snippet|problem|memo`（A9）。ダッシュボードの下書き件数からは `?status=draft` 付きで移る。A10 は期間を `?range=7d|30d|90d|1y|all` で持つ（ダッシュボードの要約からは `?range=7d`）。
- `$lang` が `ja`・`en` 以外のときの C1 の言語は、design-spec 3.1 のとおりルート `/` と同じ振り分けで決める。`$lang/route.tsx` の `beforeLoad` が表示の言語を決めて context に入れ、ローダーが `getSiteChrome`（5.11）でフッターの中身を読む。`ja`・`en` 以外のときは、読んだ結果を `notFound({ data })` に載せて投げ、C1 がそれでヘッダーとフッターを出す。C1・C2 は、ルーターが `$lang` のレイアウトの中（`Outlet`）に描くとき（子のルートが当たらない・子が失敗した）と、レイアウトの代わりに描くとき（`$lang` 自身が `notFound()`・失敗した）があるので、ヘッダーとフッターの部品（`src/site/layouts.tsx` の `SiteChrome`）は、すでに外側にあれば二重に出さない。`SiteChrome` が置く使用技術のアイコンの SVG フィルター（ADR-014）の ID が1つの画面で重ならないのも、この決まりによる。
- C2 は、取得に失敗したルートの `errorComponent` で出す。TanStack Router は SSR で、失敗したルート自身の `errorComponent`（なければルーターの `defaultErrorComponent`）を使い、親のルートへは上げない。そこで `src/router.tsx` の `defaultErrorComponent`（`src/site/status-pages.tsx` の `DefaultRouteError`）が、`$lang` の下なら C2 を出し、それ以外（管理画面）はライブラリの既定の表示にする。公開側の画面のルートは個別に `errorComponent` を付けない。見つからないとき（`notFound()`）は親へ上がるので、各ルートに `notFoundComponent` は要らない。
- 編集ビューの `{id}` が `new` のときは新規作成のビュー。新規作成で初めて保存したら、URL を作成した項目の `/{id}` に置き換える（履歴を増やさない `replace`）。
- `admin/_authed/route.tsx` は `ssr: false` のレイアウトで、`beforeLoad` でセッションを確かめ、なければ `/admin/login?redirect={開こうとしたパス}` へ移す。A1 はこのレイアウトの外に置く（`ssr: false`）。
- トップのセクションの要素の ID: `profile`、`career`、`projects`、`works`、`stack`、`blog`、`coding`。詳細ページの戻るリンクは、このうち `projects`・`works`・`blog`・`coding` をハッシュに使う。
- セクション内ページングのページ番号は URL に載せない（design-spec 6.1.3）。詳細ページの戻るリンクは `/{lang}#{セクションID}` へ移り、どの項目を含むページを開くかを history state（`{ section, itemId }`）で渡す。ブラウザの「戻る」では、離れたときのページ番号を戻す。ページ番号は history state ではなく、sessionStorage に履歴のキー（`__TSR_key`）ごとに持つ（`src/site/page-memory.ts`）。TanStack Router の history は `history.replaceState` を包んでいて、ページングのたびに書くとルーターが読み込み直し、URL にハッシュがあればそこへスクロールし直すため。同じ履歴にページ番号と `itemId` の両方があれば、ページ番号を使う（戻るリンクで来たあとにページングしていれば、離れたときのページ）。
- 言語の切り替えは、同じルートのパラメーター `lang` だけを変えて移る。ハッシュと history state は引き継がず、切り替えた先はページの一番上から始まる（ヘッダーを固定しないので、切り替えはページの一番上で押す。design-spec 1.4）。

### 4.2 画面以外のエンドポイント

| パス | 処理 | 説明 |
|---|---|---|
| `/api/auth/*` | Elysia → Better Auth | ログイン・コールバック・ログアウト・セッション取得（5.2） |
| `/api/admin/*` | Elysia → oRPC `OpenAPIHandler` | CMS API（5章のうち、ベースパス `/api/admin` の節） |
| `/media/*` | Elysia → R2 | 画像の配信（5.10） |
| `/api/collect` | Elysia（認証なし。CMS API の外） | 訪問者の解析の送信の受け口（5.14） |
| TanStack Start のサーバー関数 | TanStack Start | 公開側の読み取り（5.11）。URL は TanStack Start が決める（`/_serverFn/...`） |
| `/robots.txt` | TanStack Start のサーバールート（`src/routes/robots[.]txt.ts`） | 環境ごとに中身を変える（ADR-019） |
| `/og/*`、`/favicon.png`、`/apple-touch-icon.png`、ビルドした JS・CSS・フォント | 静的アセット（`public/` とビルドの出力） | Worker を通さずに返る（ADR-002） |

---

## 5. API設計

### 5.0 共通の決まり

- CMS API のベースパスは `/api/admin`。コントラクトは `src/api/contract/`、実装は `src/api/router/`。
- リクエスト・レスポンスの本文は JSON（アップロードだけ `multipart/form-data`）。文字コードは UTF-8。
- ID は UUID の文字列。日時は ISO 8601 の文字列（UTC。例: `"2026-09-30T03:12:45.000Z"`）。年月は `"YYYY-MM"` の文字列（例: `"2024-04"`）。日本時間の日（暦の日）は `"YYYY-MM-DD"` の文字列（例: `"2026-10-10"`。5.13）。
- 日英を持つ項目は `ja` と `en` のオブジェクトに分ける。文字列は前後の空白を取り除き、空文字は `null` として保存する。空にできる項目（文字列・URL・日時・年月）はキーを省いても `null` として扱う。`status` と `kind`（経歴・コーディング記録）、使用技術の更新の `key`・`displayName`・`category`・`isCore`・`showOnTop` は省けない（省いた PUT で値が書き換わらないように）。
- `/{id}` を持つ手続きは、入力を oRPC の `detailed`（パスの `params` と本文の `body` を分ける）にする。本文やクエリの `id` がパスの `{id}` を上書きしないようにするため。管理画面の型付きクライアントは `{ params: { id }, body }` で呼ぶ。`fieldErrors` のキーは `body.` を付けない欄の名前（`ja.title` など）にそろえる。
- 状態は `"draft"` ／ `"published"`。作成（POST）と更新（PUT）の本文の `status` に「保存後にしたい状態」を入れ、サーバーが今の状態との組み合わせで、design-spec 6.7.1 のボタンの意味（下書き保存・公開する・更新する・非公開に戻す）を決める（5.3）。
- 一覧はページングしない（design-spec 6.6）。並び順は design-spec 6.6 の表のとおりにサーバーで並べて返す。
- 文字数などの技術的な上限（超えたら `INPUT_VALIDATION_FAILED`）: タイトル・名前・所属・場所・肩書き・一言・表示名 200字、概要 500字、Markdown の本文 100,000字、URL 2,048字、スラッグ・識別名 100字。
- URL の項目の形式は design-spec 6.7.3。画像の URL の項目（サムネイル・写真・アイコン）は `/media/` で始まること。
- すべてのレスポンスに `x-request-id`（`cf-ray` の値）を付ける。
- 管理画面のクライアントは、oRPC の CSRF 対策プラグインが付けるヘッダー（`x-csrf-token: orpc`）を必ず送る（7章）。

### 5.1 ミドルウェアと認可

`/api/admin/*` のリクエストは、次の順に処理する。1 は Elysia、2 は oRPC のハンドラーのプラグイン、3〜5 は oRPC のミドルウェア（`src/api/middleware/`）で、すべての手続きに一律にかける。

| 順 | 処理 | 失敗したとき |
|---|---|---|
| 1 | リクエストID: `cf-ray`（ローカルでは UUID）をコンテキストとレスポンスヘッダーに入れる | — |
| 2 | CSRF: `SimpleCsrfProtectionHandlerPlugin` がヘッダーを確かめる | `CSRF_TOKEN_MISMATCH`（403） |
| 3 | 認証: Better Auth の `getSession` でセッションを読む。期限の延長（`updateAge`）はしない（`disableRefresh`）。ここで DB の期限を延ばしても延ばした Cookie を返す経路がないため。延長は管理画面が表示の前に呼ぶ `GET /api/auth/get-session` に任せる | セッションがない・切れている → `UNAUTHORIZED`（401） |
| 4 | レート制限: `ADMIN_RATE_LIMITER` をセッションのユーザーIDで数える（ADR-021） | `TOO_MANY_REQUESTS`（429） |
| 5 | 認可: `session.user.githubUserId === env.ADMIN_GITHUB_USER_ID` | 一致しない → `FORBIDDEN`（403） |

- 認証なしで呼べる手続きはない（`GET /api/admin/openapi.json` も同じ）。
- CSRF の確認が認証より前にあるので、CSRF のヘッダーがないリクエストは、未認証でも 403 になる。7章の権限マトリクスの「401」「403」は、CSRF のヘッダーを付けたリクエストでの結果。
- 入力の検証（Zod）は 5 の後に走るので、未認証・管理者でないリクエストは、本文の誤りより先に 401・403 になる。
- 手続きが見つからないパス・メソッドは、2 より前に `NOT_FOUND`（404、`defined: false`）を返す（存在しないパスに守るものはない）。
- 本文の解釈（JSON・multipart）は、oRPC が手続きを決めたあと 2 より前に行う。そのため、本文を解釈できないリクエストは CSRF・認証より先に `INPUT_VALIDATION_FAILED`（`formErrors`）になる。認証の前に本文を読むので、1 で本文の読み込みを 5MB ＋ 64KiB（アップロードの上限に multipart の区切りの余裕を足したもの）で止める。Content-Length は送り手が省けるので頼らない。超えたら `INPUT_VALIDATION_FAILED`（アップロードは `fieldErrors.file` に design-spec 6.7.3 の「ファイルが大きすぎます」、それ以外は `formErrors`）。

### 5.2 認証（Better Auth。`/api/auth`）

Better Auth の標準のエンドポイントを使う。管理画面は `better-auth/react` のクライアント（`src/auth/client.ts`）から呼ぶ。

| メソッド・パス | 用途 | リクエスト | レスポンス |
|---|---|---|---|
| `POST /api/auth/sign-in/social` | A1 の「GitHubでログイン」 | `{ "provider": "github", "callbackURL": "/admin/works/0f8c…", "errorCallbackURL": "/admin/login?redirect=%2Fadmin%2Fworks%2F0f8c…" }`（`callbackURL` は `redirect` クエリの値。なければ、`/admin` の下のパスでなければ、A1（`/admin/login`）自身なら `/admin`。`errorCallbackURL` は、`redirect` があれば `callbackURL` と同じ値を `redirect` に付けた A1、なければ `/admin/login`） | `200 { "url": "https://github.com/login/oauth/authorize?...", "redirect": true }` → クライアントが `url` へ移る |
| `GET /api/auth/callback/github` | GitHub からの戻り | `?code=...&state=...` | 成功: `302` で `callbackURL` へ（セッションの Cookie を付ける）。失敗: `302` で `errorCallbackURL?error={コード}` へ（`error_description` が付くことがある。A1 は読まない）。state が読めず `errorCallbackURL` が分からない失敗（state の期限切れ・戻りの URL の再読み込み）は `onAPIError.errorURL` の `/admin/login?error={コード}` へ |
| `GET /api/auth/get-session` | セッションの確認（管理画面の認証の要る画面（A2〜A11）の表示前、サイドメニューの GitHub ユーザー名） | Cookie | `200 { "session": { "id", "expiresAt", … }, "user": { "id", "name", "email", "image", "githubUserId": "1234567", "githubLogin": "octocat" } }`。ないときは `200 null` |
| `POST /api/auth/sign-out` | ログアウト | Cookie | `200 { "success": true }`。クライアントは `/admin/login?loggedOut=1` へ移る |

A1 での `error` と、design-spec 6.4 の状態の対応:

| `error` | design-spec 6.4 の状態 |
|---|---|
| `unable_to_create_user`、`unable_to_create_session`（管理者でないアカウントを hooks が拒否） | 管理者でないアカウント |
| `forbidden`（管理画面の API クライアントが `FORBIDDEN` を受けてログアウトした。8章） | 管理者でないアカウント |
| `access_denied`（GitHub 側でキャンセル） | GitHub 側でキャンセル |
| それ以外（`session_check_failed`: 管理画面のレイアウトがセッションを確かめられなかった、`too_many_requests`: GitHub からの戻りがレート制限を超えた、を含む） | 通信エラー |

- ログイン済みで A1 を開いたら、`redirect` の画面（なければ、または戻れない値なら `/admin`）へ移す。`error` の付いた A1 は、ログイン済みでも移さずに状態を出す（管理者でないセッションが残っているとき、A1 と管理画面の間を行き来させない）。
- GitHub のキー（`GITHUB_CLIENT_ID`・`GITHUB_CLIENT_SECRET`）が空のときは GitHub のプロバイダーを無効にする。ログインの開始は 404 になり、A1 は通信エラーを出す。
- `/api/auth/update-user` は Elysia が Better Auth に渡さず 404 を返す（本文は 8章の形）。CMS は使わない手続きで、`githubUserId`・`githubLogin` は GitHub のプロフィール由来だけにする（`additionalFields` の `input` を許すので、ここを塞がないと管理者のセッションから書き換えられる。値は `overrideUserInfoOnSignIn` でログインのたびに GitHub の実値に戻る）。

※ 1.7.7 で確認済み（ADR-022 のスパイク）: `access_denied`・`unable_to_create_user` は実際のログインで確かめた。`unable_to_create_session` はユーザーの行が残ったまま管理者 ID が変わったときだけ通る経路で、実ログインでは踏めないため 1.7.7 のソースで値を確かめた（フックの拒否自体は結合テストが確認している）。版を上げたら再確認する。

レート制限: Elysia が Better Auth に渡す前に、`POST /api/auth/sign-in/*` と `GET /api/auth/callback/*` だけを `AUTH_RATE_LIMITER` で IP ごとに数える（ADR-021。キーは `cf-connecting-ip`。IPv6 は上位 64 ビット）。超えたら、ログインの開始は 429（本文は 8章の形で `{ "defined": false, "code": "TOO_MANY_REQUESTS", "status": 429, "message": … }`。oRPC の手続きの外なので `defined` は `false`）、GitHub からの戻りはブラウザの画面の移動なので `302` で `/admin/login?error=too_many_requests` へ移す。ほかのパス（`get-session`・`sign-out`）は数えない。

Better Auth の設定（`src/auth/server.ts`、要点）:

```ts
export const createAuth = (env: Env) =>
  betterAuth({
    baseURL: env.SITE_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.SITE_URL],
    database: drizzleAdapter(getDb(env), {
      provider: 'sqlite',
      schema: { user: adminUser, session: adminSession, account: adminAccount, verification: authVerification },
    }),
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        // ログインのたびに GitHub のユーザー名などを最新にする
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({ githubUserId: String(profile.id), githubLogin: profile.login }),
      },
    },
    user: {
      additionalFields: {
        // input は許す（既定）。better-auth 1.7.7 は input: false のフィールドを mapProfileToUser 由来でも
        // 受け付けず、ユーザー作成が MISSING_FIELD で落ちる。書き換えの入口は update-user を塞いで閉じる（上の箇条書き）
        githubUserId: { type: 'string', required: true },
        githubLogin: { type: 'string', required: true },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: { create: { before: async (user) => (user.githubUserId === env.ADMIN_GITHUB_USER_ID ? { data: user } : false) } },
      session: { create: { before: async (session) => ((await isAdminUser(env, session.userId)) ? { data: session } : false) } },
    },
    // errorCallbackURL を読めない失敗（state の期限切れなど）も A1 へ戻す
    onAPIError: { errorURL: '/admin/login' },
    advanced: { cookiePrefix: 'eastx', database: { generateId: () => crypto.randomUUID() } },
  })
```

### 5.3 公開状態の遷移（作成・更新に共通）

経歴・作品・プロジェクト・ブログ・コーディング記録の POST・PUT は、今の状態（新規作成は「なし」）と、本文の `status` の組み合わせで次のように動く。

| 今の状態 → `status` | design-spec 6.7.1 のボタン | 入力チェック | 値を入れるカラム（入れる条件は design-spec 6.7.1） |
|---|---|---|---|
| なし ／ draft → `draft` | 下書き保存 | 下書きのルール | — |
| なし ／ draft → `published` | 公開する | 公開のルール | 作品・プロジェクト: `first_published_at`（初めて公開した日時）。ブログ・コーディング記録: `published_at`（公開日） |
| published → `published` | 更新する | 公開のルール | ブログ・コーディング記録: `content_updated_at`（更新日） |
| published → `draft` | 非公開に戻す | 下書きのルール | — |

- 下書きのルール・公開のルールの中身は design-spec 6.7.3。判定は `src/domain/publishing.ts` の関数で行う。下書きのルール（`status: "draft"` でタイトルが日英とも空）と形式の誤りは `INPUT_VALIDATION_FAILED`（`fieldErrors`）、公開のルールで足りない項目（タイトルの不足を含む）は `PUBLISH_REQUIREMENTS_NOT_MET` で返す。
- 管理画面の Cmd/Ctrl+S は、design-spec 6.7.1 の割り当てで、ボタンと同じ `status` を送る。
- スラッグの自動生成と追従（design-spec 6.7.2）は管理画面が `GET /slugs/suggest` を使って行う。サーバーは保存のときに形式と重複だけを確かめる（重複は `SLUG_CONFLICT`）。
- ブログ・コーディング記録の `publishedAt` は本文で受け取る。受け付ける値の制約は design-spec 6.7.3。

### 5.4 ダッシュボード

#### `GET /api/admin/dashboard`

A2 の件数カードと下書きの一覧。

```json
// 200
{
  "counts": {
    "careers":    { "published": 7,  "draft": 1 },
    "projects":   { "published": 6,  "draft": 1 },
    "works":      { "published": 7,  "draft": 1 },
    "stacks":     { "total": 15 },
    "blogPosts":  { "published": 12, "draft": 1 },
    "codingLogs": { "published": 11, "draft": 1 }
  },
  "drafts": {
    "items": [
      {
        "type": "blog-post",
        "id": "0f8c1e2a-5b7d-4c1e-9a3f-2d6b8e4f1a07",
        "title": { "ja": "○○について", "en": null },
        "updatedAt": "2026-09-30T03:12:45.000Z"
      }
    ],
    "total": 5
  },
  "analytics": { "measuring": true, "pageViews": 210, "visitors": 95 }
}
```

- `type` は `"career"` ／ `"project"` ／ `"work"` ／ `"blog-post"` ／ `"coding-log"`。
- `items` は design-spec 6.5 の下書きの一覧のとおり（対象の種類・件数・並び）。`total` は下書きの総数（一覧に入りきらないときの添え書きに使う）。
- `analytics` は昨日までの7日（日本時間。今日は含めない）の、`analytics_daily` の `total` の合計（ADR-023）。`visitors` は日ごとの訪問者数の合計。`measuring` は 5.13 と同じ。Analytics Engine の SQL API は呼ばない（ダッシュボードの応答を外部の API の速さに左右させない。7章の CMS API の応答の目標）。

### 5.5 プロフィール（A3）

#### `GET /api/admin/profile`

```json
// 200
{
  "id": "6b1f…",
  "ja": { "name": "東 太郎", "headline": "フロントエンドエンジニア", "tagline": "日英で届ける、使いやすい Web を作る。", "bio": "## こんにちは\n…" },
  "en": { "name": "Taro Higashi", "headline": "Frontend Engineer", "tagline": "Building usable web apps in two languages.", "bio": "## Hi\n…" },
  "avatarUrl": "/media/uploads/2026/09/2a4c….webp",
  "socialLinks": [
    { "service": "github",   "url": "https://github.com/…",      "label": null },
    { "service": "linkedin", "url": "https://www.linkedin.com/…", "label": null },
    { "service": "other",    "url": "https://example.com",        "label": "Portfolio v1" }
  ],
  "languages": { "ja": true, "en": true },
  "updatedAt": "2026-09-30T03:12:45.000Z"
}
```

- `languages` は「言語あり」の判定（design-spec 1.4）。言語タブの印に使う。
- プロフィールがまだないときは `NOT_FOUND`。A3 はこのとき空のフォームを出す（design-spec 6.7.4）。

#### `PUT /api/admin/profile`

```json
// リクエスト
{
  "ja": { "name": "東 太郎", "headline": "フロントエンドエンジニア", "tagline": "日英で届ける、使いやすい Web を作る。", "bio": "…" },
  "en": { "name": "Taro Higashi", "headline": null, "tagline": null, "bio": null },
  "avatarUrl": "/media/uploads/2026/09/2a4c….webp",
  "socialLinks": [
    { "service": "github", "url": "https://github.com/…", "label": null }
  ]
}
// 200: GET と同じ形
```

- `socialLinks` の配列の順が表示順。サーバーは `social_link` をこの配列で置き換える（1回の `batch`）。
- 行がなければ作る（upsert）。エラー: `INPUT_VALIDATION_FAILED`（名前が日英とも空、`other` で表示名が空、URL の形式）。

### 5.6 経歴（A4）

#### `GET /api/admin/careers?status={draft|published}&kind={work|education}`

クエリはどちらも任意。

```json
// 200
{
  "items": [
    {
      "id": "c1d2…",
      "kind": "work",
      "status": "published",
      "ja": { "title": "フロントエンドエンジニア", "organization": "株式会社○○" },
      "en": { "title": "Frontend Engineer", "organization": "○○ Inc." },
      "startDate": "2024-04",
      "endDate": null,
      "languages": { "ja": true, "en": true },
      "updatedAt": "2026-09-30T03:12:45.000Z"
    }
  ]
}
```

並び順: `startDate` の新しい順。`startDate` が空の下書きは先頭（design-spec 6.6）。

#### `POST /api/admin/careers`（201） ／ `PUT /api/admin/careers/{id}`（200）

```json
// リクエスト
{
  "status": "draft",
  "kind": "work",
  "startDate": "2024-04",
  "endDate": null,
  "ja": { "title": "フロントエンドエンジニア", "organization": "株式会社○○", "location": "東京", "body": "- React と TypeScript で…" },
  "en": { "title": null, "organization": null, "location": null, "body": null }
}
// レスポンス: GET /careers/{id} と同じ形
```

#### `GET /api/admin/careers/{id}`

```json
// 200
{
  "id": "c1d2…",
  "kind": "work",
  "status": "draft",
  "startDate": "2024-04",
  "endDate": null,
  "ja": { "title": "…", "organization": "…", "location": "東京", "body": "…" },
  "en": { "title": null, "organization": null, "location": null, "body": null },
  "languages": { "ja": true, "en": false },
  "createdAt": "2026-09-28T01:00:00.000Z",
  "updatedAt": "2026-09-30T03:12:45.000Z"
}
```

#### `DELETE /api/admin/careers/{id}`

`204`（本文なし）。エラー: `NOT_FOUND`。

### 5.7 作品（A5）・プロジェクト（A6）

作品は `/api/admin/works`、プロジェクトは `/api/admin/projects`。形の違いは、作品が `githubUrl` を持ち、プロジェクトが `startDate`・`endDate` を持つことだけ（design-spec 6.7.2）。以下は作品で書く。

#### `GET /api/admin/works?status={draft|published}`

```json
// 200
{
  "items": [
    {
      "id": "a7e3…",
      "slug": "my-app",
      "status": "published",
      "ja": { "title": "マイアプリ" },
      "en": { "title": "My App" },
      "hasDetail": true,
      "languages": { "ja": true, "en": true },
      "sortOrder": 0,
      "updatedAt": "2026-09-28T09:00:00.000Z"
    }
  ]
}
```

- 並び順は `sortOrder` の小さい順。`hasDetail` は詳細本文が日英のどちらかにあるか（「詳細ページの有無」列と「公開サイトで見る」の行き先に使う）。
- プロジェクトの一覧は、これに `"startDate": "2023-04", "endDate": "2024-03"` が加わる。

#### `GET /api/admin/works/{id}`

```json
// 200
{
  "id": "a7e3…",
  "status": "published",
  "slug": "my-app",
  "ja": { "title": "マイアプリ", "summary": "○○を解決するアプリ", "body": "## 背景\n…" },
  "en": { "title": "My App", "summary": "An app that…", "body": null },
  "linkUrl": "https://my-app.example.com",
  "githubUrl": "https://github.com/…/my-app",
  "thumbnailUrl": "/media/uploads/2026/09/9b1d….png",
  "stacks": [
    { "id": "s1…", "key": "react", "displayName": "React", "iconUrl": "/media/uploads/2026/09/…svg" },
    { "id": "s2…", "key": "nextjs", "displayName": "Next.js", "iconUrl": null }
  ],
  "sortOrder": 0,
  "firstPublishedAt": "2026-09-28T09:00:00.000Z",
  "hasDetail": true,
  "languages": { "ja": true, "en": true },
  "createdAt": "2026-09-20T00:00:00.000Z",
  "updatedAt": "2026-09-28T09:00:00.000Z"
}
```

`stacks` の順が、作品の中での技術の表示順（`work_stack.sort_order`）。

#### `POST /api/admin/works`（201） ／ `PUT /api/admin/works/{id}`（200）

```json
// リクエスト
{
  "status": "published",
  "slug": "my-app",
  "ja": { "title": "マイアプリ", "summary": "○○を解決するアプリ", "body": "## 背景\n…" },
  "en": { "title": "My App", "summary": "An app that…", "body": null },
  "linkUrl": "https://my-app.example.com",
  "githubUrl": null,
  "thumbnailUrl": null,
  "stackIds": ["s1…", "s2…"]
}
// レスポンス: GET /works/{id} と同じ形
```

- `stackIds` の順で `work_stack` を置き換える。存在しない ID が入っていたら `INPUT_VALIDATION_FAILED`。
- 新規作成の表示順の入れ方は 6.1。
- エラー: `INPUT_VALIDATION_FAILED`、`PUBLISH_REQUIREMENTS_NOT_MET`、`SLUG_CONFLICT`、`NOT_FOUND`（PUT）。

#### `DELETE /api/admin/works/{id}`

`204`。`work_stack` の紐づけも消える。

#### `POST /api/admin/works/reorder`

```json
// リクエスト: すべての作品の ID を、新しい表示順で
{ "ids": ["a7e3…", "b2c4…", "c9d1…"] }
// 200
{ "ids": ["a7e3…", "b2c4…", "c9d1…"] }
```

- `sortOrder` を 0 から振り直す。並べ替えでは `updated_at` を変えない（design-spec 6.6 の「最終保存日」は中身の保存の日時のため。6.1）。`ids` が今の作品の集合と一致しないとき（別のタブで追加・削除されたなど）は `ORDER_OUT_OF_DATE`（409）を返し、管理画面は一覧を読み直して design-spec 6.6 の「並べ替えの保存に失敗」を出す。

### 5.8 使用技術（A7）

#### `GET /api/admin/stacks`

```json
// 200
{
  "items": [
    {
      "id": "s1…",
      "key": "react",
      "displayName": "React",
      "iconUrl": "/media/uploads/2026/09/….svg",
      "linkUrl": "https://react.dev",
      "category": "frameworks",
      "isCore": true,
      "showOnTop": true,
      "sortOrder": 0,
      "usageCount": 5
    }
  ]
}
```

`usageCount` は、この技術を使っている作品とプロジェクトの数の合計（一覧の列と削除の確認ダイアログに使う）。並び順は `sortOrder`。A5・A6 の「+ 追加」の候補もこの一覧を使う。`category` は `"languages"` ／ `"frameworks"` ／ `"infrastructure"` ／ `"tools"`（`src/db/enums.ts` の `STACK_CATEGORIES`）、`isCore` は Core（主要な技術）の印。

#### `GET /api/admin/stacks/{id}`

一覧の1件と同じ形に `createdAt`・`updatedAt` を加えたもの。

#### `POST /api/admin/stacks`（201）

```json
// リクエスト（A7 の新規作成）
{ "key": "react", "displayName": "React", "iconUrl": null, "linkUrl": "https://react.dev", "category": "frameworks", "isCore": true, "showOnTop": true }
// リクエスト（A5・A6 の「新しい技術として追加」。表示名と showOnTop だけ）
{ "displayName": "Hono", "showOnTop": false }
// 201: GET /stacks/{id} と同じ形
```

- `key` を省くと、design-spec 6.7.1 の規則で表示名から作る。
- `showOnTop` を省くと `true`。A5・A6 の「新しい技術として追加」からは `showOnTop: false` を付けて送る（design-spec 6.7.1）。表示順の入れ方は 6.1。
- `category` を省くと `"tools"`、`isCore` を省くと `false`。
- `isCore: true` と `showOnTop: false` の組み合わせは `INPUT_VALIDATION_FAILED`（`fieldErrors.showOnTop`。文言は design-spec 6.7.3）。`showOnTop` を省いたときは `true` になるので、`isCore: true` だけを送っても通る。DB の CHECK では縛らない（6.4 の `stack` の注記）。
- 4つ以外の `category` は `INPUT_VALIDATION_FAILED`（`fieldErrors.category`）。
- エラー: `INPUT_VALIDATION_FAILED`、`STACK_KEY_CONFLICT`（`key` を指定して重複したとき）。

#### `PUT /api/admin/stacks/{id}`（200）

本文は POST と同じで、`key`・`displayName`・`category`・`isCore`・`showOnTop` は必須（省いた PUT で値が書き換わらないように。5.0）。Core とトップに表示するかの組み合わせの誤りは POST と同じ。

#### `DELETE /api/admin/stacks/{id}`

`204`。`work_stack`・`project_stack` の紐づけも消える。

#### `POST /api/admin/stacks/reorder`

作品と同じ形（`{ "ids": [...] }`）。

### 5.9 ブログ記事（A8）・コーディング記録（A9）

ブログ記事は `/api/admin/blog-posts`、コーディング記録は `/api/admin/coding-logs`。形の違いは、コーディング記録が `kind` と `referenceUrl` を持つことだけ。以下はコーディング記録で書く。

#### `GET /api/admin/coding-logs?status={draft|published}&kind={learning_log|snippet|problem|memo}`

ブログ記事は `kind` のクエリを持たない。

```json
// 200
{
  "items": [
    {
      "id": "d4e5…",
      "slug": "tanstack-start-on-workers",
      "kind": "learning_log",
      "status": "published",
      "ja": { "title": "TanStack Start を Workers で動かす" },
      "en": { "title": null },
      "languages": { "ja": true, "en": false },
      "publishedAt": "2026-09-12T10:00:00.000Z",
      "updatedAt": "2026-09-30T03:12:45.000Z"
    }
  ]
}
```

並び順: 下書きを `updatedAt` の新しい順で先頭に、続けて公開中のものを `publishedAt` の新しい順（design-spec 6.6）。

#### `GET /api/admin/coding-logs/{id}`

```json
// 200
{
  "id": "d4e5…",
  "status": "published",
  "slug": "tanstack-start-on-workers",
  "kind": "learning_log",
  "ja": { "title": "TanStack Start を Workers で動かす", "body": "## やったこと\n```ts\n…\n```" },
  "en": { "title": null, "body": null },
  "referenceUrl": "https://tanstack.com/start",
  "thumbnailUrl": null,
  "publishedAt": "2026-09-12T10:00:00.000Z",
  "contentUpdatedAt": null,
  "languages": { "ja": true, "en": false },
  "createdAt": "2026-09-10T00:00:00.000Z",
  "updatedAt": "2026-09-30T03:12:45.000Z"
}
```

#### `POST /api/admin/coding-logs`（201） ／ `PUT /api/admin/coding-logs/{id}`（200）

```json
// リクエスト
{
  "status": "published",
  "slug": "tanstack-start-on-workers",
  "kind": "learning_log",
  "ja": { "title": "TanStack Start を Workers で動かす", "body": "…" },
  "en": { "title": null, "body": null },
  "referenceUrl": "https://tanstack.com/start",
  "thumbnailUrl": null,
  "publishedAt": null
}
// レスポンス: GET /coding-logs/{id} と同じ形
```

- `publishedAt` が `null` のまま公開すると、今の日時が入る（5.3）。
- 一度も公開していないもの（今の `published_at` が空）は、`publishedAt` に `null` だけを受け付ける（公開日を入れられるのは公開した後。design-spec 6.7.2）。
- エラー: `INPUT_VALIDATION_FAILED`、`PUBLISH_REQUIREMENTS_NOT_MET`、`SLUG_CONFLICT`、`NOT_FOUND`（PUT）。

#### `DELETE /api/admin/coding-logs/{id}`

`204`。

### 5.10 スラッグ・アップロード・画像の配信・OpenAPI

#### `GET /api/admin/slugs/suggest?type={work|project|blog-post|coding-log}&title={英語のタイトル}&excludeId={id}`

英語のタイトルから、同じ種類の中で重複しないスラッグを作る（design-spec 6.7.2）。`excludeId` は編集中の項目の ID（新規作成では省く）。

```json
// 200
{ "slug": "my-app-2" }
// 変換して空になるとき
{ "slug": null }
```

#### `GET /api/admin/slugs/availability?type={…}&slug={スラッグ}&excludeId={id}`

手で入力したスラッグが使えるか（入力欄の下の表示に使う）。

```json
// 200
{ "available": false }
```

形式が正しくないときは `INPUT_VALIDATION_FAILED`。

#### `POST /api/admin/uploads`

`multipart/form-data` で `file` に画像を1つ入れる。

```json
// 201
{ "url": "/media/uploads/2026/10/0f8c1e2a-5b7d-4c1e-9a3f-2d6b8e4f1a07.webp", "contentType": "image/webp", "size": 183204 }
```

- 上限 5MB。形式は `image/png`・`image/jpeg`・`image/webp`・`image/gif`・`image/avif`・`image/svg+xml`。宣言された形式だけでなく、先頭のバイト（SVG は `<svg` を含むこと）でも確かめる。
- エラー: `INPUT_VALIDATION_FAILED`（`fieldErrors.file`。画面の文言は design-spec 6.7.3）。

#### `GET /media/{key}`（認証なし）

- R2 から読んで返す。ないときは `404`。
- ヘッダー: `Content-Type`（保存時の形式）、`Cache-Control: public, max-age=31536000, immutable`、`ETag`、`X-Content-Type-Options: nosniff`。`If-None-Match` が一致すれば `304`。
- SVG には `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` を付ける（直接開かれてもスクリプトを動かさない）。

#### `GET /api/admin/openapi.json`

oRPC の `OpenAPIGenerator` で作った OpenAPI 3.1 の仕様（管理者だけ）。

### 5.11 公開側のサーバー関数（`src/content/`）

公開側のローダーが呼ぶ、読み取り専用のサーバー関数。**公開中（`status = 'published'`）の中身だけを返す。** 公開の状態を持たない1件だけの中身のうち、プライバシーのページ（`privacy_page`）は本文の有無で出す（本文が日英とも空なら存在しない。プロフィールは状態を持たず、行があればそのまま出す）。言語の代替（design-spec 1.4）はここで行い、表示用の形で返す。

共通の型:

```ts
type Lang = 'ja' | 'en'
/** 表示する文字列と、実際に使った言語（代替したときはもう一方の言語） */
type LocalizedText = { value: string; lang: Lang }
/** Markdown を描画した HTML と、実際に使った言語 */
type LocalizedHtml = { html: string; lang: Lang }
/** 中身全体の言語。fallback が true なら、言語ラベル・注記を出す */
type Availability = { lang: Lang; fallback: boolean }
type StackChip = { key: string; displayName: string; iconUrl: string | null; linkUrl: string | null }
type StackCategory = 'languages' | 'frameworks' | 'infrastructure' | 'tools'
type Period = { start: string /* YYYY-MM */; end: string | null }
type Neighbor = { slug: string; title: LocalizedText } | null
type PageMeta = { title: string; description: string | null; ogImageUrl: string; alternates: { ja: string; en: string } }
```

| 関数 | 入力 | 出力 | 見つからないとき |
|---|---|---|---|
| `getTopPage` | `{ lang }` | `TopPageView` | — |
| `getWorkDetail` | `{ lang, slug }` | `WorkDetailView` | 存在しない・非公開・詳細本文なし → `notFound()`（C1） |
| `getProjectDetail` | `{ lang, slug }` | `ProjectDetailView` | 同上 |
| `getBlogPost` | `{ lang, slug }` | `BlogPostView` | 存在しない・非公開 → `notFound()` |
| `getCodingLog` | `{ lang, slug }` | `CodingLogView` | 同上 |
| `getPrivacyPage` | `{ lang }` | `PrivacyPageView` | 行が無い・本文が日英とも空 → `notFound()`（C1） |
| `getSiteChrome` | なし | `SiteChromeView` | — |

```ts
type TopPageView = {
  lang: Lang
  meta: PageMeta
  profile: null | {
    name: LocalizedText | null
    headline: LocalizedText | null
    tagline: LocalizedText | null
    bio: LocalizedHtml | null          // 太字と一致した使用技術のアイコン入り（ADR-012）
    avatarUrl: string | null
    socialLinks: { service: SocialService; url: string; label: string | null }[]
  }
  careers: {
    id: string; kind: 'work' | 'education'; period: Period
    title: LocalizedText; organization: LocalizedText | null; location: LocalizedText | null
    body: LocalizedHtml | null; availability: Availability
  }[]
  projects: {
    id: string; slug: string; title: LocalizedText; summary: LocalizedText | null; period: Period
    thumbnailUrl: string | null; linkUrl: string | null; hasDetail: boolean
    stacks: StackChip[]; availability: Availability
  }[]
  works: {
    id: string; slug: string; title: LocalizedText; summary: LocalizedText | null
    thumbnailUrl: string | null; linkUrl: string | null; githubUrl: string | null; hasDetail: boolean
    stacks: StackChip[]; availability: Availability
  }[]
  stackGroups: {                            // show_on_top のものだけ。空の群は含めない
    key: 'core' | StackCategory             // core → languages → frameworks → infrastructure → tools の順
    stacks: StackChip[]                     // 群の中は表示順。Core の技術は core の群にだけ入る
  }[]
  blogPosts: {
    id: string; slug: string; publishedAt: string; title: LocalizedText; availability: Availability
  }[]
  codingLogs: {
    id: string; slug: string; kind: CodingLogKind; publishedAt: string; title: LocalizedText
    availability: Availability
  }[]
}

type WorkDetailView = {
  lang: Lang; meta: PageMeta
  id: string; slug: string; title: LocalizedText; availability: Availability
  body: LocalizedHtml                       // body.lang !== lang なら、本文の上に注記（design-spec 6.2.3）
  thumbnailUrl: string | null; linkUrl: string | null; githubUrl: string | null
  stacks: StackChip[]
  prev: Neighbor; next: Neighbor            // 詳細ページを持つ公開中の作品の、表示順の前後
}
type ProjectDetailView = Omit<WorkDetailView, 'githubUrl'> & { period: Period }

type BlogPostView = {
  lang: Lang; meta: PageMeta
  id: string; slug: string; title: LocalizedText; body: LocalizedHtml; availability: Availability
  publishedAt: string
  contentUpdatedAt: string | null           // 公開日より後のときだけ入れる（design-spec 6.3）
  thumbnailUrl: string | null
  newer: Neighbor; older: Neighbor
}
type CodingLogView = BlogPostView & { kind: CodingLogKind; referenceUrl: string | null }

type PrivacyPageView = {
  lang: Lang; meta: PageMeta
  body: LocalizedHtml                       // body.lang !== lang なら、本文の上に注記（design-spec 6.2.4）
  updatedAt: string                         // 最終更新日（行の updated_at）
}

/** 公開側の全画面（C1・C2 を含む）の共通の中身（フッター（design-spec 6.1.2）と解析の送信のオン・オフ）。`$lang/route.tsx` のローダーが読む */
type SiteChromeView = {
  socialLinks: { service: SocialService; url: string; label: string | null }[]  // プロフィールのSNSリンク。プロフィールがなければ空
  hasPrivacyPage: boolean                   // プライバシーのページの本文が日英のどちらかにある
  analyticsBeacon: boolean                  // ANALYTICS_BEACON が on（ブラウザの解析の送信を動かす。ADR-023）
}
```

- 各配列は design-spec 6.1.3 の並び順で返す。0件の配列はそのまま返し、セクションを出すかどうかは画面が決める。
- `getTopPage` は1回の `db.batch()` で全セクションと、自己紹介の描画に渡す使用技術の全件（`key`・`displayName`・`iconUrl`）を読む。ブログ・コーディング記録は本文を読まず、「言語あり」の判定（design-spec 1.4）のために本文があるかだけを読む。
- 詳細ページの `body` が両方の言語で空のブログ・コーディング記録は、公開のルールで起こらない。
- P1 がセクションを出すかは、`getTopPage` の配列が0件かで画面が決める。使用技術は「トップに表示する」の技術が1件以上で出す。
- `getSiteChrome` は中身が言語に依らないので入力を取らない。読めなかった画面（`getSiteChrome` 自身が失敗した C2、`$lang` が `ja`・`en` 以外で読み取りにも失敗した C1、どのルートにも当たらない C1）は、SNS リンクを空、`hasPrivacyPage` を `false` にしたフッターを出し（全画面のフッターを出し続ける）、`analyticsBeacon` を `false` にして解析を送らない。`analyticsBeacon` は D1 を読まず、Worker の変数 `ANALYTICS_BEACON` が `on` かで決める。`$lang` が `ja`・`en` 以外の C1 も、読めた結果を使うので送る。子のルートの失敗の C2 は `$lang` のレイアウトの中に描くので、読んだフッターのまま出す（4.1）。このとき解析は、送信の部品がルーターの失敗の状態を見て送らない（5.14）。SNS リンクと同じ1回の `db.batch()` で、`privacy_page` の本文があるかだけを読み（本文の全文は読まない）、`src/domain/languages.ts` の判定（5.12 の `languages` と同じ関数）で `hasPrivacyPage` を決める。行が無ければ `false`。本文があるかは `NULL` かどうかで読むので、本文が `NULL` に正規化されていること（5.12 の PUT と 6.4 の CHECK）を前提にする。同じ batch に入れるので、テーブルの無い DB ではフッター全体が読めなくなるが、デプロイはマイグレーションをコードより先に当て、失敗すればデプロイしない（`docs/04_deployment-procedure.md` 2章）ので、新しいコードがテーブルの無い DB に当たることは無い。
- `getPrivacyPage` の判定は、行があり本文が日英のどちらかにあること（`src/domain/languages.ts` の判定。design-spec 1.4 の言語ありの判定を本文に当てる）。本文は項目単位の代替表示で選び（design-spec 1.4）、描画結果は ADR-011 の Cache API に種類 `privacy`・行の `id` で入る。`meta` は ADR-019。最終更新日は行の `updated_at` で、日英で同じ日付になる。

### 5.12 プライバシーのページ（A11）

#### `GET /api/admin/privacy`

```json
// 200
{
  "id": "9c2e…",
  "ja": { "body": "## アクセスの集計\n…" },
  "en": { "body": "## Analytics\n…" },
  "languages": { "ja": true, "en": true },
  "updatedAt": "2026-10-10T03:12:45.000Z"
}
```

- `id` は 5.5 と同じく行の ID（自動退避のキーに使う。ADR-008）。
- `languages` は本文があるか（言語タブの印。design-spec 6.7.1）。
- 行がまだ無いときは `NOT_FOUND`。A11 はこのとき空のフォームを出す（design-spec 6.7.4）。

#### `PUT /api/admin/privacy`

```json
// リクエスト
{ "ja": { "body": "…" }, "en": { "body": null } }
// 200: GET と同じ形
```

- 行がなければ作る。行（1件だけ）の upsert を `insert … on conflict (singleton) do update` の1文で行う（確かめてから書く形にしない。ADR-006）。`on conflict do update` では Drizzle の `$onUpdateFn` が効かないので、`updated_at` を明示して入れる（公開側の最終更新日がこの値）。応答は書いた後に読み直して作る。
- 本文は 5.0 のとおり前後の空白を除き、空なら `NULL` で保存する（空白と改行だけの本文は `NULL`）。日英とも空でもよい（公開側にページもリンクも出なくなる）。
- エラー: `INPUT_VALIDATION_FAILED`（本文が Markdown の上限 100,000字を超える）。

### 5.13 アクセス解析（A10）

#### `GET /api/admin/analytics?range={7d|30d|90d|1y|all}`

```json
// 200
{
  "measuring": true,
  "range": "30d",
  "from": "2026-09-11",
  "to": "2026-10-10",
  "today": { "included": true },
  "missingDays": 0,
  "totals": {
    "pageViews": 1234, "visitors": 456, "outbound": 78,
    "previous": { "pageViews": 1100, "visitors": 410, "outbound": 60 }
  },
  "series": {
    "bucket": "day",
    "points": [{ "start": "2026-09-11", "pageViews": 40, "visitors": 18 }]
  },
  "pages": [{ "path": "/ja", "title": null, "pageViews": 520, "visitors": 210 }],
  "referrers": [{ "key": "www.linkedin.com", "count": 40, "visitors": 31 }],
  "utm": [{ "key": "linkedin|social|", "count": 12, "visitors": 10 }],
  "sectionReach": [{ "section": "career", "visitors": 150, "rate": 0.72 }],
  "rowExpands": [{ "section": "works", "itemId": "a7e3…", "title": { "ja": "マイアプリ", "en": "My App" }, "count": 30, "visitors": 22 }],
  "outbounds": [{ "linkKind": "github", "host": "github.com", "count": 20, "visitors": 18 }],
  "readCompletes": [{ "path": "/ja/blog/hello", "title": { "ja": "…", "en": null }, "count": 15, "visitors": 14 }],
  "otherActions": {
    "langSwitch": { "ja": 3, "en": 9 },
    "themeSwitch": { "system": 1, "light": 2, "dark": 5 },
    "codeCopy": 4,
    "paging": { "career": 0, "projects": 0, "works": 12, "blog": 5, "coding": 0 }
  },
  "audience": {
    "countries": [{ "key": "JP", "count": 800, "visitors": 300 }],
    "devices": [{ "key": "mobile", "count": 700, "visitors": 280 }],
    "browserLangs": [{ "key": "ja", "count": 900, "visitors": 330 }],
    "siteLangs": [{ "key": "ja", "count": 1000, "visitors": 380 }]
  }
}
```

- `measuring` は、Worker にバインディング `ANALYTICS`（Analytics Engine）と `ANALYTICS_SALTS`（KV）の両方があるか（本番だけ。ADR-023）。`false` のとき A10 は計測しない環境の表示を出す（design-spec 6.8）。
- 期間は日本時間の今日を含む N 日（`7d` 7日、`30d` 30日、`90d` 90日、`1y` 365日）。`all` は計測の開始日（`analytics_rollup` の最も古い日）から今日まで（行が無ければ今日だけ）。`from`・`to` は期間の最初と最後の日（`to` は今日）。
- 確定した日（`analytics_rollup` にある日）は `analytics_daily` から読む。今日の分は Analytics Engine の SQL API から読み（Cron と同じ問い合わせの部品で、今日の 00:00 JST から今まで）、足す。`today.included` は今日の分を足したか。`ANALYTICS_API_TOKEN` か `CF_ACCOUNT_ID` が無い（未登録と空文字の両方）、SQL API が失敗した、3秒で応答しない（`AbortSignal.timeout`）ときは `false` にし、エラーにしない。
- 昨日までで `analytics_rollup` に無い日（Cron がまだ動いていない・失敗した）は、ここでは埋めない（埋めるのは Cron だけ。書き込みを1か所にまとめ、A10 の表示を遅くしない）。`missingDays` は、期間の中で、計測の開始日から昨日までのうち `analytics_rollup` に無い日の数（開始日より前の日は数えない。`analytics_rollup` が空なら0）。
- `totals`: `pageViews`・`visitors` は次元 `total`、`outbound` は次元 `outbound_total` の件数の期間の合計。`visitors` は日ごとの訪問者数の合計（日をまたいで同じ人を数え分けない）。`previous` は同じ長さの直前の期間の合計（D1 の集計だけ）で、直前の期間が計測の開始日より前に始まるとき・開始日が無いとき・`all` のときは `null`。
- `series.bucket` は `7d`・`30d`・`90d` が `day`、`1y` が `week`（月曜始まり）、`all` が `month`。`points` は期間のすべての区切りを古い順に返し、データの無い区切りは0。`start` は区切りの最初の日で、期間の最初の区切りは期間の最初の日から始まる（月曜・1日でなくてよい）。区切りの訪問者数は日ごとの訪問者数の合計。
- 一覧（`pages`・`referrers`・`utm`・`rowExpands`・`outbounds`・`readCompletes`・`audience` の各配列）は、期間で合計して `count`（`pages` は `pageViews`）の多い順（同じなら `key` の昇順）に上位10件。`(other)` の行は除く。
- `title` は、`path` が `/{lang}/(works|projects|blog|coding)/{slug}` の形なら、今の D1 の中身（公開中かを問わない）のタイトルを `{ ja, en }` で返す。それ以外（P1・P6・C1 の URL）と、スラッグが今の中身に無いもの（変えた・消した）は `null`。`rowExpands` の `title` は `itemId` で経歴・作品・プロジェクトから引く（消したものは `null`）。
- `sectionReach` は、`section_view` の `visitors` ÷ `top_view` の `visitors`（どちらも期間の日ごとの合計）。`profile` から `coding` まで 4.1 の順で全部返し、分母が0なら `rate` は `null`。
- `otherActions.paging` は、セクション内ページングを持つ5つのセクション（4.1 の順）を0件も含めて返す。
- エラー: `INPUT_VALIDATION_FAILED`（`range` が5つ以外）。D1 の失敗は `INTERNAL_SERVER_ERROR`。

集計の次元（`analytics_daily.dimension`。Cron と今日の分の読み取りが、Analytics Engine の1件（5.14 の表）から同じ問い合わせで作る。`src/api/analytics/queries.ts`）:

| `dimension` | 元のイベント | `key` | `count` | `visitors` |
|---|---|---|---|---|
| `total` | `page_view` | 空文字 | 閲覧数 | 訪問者数 |
| `page` | `page_view` | `path` | 閲覧数 | 訪問者数 |
| `referrer` | `page_view`（流入元のホスト名があるもの） | ホスト名 | 件数 | 訪問者数 |
| `utm` | `page_view`（UTM があるもの） | `source\|medium\|campaign` | 件数 | 訪問者数 |
| `country` | `page_view` | 国のコード | 閲覧数 | 訪問者数 |
| `device` | `page_view` | `mobile`・`tablet`・`desktop` | 閲覧数 | 訪問者数 |
| `browser_lang` | `page_view` | 言語タグの主の部分（無ければ `(unknown)`） | 閲覧数 | 訪問者数 |
| `site_lang` | `page_view` | `ja`・`en` | 閲覧数 | 訪問者数 |
| `top_view` | `page_view`（`path` が `/ja`・`/en`） | 空文字 | 閲覧数 | 訪問者数（セクション到達率の分母） |
| `section_view` | `section_view` | `section` | 件数 | 訪問者数（到達率の分子） |
| `read_complete` | `read_complete` | `path` | 件数 | 訪問者数 |
| `row_expand` | `row_expand` | `{section}:{itemId}` | 件数 | 訪問者数 |
| `paging` | `paging` | `section` | 件数 | 訪問者数 |
| `outbound` | `outbound` | `{linkKind}:{host}` | 件数 | 訪問者数 |
| `outbound_total` | `outbound` | 空文字 | 件数 | 訪問者数（`totals.outbound`） |
| `lang_switch` | `lang_switch` | `to` | 件数 | 訪問者数 |
| `theme_switch` | `theme_switch` | `to` | 件数 | 訪問者数 |
| `code_copy` | `code_copy` | `path` | 件数 | 訪問者数 |

- 1日ぶんは1本の問い合わせで読む。記録の値（`blob1`〜`blob13`）と訪問者のハッシュ（`blob14`）の組ごとに `SUM(_sample_interval)` を返させ、次元ごとの数は Worker で数える。件数はその日・そのキーの組の `SUM(_sample_interval)` の合計、訪問者数はその日・そのキーの訪問者のハッシュの種類の数。サンプリングは index（訪問者）ごとに均すので、種類の数は崩れない（ADR-022）。応答の数や列（`blob1`〜`blob14`）が読めなければ、その日は確定させない（例外にして、次の実行でやり直す）。
- 次元ごとに問い合わせを分けない。Worker は1回の呼び出しで応答を待つ接続を6本までしか同時に持てず、7本目からは前の応答を待つ。18本に分けると6本ずつ3回に分かれて順に流れるので、SQL API の1本が1秒を超えると、A10 が今日の分を待つ3秒を超える。
- 1日・1次元の行は、件数の多い順（同じなら `key` の昇順）に上位100件と、残りをまとめた `(other)` の1行（残りがあるときだけ）。件数が0の行は作らない。

### 5.14 解析の受け口（`/api/collect`。CMS API の外）

#### `POST /api/collect`

公開側の訪問者のブラウザが、表示と行動のイベントを1件ずつ送る（ADR-023）。CMS API（`/api/admin/*`）は管理者だけが使い、5.1 のミドルウェア（CSRF・認証・認可）を全手続きに一律にかける決まりなので、訪問者が送る受け口は oRPC の手続きにせず、Elysia のルートとして `/media/*` と同じ並びに置く。入力の検査は `src/domain/analytics/` の関数で行う（Zod を公開側のバンドルに入れないため。公開側は同じイベントの名前の定数だけを共有する）。

本文は JSON の文字列（ブラウザは `navigator.sendBeacon` で `text/plain` の Blob として送る。同じ origin なので CORS の事前確認は無いが、Content-Type による違いを持ち込まない。`sendBeacon` が無ければ `fetch` の `keepalive`）。共通の値は `type`、`path`（`location.pathname`。クエリとハッシュは送らない）、`lang`（表示している言語。`$lang` が `ja`・`en` 以外の C1 でも、表示に使った言語）。

送るのは、`SiteChromeView.analyticsBeacon`（5.11）が `true` の画面（P1〜P6 と `$lang` の下の C1）だけで、ブラウザが DNT（`navigator.doNotTrack === '1'`）・GPC（`navigator.globalPrivacyControl === true`）・`navigator.webdriver` のどれかなら何も送らない。C2（子のルートの失敗を含む）とどのルートにも当たらない C1 は送らない。送信の部品は `src/site/analytics.ts`。受け口の検査（下の表）で1件ごと捨てられないよう、ブラウザは `|` を含む・100字を超える UTM の値を送らず、2,048字を超える参照元は origin にして送る。

| `type` | 送るとき | 固有の値 |
|---|---|---|
| `page_view` | 送信の部品の初期化で今の `path` を1回送り、それを「前回」とする。以後はルーターの `onResolved` で、前回と違う `path` のときだけ送る（ハッシュだけの移動・同じパスの読み込み直しは送らない。戻る・進むは `path` が変われば送る）。bfcache から戻ったとき（`pageshow` の `persisted`）は、前回を消してから今の `path` を送る | `referrer`（文書を読み込んだ最初の1回だけ `document.referrer`）、`utm`（最初の1回だけ。URL の `utm_source`・`utm_medium`・`utm_campaign`。どれも無ければ送らない） |
| `section_view` | P1 で、各セクションの見出し（4.1 のセクションの要素の中の最初の見出し）が初めて画面に入ったとき（`IntersectionObserver`。1回の表示で各セクション1回） | `section` |
| `read_complete` | P2〜P5 で、本文の最後（前後のナビの直前に置く印）が初めて画面に入ったとき（1回の表示で1回） | なし |
| `row_expand` | P1 の経歴・作品・プロジェクトの行を広げたとき（閉じたときは送らない） | `section`、`itemId` |
| `paging` | P1 のセクション内ページングで、ページを移ったとき | `section`、`page`（移った先） |
| `outbound` | 別タブで開くリンク（`a[target="_blank"]`）を押したとき（`click`。中ボタンは `auxclick`）。公開側のレイアウトの1か所で受け、`data-analytics-link` の属性の値を `linkKind` にする（属性の無い Markdown の本文のリンクは `body`） | `linkKind`（`site`: サイトを見る、`github`: GitHub、`social`: プロフィールとフッターの SNS、`stack`: 使用技術のリンク、`reference`: コーディング記録の参考リンク、`body`: 本文中のリンク）、`host` |
| `lang_switch` | ヘッダーの言語の切り替えを押したとき | `to` |
| `theme_switch` | ヘッダーのテーマの切り替えを押したとき | `to` |
| `code_copy` | 本文のコードブロックの「コピー」（`data-code-copy` の属性を持つボタン）を押したとき。公開側のレイアウトの1か所で受ける | なし |

```json
{ "type": "page_view", "path": "/ja/works/my-app", "lang": "ja", "referrer": "https://www.linkedin.com/feed/", "utm": { "source": "linkedin", "medium": "social", "campaign": null } }
{ "type": "row_expand", "path": "/ja", "lang": "ja", "section": "works", "itemId": "a7e3c1d2-…" }
{ "type": "outbound", "path": "/en/works/my-app", "lang": "en", "linkKind": "github", "host": "github.com" }
```

| 値 | 規則（違えば 400） |
|---|---|
| 本文 | 4KB まで。JSON のオブジェクト。`type` ごとに決めたキーだけ（ほかのキーがあれば 400） |
| `type` | `page_view`・`section_view`・`read_complete`・`row_expand`・`paging`・`outbound`・`lang_switch`・`theme_switch`・`code_copy` |
| `path` | `/` で始まり、300字まで。公開側のルート（4.1）の形に当たらないもの（C1 の URL）も受け付ける |
| `lang` | `ja`・`en` |
| `referrer`（`page_view` だけ。省ける） | 2,048字まで。`http:`・`https:` の URL か空。記録するのはホスト名だけ（末尾の点は除く）で、`SITE_URL` のホストと、ホスト名の形でないもの（`(other)`・IPv6 のアドレスなど。集計の予約のキーと重ねない）は空にする（閲覧は数える） |
| `utm`（`page_view` だけ。省ける） | `source`・`medium`・`campaign` のオブジェクト。各値は文字列か `null`。100字まで、前後の空白を除いて英小文字にする。`\|` を含めば 400（記録の区切りに使う） |
| `section` | `section_view` は `profile`・`career`・`projects`・`works`・`stack`・`blog`・`coding`。`row_expand` は `career`・`projects`・`works`。`paging` は `career`・`projects`・`works`・`blog`・`coding` |
| `itemId` | UUID の形 |
| `page` | 1〜1000 の整数 |
| `linkKind` | `site`・`github`・`social`・`stack`・`reference`・`body` |
| `host` | 253字まで、ホスト名の形 |
| `to` | `lang_switch` は `ja`・`en`、`theme_switch` は `system`・`light`・`dark` |

処理の順:

1. 本文を 4KB で読み止める（Content-Length に頼らない）。形・値・`Origin` を検査する
2. `COLLECT_RATE_LIMITER` で IP ごとに数える（ADR-021。キーは `rate-limit-key.ts`）
3. 除外: `DNT: 1`・`Sec-GPC: 1` のヘッダー、ボットの User-Agent（`src/domain/analytics/bots.ts`。User-Agent が無い・空の送信もボットとして扱う）、管理者のセッション（Cookie にセッションのトークンがあるときだけ `getSession`（`disableRefresh`）で読み、`ADMIN_GITHUB_USER_ID` の人なら除く。Cookie が無ければ D1 を読まない）
4. バインディング `ANALYTICS`・`ANALYTICS_SALTS` が無ければ（staging・ローカル）書かない
5. 訪問者のハッシュ（ADR-023）を作り、Analytics Engine に1件書く（下の表）

| 応答 | 条件 |
|---|---|
| `204`（本文なし） | 書いた、除外した、バインディングが無い、書き込み（`writeDataPoint`）が例外を投げた（ERROR のログと Sentry に送る。ブラウザはやり直さないので 500 を返しても結果は同じ）。除外したかどうかを外から見せない |
| `400` | 本文が 4KB を超える・JSON でない・値の検査に通らない。本文は8章の形で `{ "defined": false, "code": "INPUT_VALIDATION_FAILED", "status": 400, "message": … }`（oRPC の手続きの外なので `defined` は `false`。ブラウザは応答を読まないので `fieldErrors` を返さない） |
| `403` | `Origin` があり、`SITE_URL` の origin と違う。本文は8章の形（`FORBIDDEN`）。`Origin` の無い送信は受け付ける |
| `404` | `POST` 以外（5.1 の「手続きの無いメソッドは 404」と同じ受け皿） |
| `429` | `COLLECT_RATE_LIMITER` を超えた。本文は8章の形（`TOO_MANY_REQUESTS`） |

Analytics Engine の1件（データセット `eastx_analytics`。`timestamp` は Analytics Engine が書き込みの時刻を入れる）:

| 位置 | 値 |
|---|---|
| `index1` | 訪問者のハッシュ |
| `blob1` | `type` |
| `blob2` | `path` |
| `blob3` | `lang`（表示している言語） |
| `blob4` | 流入元のホスト名（`page_view` の `referrer`。無ければ空） |
| `blob5` | `utm`（`source\|medium\|campaign`。無いものは空。全部無ければ空） |
| `blob6` | 国（`request.cf.country`。無ければ `XX`） |
| `blob7` | デバイス（User-Agent から `mobile`・`tablet`・`desktop`） |
| `blob8` | ブラウザの言語（`Accept-Language` の q 値で最優先の言語タグの主の部分を英小文字で。例 `ja`・`zh`。無ければ空） |
| `blob9` | `section` |
| `blob10` | `itemId` |
| `blob11` | `linkKind` |
| `blob12` | `host` |
| `blob13` | `to` |
| `blob14` | 訪問者のハッシュ（`index1` と同じ値。1日ぶんの問い合わせで記録の値との組を `GROUP BY` で読むために blob にも置く。5.13） |
| `double1` | `page`（無ければ 0） |

- 値の無い blob も空文字で書き、14個をそろえる（1日ぶんの問い合わせが14列とも文字列で読め、Worker の条件（`blob4` が空でない など）が書いた値どおりに当たるようにする）。
- `x-request-id` を付ける。4xx はログに出さない（量が多く、ボットの送信で埋まるため）。`X-Robots-Tag` は ADR-019 の `/api/*` の決まりどおり付く。

---

## 6. データモデル

<!-- データモデルの正はこのドキュメント（Phase 3でdesign-specの論理設計から章ごと引き継ぎ、design-spec側の章は削除される）。
スキーマ変更時はここを更新する。ER図に加え、選定したORMのスキーマコードで書く。 -->

### 6.1 共通の約束

- すべてのテーブルに `id`（UUID の文字列、主キー）、`created_at`、`updated_at` を持たせる。例外は中間テーブル（`work_stack`・`project_stack`）と解析の集計（`analytics_daily`・`analytics_rollup`。行が日と次元とキーで決まり、Cron が丸ごと書き直すだけで、更新の日時に意味が無い。ADR-023）で、これらは持たない。Better Auth のテーブル（`admin_*`・`auth_verification`）は Better Auth が値を入れる。
- 日英を持つテキストは `_ja` と `_en` の2つのカラムに分ける。どちらも空を許す（空文字は保存せず `NULL` にする）。「言語あり」の判定の規則は design-spec 1.4 で、`src/domain/languages.ts` に実装する。
- 公開状態 `status` は `draft`（下書き）か `published`（公開）。公開側には `published` だけを出す。
- 「公開時に必須」の項目は、下書きでは空を許し、`status` を `published` にするときに必須とする（design-spec 6.7.3）。DB にも CHECK 制約で入れる。
- 表示順 `sort_order` は小さいほど先。新規作成したときに先頭・末尾のどちらに入れるかは design-spec 6.7.1 で、先頭は今の最小値 − 1、末尾は今の最大値 ＋ 1 で入れる。並べ替えると 0 から振り直す。並べ替えの更新では `updated_at` を変えない（Drizzle の `$onUpdateFn` が動かないよう、`updated_at` に今の値をそのまま入れる）。
- 画像は R2 のファイルのルート相対パス（`/media/...`）を持つ。本文中の画像は Markdown の中に同じ形で入る。
- Markdown のカラムは、Markdown 記法のテキストをそのまま持つ。
- SQLite（D1）の型への対応: UUID → `text`、enum → `text` ＋ CHECK 制約、真偽値 → `integer`（0/1）、日時 → `integer`（UNIX ミリ秒）、年月 → `text`（`YYYY-MM`）、日（日本時間の暦の日）→ `text`（`YYYY-MM-DD`）。
- 外部キーは D1 で有効（`ON DELETE CASCADE` が効く）。

### 6.2 ER図

```
profile (1件) ··· social_link (N)         ※ profile は1件だけなので、social_link は外部キーを持たない

career (N)

work (N) ──< work_stack >── (N) stack (N) ──< project_stack >── (N) project

blog_post (N)
coding_log (N)

privacy_page (1件)

analytics_daily (N) ··· analytics_rollup (N)  ※ どちらも日（date）で対応する。外部キーは持たない

admin_user (1件) ──< admin_session (N)
           └──────< admin_account (N)     ※ GitHub の1件だけ
auth_verification (N)                     ※ OAuth の state などの一時データ。どこにも紐づかない
```

### 6.3 テーブルごとの注記

カラムの意味と、画面の仕様（design-spec）との対応。値を入れる条件などの振る舞いは design-spec と 5章が持つ。

| テーブル | 内容 | 注記 |
|---|---|---|
| `profile` | プロフィール。1件だけ | `singleton` カラム（常に1、一意）で2件目を防ぐ。名前は日英のどちらかが必須。ローカルはシードで、staging・本番はデータ移行か A3 の初回の保存で作られる |
| `social_link` | SNS リンク | `service` はアイコンの出し分けに使う。`other` のときは `label` 必須 |
| `career` | 経歴（職歴と学歴） | `kind` で職歴・学歴を分ける（初期値 `work`）。`end_date` が空なら「現在」 |
| `work` | 作品 | `body_ja` か `body_en` があれば詳細ページを持つ。`first_published_at` は「初めて公開した日時」（design-spec 6.7.2 の「公開したことがある」の判定に使う。値を入れるのは 5.3） |
| `project` | プロジェクト | 作品との違いは、GitHub を持たず期間を持つこと（今の DB に合わせた）。詳細ページの有無・`first_published_at` は作品と同じ |
| `stack` | 使用技術 | `key` は識別名（例: `nextjs`）、`display_name` は日英共通の表示名。`show_on_top` の初期値は true。`category` は `languages`・`frameworks`・`infrastructure`・`tools`（初期値 `tools`。P1 の Tech Stack の群）。`is_core` は Core（主要な技術。初期値 false）。Core の技術はトップに表示する決まりだが、DB では縛らず API の入力チェック（5.8）で守る（CHECK にすると、古いコードが Core の技術を非表示にして保存したときに失敗し、前のコードで動く形にならないため。公開側は `show_on_top` だけで出す技術を決めるので、矛盾した行は表に出ない） |
| `work_stack` ／ `project_stack` | 作品・プロジェクトと使用技術の紐づけ | 主キーは2つの外部キーの組。`sort_order` が作品・プロジェクトの中での技術の表示順 |
| `blog_post` | ブログ記事 | `published_at` は「公開日」、`content_updated_at` は「更新日」（値を入れるのは 5.3。`published_at` は design-spec 6.7.2 の「公開したことがある」の判定にも使う）。抜粋はカラムを持たず本文から作る |
| `coding_log` | コーディング記録 | `kind` は `learning_log`（初期値）・`snippet`・`problem`・`memo`。日時のカラムはブログ記事と同じ |
| `privacy_page` | プライバシーのページ。1件だけ | `singleton` カラム（常に1、一意）で2件目を防ぐ。公開の状態を持たず、本文（`body_ja`・`body_en`）が日英のどちらかにあれば公開側にページとフッターのリンクが出る（5.11）。空白だけの本文は保存せず `NULL` にし、CHECK でも防ぐ（SQLite の `trim()` は既定で半角スペースしか除かないので、API の検査と公開側の判定が使う JS の `trim` と同じ文字を渡す）。最終更新日は `updated_at`。staging・本番は A11 の初回の保存で作られる |
| `analytics_daily` | 解析の日ごとの集計（ADR-023） | 主キーは（`date`、`dimension`、`key`）。次元・キー・件数・訪問者数の意味は 5.13 の「集計の次元」の表。合計の次元（`total`・`top_view`・`outbound_total`）だけ `key` が空文字。`(other)` の `visitors` は残りの行の合計で、同じ人が重なりうる上限の目安。Cron だけが書く。次元を足すときは CHECK を変えるマイグレーションになり、テーブルを作り直す（外部キーを持たず参照もされないので、ADR-007 の作り直しで行が消える心配は無い） |
| `analytics_rollup` | 集計を終えた日 | この表にある日だけ `analytics_daily` の行が確定している。イベントが0件の日も入れる（「集計していない」と分ける）。最も古い日を計測の開始日とする |
| `admin_user` | 管理者（Better Auth の user） | `github_user_id`（GitHub の数値 ID）で管理者かを判定する。`github_login` はサイドメニューに出す。初回ログインで作られる（ADR-009）。`name`・`email`・`image` は Better Auth が GitHub から入れる |
| `admin_session` | ログインのセッション | Cookie のトークンに対応する。有効期限30日 |
| `admin_account` | GitHub のアカウントとの紐づけ | `provider_id = 'github'`、`account_id` は GitHub の数値 ID |
| `auth_verification` | OAuth の一時データ | Better Auth が使う |

### 6.4 Drizzle のスキーマ（`src/db/schema.ts`）

```ts
import { relations, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ---- 値の定義 ----------------------------------------------------------
// src/db/enums.ts:
//   STATUSES = ['draft', 'published']
//   SOCIAL_SERVICES = ['github', 'linkedin', 'instagram', 'x', 'zenn', 'qiita', 'other']
//   CAREER_KINDS = ['work', 'education']
//   CODING_LOG_KINDS = ['learning_log', 'snippet', 'problem', 'memo']
//   STACK_CATEGORIES = ['languages', 'frameworks', 'infrastructure', 'tools']  // 並びは P1 の Tech Stack の群の順
//   ANALYTICS_DIMENSIONS = ['total', 'page', 'referrer', 'utm', 'country', 'device', 'browser_lang', 'site_lang', 'top_view',
//     'section_view', 'read_complete', 'row_expand', 'paging', 'outbound', 'outbound_total', 'lang_switch', 'theme_switch', 'code_copy']
// ブラウザで動くコード（公開側の表示、管理画面）は enums.ts から読み、Drizzle をバンドルに入れない（7章「パフォーマンス」）
import { ANALYTICS_DIMENSIONS, CAREER_KINDS, CODING_LOG_KINDS, SOCIAL_SERVICES, STACK_CATEGORIES, STATUSES } from './enums'
export { ANALYTICS_DIMENSIONS, CAREER_KINDS, CODING_LOG_KINDS, SOCIAL_SERVICES, STACK_CATEGORIES, STATUSES }

// ---- 共通のカラム ------------------------------------------------------
const id = () => text('id').primaryKey().$defaultFn(() => crypto.randomUUID())
const createdAt = () =>
  integer('created_at', { mode: 'timestamp_ms' }).notNull().$defaultFn(() => new Date())
const updatedAt = () =>
  integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date())
const status = () => text('status', { enum: STATUSES }).notNull().default('draft')
/** 年月。'YYYY-MM' */
const yearMonth = (name: string) => text(name)

// ---- CHECK 制約の部品 --------------------------------------------------
const inList = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(', '))
const slugFormat = (col: unknown) =>
  sql`${col} is null or (${col} <> '' and ${col} not glob '*[^a-z0-9-]*')`
const yearMonthFormat = (col: unknown) =>
  sql`${col} is null or (${col} glob '[0-9][0-9][0-9][0-9]-[01][0-9]' and substr(${col}, 6, 2) between '01' and '12')`
/** 日本時間の日。'YYYY-MM-DD'（6.1） */
const dateFormat = (col: unknown) =>
  sql`${col} glob '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' and substr(${col}, 6, 2) between '01' and '12' and substr(${col}, 9, 2) between '01' and '31'`
// LIKE は ASCII の大文字小文字を区別しない（'/MEDIA/...' が通る）ので、前方一致は GLOB で見る
const httpsOrNull = (col: unknown) => sql`${col} is null or ${col} glob 'https://*'`
const mediaOrNull = (col: unknown) => sql`${col} is null or ${col} glob '/media/*'`
/** JS の trim（API の入力の検査と公開側の「言語あり」の判定）が除く文字。ECMAScript の WhiteSpace と LineTerminator */
export const JS_TRIM_CODE_POINTS = [
  0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007,
  0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff,
] as const
// SQLite の trim() は既定で半角スペースしか除かないので、JS の trim と同じ文字を渡す
const notBlankOrNull = (col: unknown) =>
  sql`${col} is null or trim(${col}, char(${sql.raw(JS_TRIM_CODE_POINTS.join(', '))})) <> ''`

// ---- profile ----------------------------------------------------------
export const profile = sqliteTable(
  'profile',
  {
    id: id(),
    /** 常に1。一意制約で2件目を防ぐ */
    singleton: integer('singleton').notNull().default(1).unique(),
    nameJa: text('name_ja'),
    nameEn: text('name_en'),
    headlineJa: text('headline_ja'),
    headlineEn: text('headline_en'),
    taglineJa: text('tagline_ja'),
    taglineEn: text('tagline_en'),
    bioJa: text('bio_ja'), // Markdown
    bioEn: text('bio_en'), // Markdown
    avatarUrl: text('avatar_url'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('profile_singleton', sql`${t.singleton} = 1`),
    check('profile_name_required', sql`${t.nameJa} is not null or ${t.nameEn} is not null`),
    check('profile_avatar_url', mediaOrNull(t.avatarUrl)),
  ],
)

// ---- social_link ------------------------------------------------------
export const socialLink = sqliteTable(
  'social_link',
  {
    id: id(),
    service: text('service', { enum: SOCIAL_SERVICES }).notNull(),
    url: text('url').notNull(),
    /** service が other のときは必須 */
    label: text('label'),
    sortOrder: integer('sort_order').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('social_link_service', sql`${t.service} in (${inList(SOCIAL_SERVICES)})`),
    check('social_link_url', sql`${t.url} glob 'https://*'`),
    check('social_link_other_label', sql`${t.service} <> 'other' or ${t.label} is not null`),
    index('social_link_sort_idx').on(t.sortOrder),
  ],
)

// ---- career -----------------------------------------------------------
export const career = sqliteTable(
  'career',
  {
    id: id(),
    kind: text('kind', { enum: CAREER_KINDS }).notNull().default('work'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    organizationJa: text('organization_ja'),
    organizationEn: text('organization_en'),
    locationJa: text('location_ja'),
    locationEn: text('location_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    /** 公開時に必須 */
    startDate: yearMonth('start_date'),
    /** 空なら「現在」 */
    endDate: yearMonth('end_date'),
    status: status(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('career_kind', sql`${t.kind} in (${inList(CAREER_KINDS)})`),
    check('career_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('career_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('career_start_date', yearMonthFormat(t.startDate)),
    check('career_end_date', yearMonthFormat(t.endDate)),
    // 終了年月は開始年月と同じか後（design-spec 6.7.3）
    check('career_period', sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('career_published_start', sql`${t.status} <> 'published' or ${t.startDate} is not null`),
    index('career_status_start_idx').on(t.status, t.startDate),
  ],
)

// ---- work -------------------------------------------------------------
export const work = sqliteTable(
  'work',
  {
    id: id(),
    /** URL 用。作品の中で一意（NULL どうしは重複とみなさない）。公開時に必須 */
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    summaryJa: text('summary_ja'),
    summaryEn: text('summary_en'),
    bodyJa: text('body_ja'), // Markdown。どちらかの言語にあれば詳細ページを持つ
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    linkUrl: text('link_url'),
    githubUrl: text('github_url'),
    sortOrder: integer('sort_order').notNull(),
    status: status(),
    /** 初めて公開した日時（値を入れるのは 5.3） */
    firstPublishedAt: integer('first_published_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('work_slug_unique').on(t.slug),
    check('work_slug_format', slugFormat(t.slug)),
    check('work_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('work_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('work_published_slug', sql`${t.status} <> 'published' or ${t.slug} is not null`),
    check('work_link_url', httpsOrNull(t.linkUrl)),
    check('work_github_url', httpsOrNull(t.githubUrl)),
    check('work_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('work_status_sort_idx').on(t.status, t.sortOrder),
  ],
)

// ---- project ----------------------------------------------------------
export const project = sqliteTable(
  'project',
  {
    id: id(),
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    summaryJa: text('summary_ja'),
    summaryEn: text('summary_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    linkUrl: text('link_url'),
    /** 公開時に必須 */
    startDate: yearMonth('start_date'),
    /** 空なら「現在」 */
    endDate: yearMonth('end_date'),
    sortOrder: integer('sort_order').notNull(),
    status: status(),
    firstPublishedAt: integer('first_published_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('project_slug_unique').on(t.slug),
    check('project_slug_format', slugFormat(t.slug)),
    check('project_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('project_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('project_published_slug', sql`${t.status} <> 'published' or ${t.slug} is not null`),
    check('project_published_start', sql`${t.status} <> 'published' or ${t.startDate} is not null`),
    check('project_start_date', yearMonthFormat(t.startDate)),
    check('project_end_date', yearMonthFormat(t.endDate)),
    check('project_period', sql`${t.startDate} is null or ${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
    check('project_link_url', httpsOrNull(t.linkUrl)),
    check('project_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('project_status_sort_idx').on(t.status, t.sortOrder),
  ],
)

// ---- stack ------------------------------------------------------------
export const stack = sqliteTable(
  'stack',
  {
    id: id(),
    /** 識別名。スラッグと同じ形式。一意 */
    key: text('key').notNull().unique(),
    /** 表示名。日英共通 */
    displayName: text('display_name').notNull(),
    iconUrl: text('icon_url'),
    linkUrl: text('link_url'),
    sortOrder: integer('sort_order').notNull(),
    showOnTop: integer('show_on_top', { mode: 'boolean' }).notNull().default(true),
    category: text('category', { enum: STACK_CATEGORIES }).notNull().default('tools'),
    /** Core（主要な技術）。true のとき show_on_top も true であることは API が守る（6.3） */
    isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('stack_category', sql`${t.category} in (${inList(STACK_CATEGORIES)})`),
    check('stack_key_format', sql`${t.key} <> '' and ${t.key} not glob '*[^a-z0-9-]*'`),
    check('stack_link_url', httpsOrNull(t.linkUrl)),
    check('stack_icon_url', mediaOrNull(t.iconUrl)),
    index('stack_sort_idx').on(t.sortOrder),
  ],
)

// ---- work_stack / project_stack --------------------------------------
export const workStack = sqliteTable(
  'work_stack',
  {
    workId: text('work_id').notNull().references(() => work.id, { onDelete: 'cascade' }),
    stackId: text('stack_id').notNull().references(() => stack.id, { onDelete: 'cascade' }),
    /** 作品の中での技術の表示順 */
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workId, t.stackId] }), index('work_stack_stack_idx').on(t.stackId)],
)

export const projectStack = sqliteTable(
  'project_stack',
  {
    projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
    stackId: text('stack_id').notNull().references(() => stack.id, { onDelete: 'cascade' }),
    sortOrder: integer('sort_order').notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.stackId] }), index('project_stack_stack_idx').on(t.stackId)],
)

// ---- blog_post --------------------------------------------------------
export const blogPost = sqliteTable(
  'blog_post',
  {
    id: id(),
    slug: text('slug'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    thumbnailUrl: text('thumbnail_url'),
    status: status(),
    /** 公開日（値を入れるのは 5.3） */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** 更新日（値を入れるのは 5.3） */
    contentUpdatedAt: integer('content_updated_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('blog_post_slug_unique').on(t.slug),
    check('blog_post_slug_format', slugFormat(t.slug)),
    check('blog_post_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('blog_post_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('blog_post_published', sql`${t.status} <> 'published' or (${t.slug} is not null and ${t.publishedAt} is not null)`),
    check('blog_post_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('blog_post_status_published_idx').on(t.status, t.publishedAt),
  ],
)

// ---- coding_log -------------------------------------------------------
export const codingLog = sqliteTable(
  'coding_log',
  {
    id: id(),
    slug: text('slug'),
    kind: text('kind', { enum: CODING_LOG_KINDS }).notNull().default('learning_log'),
    titleJa: text('title_ja'),
    titleEn: text('title_en'),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    referenceUrl: text('reference_url'),
    thumbnailUrl: text('thumbnail_url'),
    status: status(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    contentUpdatedAt: integer('content_updated_at', { mode: 'timestamp_ms' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('coding_log_slug_unique').on(t.slug),
    check('coding_log_slug_format', slugFormat(t.slug)),
    check('coding_log_kind', sql`${t.kind} in (${inList(CODING_LOG_KINDS)})`),
    check('coding_log_status', sql`${t.status} in (${inList(STATUSES)})`),
    check('coding_log_title_required', sql`${t.titleJa} is not null or ${t.titleEn} is not null`),
    check('coding_log_published', sql`${t.status} <> 'published' or (${t.slug} is not null and ${t.publishedAt} is not null)`),
    check('coding_log_reference_url', httpsOrNull(t.referenceUrl)),
    check('coding_log_thumbnail_url', mediaOrNull(t.thumbnailUrl)),
    index('coding_log_status_published_idx').on(t.status, t.publishedAt),
  ],
)

// ---- privacy_page -----------------------------------------------------
/** プライバシーのページ。1件だけ。本文が日英とも空なら、公開側にページもリンクも出さない */
export const privacyPage = sqliteTable(
  'privacy_page',
  {
    id: id(),
    /** 常に1。一意制約で2件目を防ぐ */
    singleton: integer('singleton').notNull().default(1).unique(),
    bodyJa: text('body_ja'), // Markdown
    bodyEn: text('body_en'), // Markdown
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check('privacy_page_singleton', sql`${t.singleton} = 1`),
    // 空白だけの本文は API が NULL にする。「ページがある」の判定（is not null）の最後の守り
    check('privacy_page_body_ja', notBlankOrNull(t.bodyJa)),
    check('privacy_page_body_en', notBlankOrNull(t.bodyEn)),
  ],
)

// ---- analytics_daily --------------------------------------------------
/**
 * 解析の日ごとの集計（ADR-023）。Cron だけが書く。id・created_at・updated_at は持たない
 * （行は日と次元とキーで決まり、Cron が日ごとに丸ごと書き直すので、更新の日時に意味が無い。SDD 6.1 の例外）
 */
export const analyticsDaily = sqliteTable(
  'analytics_daily',
  {
    /** 日本時間の日。'YYYY-MM-DD' */
    date: text('date').notNull(),
    dimension: text('dimension', { enum: ANALYTICS_DIMENSIONS }).notNull(),
    /** 次元ごとの値。total・top_view・outbound_total は空文字。上位に入らなかった残りは '(other)' */
    key: text('key').notNull(),
    count: integer('count').notNull(),
    visitors: integer('visitors').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.date, t.dimension, t.key] }),
    check('analytics_daily_dimension', sql`${t.dimension} in (${inList(ANALYTICS_DIMENSIONS)})`),
    check('analytics_daily_date', dateFormat(t.date)),
    // 1人は少なくとも1件を送るので、どの次元でも訪問者数は件数を超えない（(other) は上位に入らなかった行の合計どうし）
    check('analytics_daily_counts', sql`${t.count} >= 0 and ${t.visitors} >= 0 and ${t.visitors} <= ${t.count}`),
    // 空のキーは合計の次元だけ
    check('analytics_daily_key', sql`(${t.dimension} in ('total', 'top_view', 'outbound_total')) = (${t.key} = '')`),
    index('analytics_daily_dimension_date_idx').on(t.dimension, t.date),
  ],
)

// ---- analytics_rollup -------------------------------------------------
/** 集計を終えた日。この表にある日だけ、analytics_daily の行が確定している。id・created_at・updated_at は持たない（日で決まる。SDD 6.1 の例外） */
export const analyticsRollup = sqliteTable(
  'analytics_rollup',
  {
    date: text('date').primaryKey(),
    rolledUpAt: integer('rolled_up_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [check('analytics_rollup_date', dateFormat(t.date))],
)

// ---- Better Auth（管理者のログイン） -----------------------------------
export const adminUser = sqliteTable('admin_user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  /** GitHub の数値 ID。ADMIN_GITHUB_USER_ID と一致する人だけが作られる */
  githubUserId: text('github_user_id').notNull().unique(),
  /** GitHub のユーザー名。ログインのたびに更新する */
  githubLogin: text('github_login').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export const adminSession = sqliteTable(
  'admin_session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('admin_session_user_idx').on(t.userId)],
)

export const adminAccount = sqliteTable(
  'admin_account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id').notNull().references(() => adminUser.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [uniqueIndex('admin_account_provider_unique').on(t.providerId, t.accountId)],
)

export const authVerification = sqliteTable(
  'auth_verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
)

// ---- リレーション（db.query で使う） ------------------------------------
export const workRelations = relations(work, ({ many }) => ({ stacks: many(workStack) }))
export const projectRelations = relations(project, ({ many }) => ({ stacks: many(projectStack) }))
export const stackRelations = relations(stack, ({ many }) => ({ works: many(workStack), projects: many(projectStack) }))
export const workStackRelations = relations(workStack, ({ one }) => ({
  work: one(work, { fields: [workStack.workId], references: [work.id] }),
  stack: one(stack, { fields: [workStack.stackId], references: [stack.id] }),
}))
export const projectStackRelations = relations(projectStack, ({ one }) => ({
  project: one(project, { fields: [projectStack.projectId], references: [project.id] }),
  stack: one(stack, { fields: [projectStack.stackId], references: [stack.id] }),
}))
```

DB クライアント（`src/db/client.ts`）:

```ts
import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

export const getDb = (env: Env) => drizzle(env.DB, { schema })
export type Db = ReturnType<typeof getDb>
```

drizzle-kit の設定（`drizzle.config.ts`）:

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle/migrations',
})
```

### 6.5 今の DB からの対応（データ移行用）

| 今のテーブル | 新しいテーブル | 主な変更 |
|---|---|---|
| Profile | `profile` ＋ `social_link` | 名前・自己紹介を `_ja`／`_en` に揃える。肩書き・一言を追加。SNS（Instagram・LinkedIn・GitHub）を `social_link` に分ける |
| Experience ＋ Education | `career` | 1つにまとめて `kind` で分ける。タイトル以外（所属・場所）も日英に分ける。公開状態を追加 |
| Work | `work` | 概要と詳細本文を分ける。サムネイル・表示順・公開状態・初めて公開した日時・スラッグを追加 |
| Project | `project` | Work と同じ |
| Stack | `stack` | `name` → `key`、`stackImage` → `icon_url`。表示順とトップに表示するかを追加。カテゴリは識別名から決める（design-spec 9章）。Core はオフ |
| （Work・Project と Stack の暗黙の中間テーブル） | `work_stack` ＋ `project_stack` | 技術の表示順を追加 |
| Coding（中身なし） | `coding_log` | 新しく作る |
| なし | `blog_post` | 新しく作る |
| なし | `admin_user` ほか Better Auth のテーブル | 新しく作る（GitHub ログイン用） |
| なし | `privacy_page` | 新しく作る（移す中身は無い。本文は A11 で書く） |

移行の手順と方針（今の説明を `summary` に入れる、最初は下書きで入れる、など）は design-spec 9章。変換スクリプトは `scripts/migrate-legacy/` に置き、D1 に流す SQL を生成する。画像は R2 の `uploads/legacy/{ファイル名}-{中身の SHA-256 の先頭8桁}.{拡張子}` に置き直し、パスを書き換える。ファイル名は今のファイル名から拡張子を除いて英小文字・数字・ハイフンに直したもので、拡張子は形式から決める。`/media/*` はキーの中身が変わらない前提で長くキャッシュさせる（ADR-010）ので、キーに中身のハッシュを入れる。SQL は消す文を含まず、流す先の D1 の中身が空であることを前提にする（空でなければプロフィールの一意制約で失敗する）。

---

## 7. セキュリティ・パフォーマンス

### セキュリティ

#### 認可（権限マトリクス）

ロールは design-spec 2.1 の「訪問者」と「管理者」。管理者は `ADMIN_GITHUB_USER_ID` と一致する GitHub アカウントのセッションを持つ人。管理者でないセッションは、Better Auth の hooks で作られないので通常は存在しないが、`ADMIN_GITHUB_USER_ID` を別のアカウントに変えた場合などに残りうるので、列として持つ。

| リソース / 操作 | 管理者 | 管理者でないセッション | 未認証（訪問者） |
|----------------|----------|----------|--------|
| 公開側の画面（P1〜P6・C1・C2）の閲覧、公開側のサーバー関数（5.11） | ✓ | ✓ | ✓ |
| 下書きの中身の、公開側での閲覧 | ✕（404） | ✕（404） | ✕（404） |
| `GET /media/*`（画像） | ✓ | ✓ | ✓ |
| `POST /api/collect`（解析の送信。5.14） | ✓（受け付けて記録しない） | ✓ | ✓ |
| A1 ログイン画面 | ✓（A2、または `redirect` の画面へ移す） | ✓ | ✓ |
| A2〜A11 の表示 | ✓ | ✕（A1 へ。design-spec 6.4 の「管理者でないアカウント」） | ✕（A1 へ） |
| `/api/auth/*`（ログイン開始・コールバック・セッション取得・ログアウト） | ✓ | ✓ | ✓（`admin_user` が作られるのは `ADMIN_GITHUB_USER_ID` の人だけ） |
| `GET /api/admin/*`（ダッシュボード・一覧・詳細・スラッグ・OpenAPI） | ✓ | ✕（403） | ✕（401） |
| `POST`・`PUT`・`DELETE /api/admin/*`（作成・更新・公開・非公開・削除・並べ替え） | ✓ | ✕（403） | ✕（401） |
| `POST /api/admin/uploads` | ✓ | ✕（403） | ✕（401） |

- 認可は 5.1 のミドルウェアで、`/api/admin/*` の全手続きに一律にかける。手続きごとに付け外ししない。
- 公開側のサーバー関数は、`status = 'published'` の条件を `src/content/` の中の共通のクエリ部品に入れ、個別のクエリで書き忘れないようにする。公開の状態を持たない `privacy_page` は、本文の有無を `src/domain/languages.ts` の判定で見て出す（5.11）。
- 管理画面のルートガード（`beforeLoad`）は表示のためのもので、守りの正は API 側。ガードが見るのはセッションの有無だけで、管理者かどうかは見ない（クライアントは `ADMIN_GITHUB_USER_ID` を知らない）。A2〜A11 は表示のときに CMS API を呼ぶので、管理者でないセッションはその `FORBIDDEN` で A1 の「管理者でないアカウント」へ移る（8章）。

#### その他の設計判断

| 項目 | 決定 |
|---|---|
| 入力バリデーション | API の境界（oRPC のコントラクトの Zod）で必ず行う。管理画面のフォームは同じスキーマで補助的に行う。公開・下書きのルールは `src/domain/` の関数。最後の守りとして DB の CHECK 制約（6.4） |
| Markdown の XSS | 生の HTML は通さず、rehype-sanitize（GitHub のスキーマ）で `javascript:` などの URL も除く（ADR-012） |
| 画像 | 形式を宣言と先頭のバイトの両方で確かめる。SVG は `sandbox` の CSP 付きで配信する（5.10） |
| シークレット | ローカルは `.dev.vars`（`.gitignore` 済み。見本は `.dev.vars.example`）。staging・本番は `wrangler secret put`。CI のデプロイ用トークンは GitHub Actions の Secrets。リポジトリには入れない。Worker の環境変数・シークレットの一覧は `docs/03_dev-setup.md` 3.2、CI のシークレットは `docs/04_deployment-procedure.md` 3章 Step 6 |
| CSRF | Better Auth は `trustedOrigins`（`SITE_URL`）で Origin を確かめる。CMS API は、Cookie を `SameSite=Lax` にしたうえで、oRPC の `SimpleCsrfProtectionHandlerPlugin`（クライアントは `SimpleCsrfProtectionLinkPlugin`。カスタムヘッダーがないリクエストを拒否）を使う。`/api/collect` は `Origin` が `SITE_URL` と違えば 403（訪問者の送信で、守る権限は無い。ほかのサイトのページからデータが混ざるのを抑える） |
| CORS | 開けない（同じ origin からだけ使う）。`Access-Control-Allow-Origin` を返さない |
| レート制限 | ADR-021（対象・単位・回数） |
| Cookie | セッション: `__Secure-eastx.session_token`（HttpOnly・Secure・SameSite=Lax・Path=/）。表示設定: `eastx-lang`（`ja`／`en`）と `eastx-theme`（`system`／`light`／`dark`）。どちらも1年、HttpOnly ではない（クライアントで書く） |
| セキュリティヘッダー | Worker が HTML と API のレスポンスに付ける（`src/response-headers.ts`）: `Strict-Transport-Security: max-age=31536000; includeSubDomains`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' {Sentry の送り先}; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`。`{Sentry の送り先}` は `SENTRY_DSN` の origin（`https://o123.ingest.us.sentry.io` など。host は組織とリージョンで変わり、固定のワイルドカードでは合わない）で、DSN が空・読めない・https でないなら書かない。`script-src` の `'unsafe-inline'` はテーマの初期化と SSR のデータ受け渡しのため。訪問者が中身を書き込む経路がないので許容し、nonce 方式は今後の改善とする。`'unsafe-eval'` は入れないので、ブラウザで動く Zod は JIT を切る（`jitless`）。`/media/*` には付けず、5.10 のヘッダー（`nosniff` と SVG の sandbox の CSP）だけにする |
| 個人情報 | 訪問者について持つのは、Analytics Engine の1件（ページのパス、イベントの値、流入元のホスト名、UTM、国、デバイスの種類、ブラウザの言語、日ごとの訪問者のハッシュ。3か月で消える）と、D1 の日ごとの集計（訪問者を区別できる値を含まない）だけ。IP・User-Agent・Cookie・端末の識別子は残さない。ハッシュの元にする日ごとの値は KV に置き、日本時間のその日の終わりから10分以内に期限切れで消える（戻す仕組みは無い）。管理者・ボット・DNT・GPC の送信は記録しない（ADR-023）。集める項目と保持は、プライバシーのページ（P6）で訪問者に示す。フォーム・アカウントは無い。管理者については GitHub の数値 ID・ユーザー名・名前・メール・アバター URL（`admin_user`）、セッションの IP と User-Agent（`admin_session`。30日で失効）、GitHub のアクセストークン（`admin_account`。`read:user`・`user:email` だけ）を持つ。画面には GitHub のユーザー名だけを出す。暗号化はしない（D1 の保存時の暗号化に任せる） |
| 検索エンジン | 管理画面・API・staging は noindex（ADR-019） |

### パフォーマンス

| 目標 | 値 |
|---|---|
| P1 の TTFB（日本から、p75） | PRD 5章の目標 |
| P1〜P5 の LCP（モバイル、p75） | 2.5秒以下 |
| CMS API の応答（p95） | 300ms 以下（アップロードと `GET /api/admin/analytics` を除く。後者は今日の分で外部の SQL API を呼び、待つのは3秒まで。5.13） |

測り方: Sentry のブラウザのパフォーマンス計測（Web Vitals の TTFB・LCP）で、日本からのアクセスの p75 を見る。CMS API は Workers Logs の応答時間で見る。P6 は画像の無い短い文書で、LCP は本文の文字になり P1〜P5 より軽いので、LCP の目標と Lighthouse の対象には入れない。

守るための設計:

- D1 の場所のヒントを `apac` にする（訪問者と管理者の多くが日本から）。
- `getTopPage` は全セクションのクエリを1回の `db.batch()` で送る。必要なカラムだけを選び、ブログ・コーディング記録の本文は読まない（あるかだけを読む）。
- インデックス: 一覧の絞り込みと並び（`status` ＋ `sort_order` ／ `start_date` ／ `published_at`）、スラッグの一意、中間テーブルの `stack_id`（6.4）。
- Markdown の描画結果を Cache API に置く（ADR-011）。Shiki は使う言語だけを読み込む（ADR-012）。
- 画像は長期キャッシュ（ADR-010）。サムネイルには `width`・`height` か `aspect-ratio` を指定してレイアウトのずれを防ぎ、ファーストビューの外は `loading="lazy"`。
- フォントは、`docs/06_design-tokens.json` の `font.family` のうち欧文の可変フォントだけを `@fontsource-variable` で自前配信し、`font-display: swap` にする。和文のフォントは配信しない（OS のフォントを使う）。
- 管理画面（`/admin/*`）は別のチャンクにし、CodeMirror・dnd-kit・Shiki は公開側のバンドルに入れない。ルートの設定（`beforeLoad`・`validateSearch`）は画面の部品と違って公開側と同じバンドルに入るので、管理画面のルートの設定が使う重いモジュール（Better Auth のクライアント、トースト）は `import()` で読み込む。ブラウザで動くコードは Drizzle を import しない（値の定義は `src/db/enums.ts`。6.4）。
- A10 の一覧・到達率・属性は、期間の日ごとの行を D1 で次元とキーごとに合計して読む（`GROUP BY`）。日ごとの行で読むのは合計と推移の次元（`total`・`outbound_total`）だけにし、期間が長くなっても読む行を増やさない。A2 の要約は D1 だけを読み、SQL API を呼ばない。
- 過剰な対策（ページ単位のキャッシュ、D1 の読み取りレプリカ）は、目標を外れてから検討する。

---

## 8. エラーハンドリング

### APIエラーレスポンス

CMS API のエラーは oRPC の形式で返す。定義済みのエラーはコントラクトの `.errors()` に書き、管理画面では型付きで判別できる（`isDefinedError`）。

```json
{
  "defined": true,
  "code": "SLUG_CONFLICT",
  "status": 409,
  "message": "このスラッグはすでに使われています",
  "data": { "suggestion": "my-app-2" }
}
```

| コード | HTTP | `data` | 使う場面 |
|---|---|---|---|
| `INPUT_VALIDATION_FAILED` | 422 | `{ "fieldErrors": { "ja.title": ["…"], "linkUrl": ["https:// で始めてください"] }, "formErrors": ["…"] }` | 形式の誤り・上限超え・存在しない ID・項目どうしの組み合わせの誤り（Zod のエラーを、インターセプターでこの形に変える）。組み合わせの誤りの例は、Core でトップに表示しない技術（5.8）。本文を解釈できない・本文が大きすぎるとき（5.1）は `formErrors` に入れる |
| `PUBLISH_REQUIREMENTS_NOT_MET` | 422 | `{ "missing": [{ "field": "slug" }, { "field": "title", "lang": "en" }] }` | 公開・更新するのに足りない項目（design-spec 6.7.3） |
| `SLUG_CONFLICT` | 409 | `{ "suggestion": "my-app-2" }` | 同じ種類の中でスラッグが重複 |
| `STACK_KEY_CONFLICT` | 409 | `{ "suggestion": "react-2" }` | 使用技術の識別名が重複 |
| `ORDER_OUT_OF_DATE` | 409 | — | 並べ替えの ID の集合が今のものと違う |
| `NOT_FOUND` | 404 | — | ID が存在しない。手続きが見つからないパス（`defined: false`。5.1） |
| `UNAUTHORIZED` | 401 | — | セッションがない・切れている |
| `FORBIDDEN` | 403 | — | 管理者でないセッション |
| `CSRF_TOKEN_MISMATCH` | 403 | — | CSRF 対策のヘッダーがない |
| `TOO_MANY_REQUESTS` | 429 | — | レート制限 |
| `INTERNAL_SERVER_ERROR` | 500 | `{ "requestId": "8c1f2a…-NRT" }` | 想定外のエラー。`message` は一般的な文言にし、中身は出さない |

`message` は日本語（管理画面だけが使うため）。

解析の受け口 `POST /api/collect`（5.14）は CMS API の外で、同じ形（`defined: false`）を使い、意味だけが違う: `INPUT_VALIDATION_FAILED` は 400（`data` を持たない。ブラウザは応答を読まない）、`FORBIDDEN` は `Origin` が `SITE_URL` と違う送信、`TOO_MANY_REQUESTS` は `COLLECT_RATE_LIMITER` を超えた送信。

公開側のサーバー関数は、見つからなければ `notFound()`（C1、HTTP 404）を投げ、ルートの `notFoundComponent` で受ける。それ以外の失敗は、ERROR のログ（`route` はサーバー関数の名前）を出してから、文面を `INTERNAL_SERVER_ERROR` に置き換えた例外を投げ、ルートの `errorComponent`（C2、HTTP 500）で受ける。TanStack Start は投げた例外のメッセージを SSR の HTML とサーバー関数の応答に載せてブラウザへ渡すので、D1 のエラーの文面をそのまま投げない（`src/content/server-fns.ts`）。

### フロントエンドでの表示方針

文言と出し方の正は design-spec（公開側は 6.1.5・6.2.3・6.2.4・6.3、管理側は 6.4〜6.7.4）。ここではエラーの種類との対応だけを決める。

| エラー種別 | 表示方法 |
|-----------|----------|
| バリデーションエラー | `INPUT_VALIDATION_FAILED` → `fieldErrors` のキーに対応する入力欄の下に赤字で出す。`PUBLISH_REQUIREMENTS_NOT_MET` → 足りない項目を一覧で出し、該当する言語と入力欄に印を付ける。`SLUG_CONFLICT` → スラッグ欄の下に出し、`suggestion` を候補として示す。送る前の入力チェックの誤りも含め、件数の通知・最初の誤りの欄への移動・印の付け方は design-spec 6.7・6.7.3 |
| 通信・サーバーエラー | 管理画面: design-spec 6.5〜6.7.4 の「取得に失敗」「保存に失敗」「削除に失敗」「並べ替えの保存に失敗」の表示。入力は消さない。公開側: C2 |
| 認可エラー | `UNAUTHORIZED` → design-spec 6.4 の「ログインの有効期限切れ」の流れ。編集中なら、フォームの状態を退避して（ADR-008。扱いは design-spec 6.4 の表）から、`/admin/login?redirect={今のパス}` へ移す。`FORBIDDEN` → ログアウトして（失敗しても）、`/admin/login?error=forbidden` に移して design-spec 6.4 の「管理者でないアカウント」の表示 |
| 想定外のエラー | Sentry に送る。管理画面は通信・サーバーエラーと同じ表示で、開発中（`ENVIRONMENT=local`）だけ詳細を出す。公開側は C2 で、詳細は画面に出さずログで見る（上の公開側のサーバー関数の扱い） |

### ログとの対応

- リクエストID は Cloudflare の `cf-ray`（ローカルでは UUID）。Worker の入口で決め、`x-request-id` のレスポンスヘッダー、`INTERNAL_SERVER_ERROR` の `data.requestId`、すべてのログ行、Sentry のタグ（`request_id`）に入れる。入口・CMS API・公開側のサーバー関数は同じ関数（`src/monitoring/server.ts` の `requestIdOf`）でリクエストから決め、同じリクエストには同じ値を使う。
- ログは JSON の1行（`{ "level": "error", "msg": "...", "requestId": "...", "route": "PUT /api/admin/works/{id}", "code": "SLUG_CONFLICT" }`）で `console.log` ／ `console.error` に出し、Workers Logs で検索する（11章）。
- ログレベルの使い分けは `docs/05_operation-runbook.md` 1章。Sentry に送る範囲は11章。

---

## 9. i18n（国際化）

要否: **必要**（公開側は日本語と英語。管理画面は日本語のみ）。仕様（URL・振り分け・代替表示・言語ラベル・日付の表記・タイムゾーン）は design-spec 1.4 が正。ここでは実装の方法を決める。

| 項目 | 実装 |
|---|---|
| ライブラリ | 使わない（ADR-013） |
| メッセージカタログ | `src/i18n/messages/ja.ts`（型の基準）と `en.ts`（`satisfies Messages`）。言語に依らない値も日英に同じ値で持つ（例: `siteName`、ヘッダーのドメイン名 `siteDomain`）。領域ごとに入れ子にする（例: `section.career`、`label.onlyIn`、`paging.next`、`notice.postOnlyIn`）。値に差し込みがあるものは関数にする（例: `notice.postOnlyIn: (lang) => ...`。引数は実際に出している中身の言語）。管理画面の文言は辞書にせず、日本語を直接書く |
| ロケールの判定 | 公開側はルートのパラメーター `lang`（`ja`／`en` 以外は C1）が常に正。ルート `/` の振り分けの順序は design-spec 1.4 で、`src/routes/index.tsx` のサーバーハンドラーが Cookie `eastx-lang` と `Accept-Language`（q 値で並べた最優先の言語タグ）を読んで 302 を返す。`$lang` が `ja`・`en` 以外の C1 も同じ判定で言語を決める（`__root.tsx` の `beforeLoad` が `createIsomorphicFn` で、サーバーではリクエストのヘッダー、ブラウザでは `document.cookie` と `navigator.languages` を読んで context に入れ、`$lang/route.tsx` の `beforeLoad` が使う） |
| 言語の記憶 | Cookie `eastx-lang`（属性は7章）。言語を切り替えたときにクライアントで書く |
| 代替表示と言語ラベル | `src/domain/languages.ts`（言語ありの判定）と `src/content/localize.ts`（`LocalizedText`・`Availability` を作る）で行う。画面は `lang` 属性を `LocalizedText.lang` から付けるだけ |
| 日付の書式 | 表記は design-spec 1.4。実装は `src/i18n/format.ts` で、日時は `Intl.DateTimeFormat` に `timeZone: 'Asia/Tokyo'` を付け、英語の月は `month: 'short'` にする。年月（`YYYY-MM`）は時刻を持たないので、その月の1日を `timeZone: 'UTC'` で整形してずれを防ぐ。管理画面の表記は `formatToParts` の部品から組み立てる |
| HTML の宣言 | `<html lang>` は URL の言語。代替した部分に `lang` 属性。`hreflang` の代替ページ（ADR-019） |
| 数値 | 公開側は件数とページ番号だけで、桁区切りは使わない。管理画面の A10・A2 の解析の数は桁区切りを使う（`Intl.NumberFormat`） |

---

## 10. テスト戦略

| レイヤー | ツール | カバレッジ目標 | 対象 |
|----------|--------|---------------|------|
| ユニット | Vitest（Node.js 環境） | `src/domain/`・`src/i18n/`・`src/markdown/` の行カバレッジ 90% | スラッグの生成と重複の連番、言語ありの判定と代替、プライバシーのページがあるかの判定、抜粋の作り方、公開状態の遷移（5.3）と公開のルール、日付・期間の書式、Markdown の描画（生の HTML・`javascript:`・見出しのレベル・外部リンク・太字と使用技術の照合・元の行番号）、キャッシュのキーの使用技術の版、Tech Stack の群の分け方（`src/domain/stack-groups.ts`）。データ移行の使用技術のカテゴリの表（表に無い識別名が Tools になること、表とマイグレーションの SQL の識別名の集合が一致すること）。管理画面の規則（`src/admin/`）: 自動退避の規則（design-spec 6.4 の表の各行。A7 のカテゴリと Core のキーが無い退避を読み込んだ値で埋めることを含む）、A7 の Core と「トップに表示するか」の規則、Cmd/Ctrl+S の割り当て、保存の状態の文言、ボタンを押せない理由、最初の誤りの欄の順、文字数の表示、表示の切り替えの記憶、A11 の自動退避の種類と本文を日英とも空にして保存したときの通知。公開側の行の規則（`src/site/row-rules.ts`）: トップの行を広げられるかの判定。解析（`src/domain/analytics/`）: イベントの値の検査（種類ごとのキーの過不足、各値の規則）、訪問者のハッシュ（日付・日ごとの値・IP・User-Agent のどれかが違えば違う値）、日ごとの値の期限、ボットとデバイスの判定、流入元のホスト名と自分のホストの除外、UTM の正規化、日本時間の日付（UTC の 15:00 の前後）、期間・前の期間・区切り（週は月曜始まり、`all` の最初の月は開始日から）、`missingDays`、計測の開始日、集計する日の選び方（昨日・一昨日と未集計の日、7日まで、保持の外の日を除く）、上位100件と `(other)`、行の分け方。公開側の送信の部品（`src/site/analytics.ts`）: DNT・GPC・`webdriver` で送らない、`page_view` は前回と違う `path` だけ、bfcache から戻ったら送る、`referrer`・`utm` は最初の1回だけ、C2 では送らない、`sendBeacon` が無ければ `keepalive` の `fetch`、外部リンクの種類。A10 の規則（`src/admin/`）: 期間の決め方（クエリ → 覚えた値 → 30日）、数と割合の書き方、国と言語の名前、ページの名前 |
| API 結合 | Vitest ＋ `@cloudflare/vitest-pool-workers`（workerd 上で、ローカルの D1・R2 を使う。テストファイルごとにマイグレーションを当てた空の D1） | `/api/admin/*` の全手続きについて、未認証で 401・管理者でないセッションで 403 になるテストを必ず持つ（認可マトリクスの照合）。主要な手続きの正常系とエラー系 | CMS API の全手続き、Better Auth の hooks（管理者でない ID を拒否）、アップロードの形式・上限、`/media/*`、解析の受け口 `POST /api/collect`（204 と1件の書き込みの並び、同じ /64 の IPv6 は同じ訪問者、除外（DNT・GPC・ボット・管理者のセッション）、管理者でないセッションは書く、バインディングが無いと書かない、書き込みの例外でも 204、400・403・404・429）と日ごとの値（KV に無ければ期限付きで作る、あれば使う、isolate の中に5分持つ、Cron は翌日の値を作り書き換えない）、Cron の集計（`analytics_daily`・`analytics_rollup` に入る、2回目で行が変わらない、開始日より前を入れない、0件の日も入る、`(other)`、7日で止まる、SQL API の失敗した日は入らない、トークンが無くても翌日の値を作る）、`GET /api/admin/analytics`（422、合計・前の期間・区切り・上位10件・タイトルの引き当て、到達率、今日の分の有無（未登録・空・失敗・3秒）、`measuring`）と A2 の要約（SQL API を呼ばない）、プライバシーのページの保存（行が無ければ作る・`updated_at` が進む・空白だけの本文は `NULL`）と CHECK 制約。手で書いたマイグレーションが DB に入れた形（既定値・NOT NULL・CHECK）と、新しい列を書かない insert（古いコード）が既定値で入ること |
| 公開側の読み取り | 同上 | 各サーバー関数の正常系と、下書き・詳細本文なしが返らないこと | 公開中だけを返す、並び順、前後のナビ、言語の代替、Tech Stack の群（トップに出さない技術を含めない）、自己紹介のキャッシュのキーが使用技術のカテゴリと Core で変わらないこと。プライバシーのページ（行が無い・本文が日英とも空なら返さない、言語の代替、メタの説明の言語と hreflang、フッターの `hasPrivacyPage`、描画結果のキャッシュの種類） |
| E2E | Playwright（Chromium）＋ ローカルの D1（デモデータのシード） | design-spec のコアフロー（2.2）を1本ずつ | 訪問者: トップ → ページング → 作品詳細 → 戻るで元のページ、ヘッダーのドメイン名からトップへ、プロフィールの上の一言（無ければ詰め、ヘッダーからの余白が変わらない）、経歴・作品・プロジェクトの行を行全体（キーボードの Enter・Space を含む）で広げ、広げた中の入口から詳細・外部へ移る、広げた行の名前の折り返し（モバイル幅。経歴は `所属 ~` と `タイトル` の境で折り返し、長い所属も ▸ と同じ1行目から始まる。1行目の名前は広げても横に動かず、続きの行は ▸ の左端から始まる）、言語の切り替え、0件のセクションが消える（空のシード）。管理者: ログイン済みの状態から作品を作成 → 下書き保存 → 公開 → 公開サイトで確認、並べ替え、セッション切れ → 一時保存の復元、長い本文をスクロールしても操作バーが見えている、Cmd/Ctrl+S、「日英」で日英の本文を書いて保存、誤りの欄への移動、設定の引き出し、自動退避の復元の提案、使用技術を検索の欄を閉じずに続けて選ぶ、画像を挿入、L6（経歴）の「日英」で保存、A3 で一言を保存すると P1 に出る、ログアウトで退避を消す。P1 の Tech Stack の群（見出しの順と `lang`、Core の技術が Core の群にだけ出る、トップに出さない技術が無い、アイコンが無い・読み込めない技術の頭文字の丸、空の群を出さない）、公開側の使用技術の並びのアイコン（Tech Stack・行・P2）がグレースケールとトーンカーブのフィルターで切り抜かれず、ダークモードでは白黒反転され、自己紹介の太字の前と管理画面のアイコンは元の色、P1 の Tech Stack のリンクのチップは ↗ を見せず読み上げにだけ「別タブで開く」があり、P2 のチップは ↗ を見せる、A7 でカテゴリ・Core を変えて保存すると P1 の群が移る、Core をオンにすると「トップに表示するか」がオンで押せなくなる、Core でトップに表示しない値を保存すると欄の下に誤りを出す。P6・A11: フッターのリンクから P6（/ja・/en）へ移る、C1 のフッターにもリンクがある、A11 で英語の本文を空にすると /en/privacy に注記と日本語の本文が出る、「日英」で日英とも空にするとフッターのリンクが消えて P6 が C1 になる、行が無いときの空のフォームと「公開サイトで見る」が保存済みの本文があるときだけ出ること、A11 の Cmd/Ctrl+S・保存の状態・保存中の理由・自動退避の復元・移動の確認（本文を書き換えるテストは、各テストの後にシードの本文へ戻す）。解析（ローカルは `ANALYTICS_BEACON=on` で、受け口は書かずに 204）: P1 の `page_view`（参照元・UTM 付き）・`section_view`・`paging`・`row_expand`（閉じたときは送らない）・`outbound`、詳細への移動の `page_view`（参照元なし）・`read_complete`・テーマと言語の切り替え、コードのコピー、`$lang` の下の C1、`navigator.webdriver` と DNT のブラウザは送らない（Playwright の Chromium は `webdriver` が true なので、確かめるテストでは初期化のスクリプトで false にし、`sendBeacon` を包んで本文を読む）。A10 がデモの集計で出て各表が API の応答と一致する、期間の切り替えと記憶、「集計していない日があります（1日）」と「この環境では計測していません」、A2 の要約から A10 の7日へ移って覚えた期間が変わらない、サイドメニューの並び |
| アクセシビリティ | Playwright ＋ `@axe-core/playwright` | P1〜P6・A1・A2・A10 と、A3・A4・A5・A7・A8・A11 の編集ビュー（ライト・ダーク）で重大（serious 以上）な違反 0件。P1 は経歴・作品・プロジェクトを各1行広げた状態も検査する | 自動で検出できる範囲。表示の切り替え・設定の引き出し・画像を挿入をキーボードだけで操作できること。トップの行をキーボードで広げ、広げた中のリンクへ Tab で移れること。A10 の期間とグラフのツールチップをキーボードだけで操作できること |
| Lighthouse | Lighthouse CI（`@lhci/cli`。モバイルの設定） | PRD 5章の Lighthouse の目標を、3回の中央値で assert する | デモデータを入れたプレビューの P1 と、P2〜P5 の各1ページ。本番では Cloudflare の拠点が HTML・JS・CSS を圧縮するが、ローカルのプレビューは圧縮しないので、gzip で圧縮して中継する（`scripts/lhci/server.ts`。本番の brotli より縮まない側で測る）。ローカルの robots.txt はすべてを拒否する（ADR-019）ので、SEO の `is-crawlable` の項目は外して測る |

- API 結合テストの 401・403 の確認は、CSRF のヘッダーを付けたリクエストで行う（5.1）。ヘッダーがないときに 403 になることも別に確かめる。
- E2E のログイン: テスト用のヘルパーが、ローカルの D1 に管理者とセッションを作り、Better Auth と同じ方式で署名した Cookie をブラウザに入れる。本番のコードにテスト用の入口は作らない。
- 実行のコマンドは `make test`（ユニット・結合）と `make e2e`（E2E・アクセシビリティ・Lighthouse。`docs/03_dev-setup.md`）。CI ではどちらも PR ごとに走る。

---

## 11. モニタリング・ログ

運用の手順（アラートの閾値・ログの見方・障害対応）は `docs/05_operation-runbook.md` が持つ。ここでは道具と設定を決める。

| 項目 | ツール | 設定 |
|------|--------|------|
| リクエストのログ | Workers Logs | `wrangler.jsonc` の `observability.enabled: true`、`head_sampling_rate: 1`（全件）。アプリのログは JSON の1行（8章） |
| エラー追跡（サーバー） | Sentry（`@sentry/cloudflare`） | `src/server.ts` を `withSentry` で包む（`fetch` と `scheduled`）。`environment` は `ENVIRONMENT`。トレースは `tracesSampler` で本番 0.1・staging 1.0、解析の受け口 `/api/collect` は0（量が多い。ADR-018）。5xx と想定外の例外だけ送る |
| 解析の集計の失敗 | Sentry ＋ Workers Logs | Cron（`scheduled`）の1日ぶんの集計の失敗（SQL API の 4xx・5xx、D1 のエラー）、API トークンかアカウント ID が無いこと、日ごとの値を作れないことを、ERROR のログ（`route` は `scheduled`、`requestId` は `cron:{実行の時刻}`）と Sentry に送る。成功は INFO のログに集計した日と失敗した日を出す。解析の受け口の書き込み（`writeDataPoint`）の例外も ERROR のログと Sentry に送る |
| エラー追跡（ブラウザ） | Sentry（`@sentry/react`） | DSN はルートのローダーがサーバーの `SENTRY_DSN` から渡す（ビルド時の環境変数にしない）。SDK は DSN があるときだけ読み込む（`src/monitoring/browser.ts`）。React のエラー境界（ルートの errorComponent）で受けたものと、SDK の既定で拾う捕まえていない例外を送る。サーバーが送ったうえで中身を伏せた公開側のサーバー関数の失敗（8章）は送らない。Web Vitals（TTFB・LCP。7章の測り方）は `browserTracingIntegration` のページ読み込みの計測で送り、`tracesSampleRate` はサーバーと同じ |
| 稼働監視 | Sentry Uptime Monitoring | 本番の `https://x.eastasian.dev/ja` を5分ごと |
| メトリクス | Cloudflare ダッシュボード（Workers・D1・R2） | リクエスト数・エラー率・CPU 時間・D1 の読み書き行数を見る |
| リアルタイムのログ | `wrangler tail` | 障害調査のときに使う |
