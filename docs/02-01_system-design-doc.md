# System Design Doc — eastx

入力: `docs/design-spec.md`（画面・ロール・振る舞いの正）、`docs/screen_flow.mermaid`
このドキュメントが持つもの: 技術選定（ADR）、アーキテクチャ、ルーティング、API、データモデル、セキュリティ、エラーハンドリング、i18nの実装方針、テスト戦略、モニタリング。
画面の存在・目的・レイアウト・認証要否・振る舞いは design-spec が持つので、ここには書かずに章番号で参照する。

---

## 1. Goal / Non-Goal

### Goal

- design-spec の全16画面（公開5・管理9・共通2）を、1つの Cloudflare Worker で動かす。
- 公開側は、ページを返す前に中身をすべて用意して SSR する（design-spec 6.1.5）。管理画面で保存した変更は、次のリクエストからすぐ公開側に出る。
- 管理画面が使う CMS API を、OpenAPI で説明できる REST API として持ち、管理画面からは型付きで呼ぶ。API を使えるのは、GitHub でログインした管理者1人だけにする。
- 見た目の値は `docs/06_design-tokens.json` から生成したトークンだけで指定し、トークン以外の値を型エラーにする。
- 今のサイト（eastasian）のデータを移せるデータモデルにする（design-spec 9章）。
- 固定費を Workers Paid（月 $5）とドメイン代に抑える。

### Non-Goal

- 複数の管理者、権限の細分化、同時編集の競合検出（使うのは持ち主1人）。
- CMS API を外部に公開すること。管理画面専用で、CORS も開けない。
- 公開ページの HTML のエッジキャッシュや ISR（アクセス量に対して不要。必要になったら ADR を追加して検討する）。
- 動的な OGP 画像の生成、画像の自動リサイズ・形式変換。
- 定期実行（Cron）やジョブキュー（予約投稿などはスコープ外。design-spec 9章）。

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
                         │  │    └ /media/*     ─▶ R2 から画像を配信                  │  │
                         │  │ それ以外 ─────────▶ TanStack Start（SSR）               │  │
                         │  │    ├ /, /ja, /en, /{lang}/...  公開側（ローダー → サーバー関数）│
                         │  │    └ /admin/*                  管理画面（クライアント描画）│  │
                         │  └──────────────────────────────────────────────────────┘  │
                         │     │ Drizzle             │ R2 API          │ Rate Limiting  │
                         │  ┌──▼──────┐        ┌─────▼─────┐    ┌──────▼──────┐        │
                         │  │ D1 (DB) │        │ R2 (MEDIA)│    │ *_RATE_LIMITER│      │
                         │  └─────────┘        └───────────┘    └─────────────┘        │
                         └─────────────────────────────────────────────────────────────┘
                                │ OAuth                          │ エラー・稼働監視
                           github.com                          Sentry
```

### 通信フロー

| フロー | 経路 |
|---|---|
| 公開側の初回表示（例: `/ja`） | Worker → TanStack Start のルートのローダー → サーバー関数（`src/content/`）→ Drizzle → D1（1回の `batch` でまとめて読む）→ SSR した HTML を返す |
| 公開側の画面移動（例: トップ → 作品詳細） | ブラウザのルーター → ローダーがサーバー関数を呼ぶ（TanStack Start が内部の HTTP エンドポイントに変換する）→ JSON → クライアントで描画 |
| 管理画面の表示 | `/admin/*` はクライアント描画（`ssr: false`）。Better Auth のクライアントでセッションを確かめ、oRPC のクライアント（`OpenAPILink`）と TanStack Query で `/api/admin/*` を呼ぶ |
| CMS API | Elysia → oRPC の OpenAPIHandler → ミドルウェア（リクエストID → レート制限 → CSRF → 認証・認可）→ 手続き → Drizzle → D1 ／ R2 |
| ログイン | A1 → `POST /api/auth/sign-in/social` → github.com で認可 → `GET /api/auth/callback/github` → Better Auth が管理者か確かめてセッションを作り、Cookie を付けて元の画面へ戻す |
| 画像 | 管理画面 → `POST /api/admin/uploads` → R2 に保存 → `/media/...` のパスを返す。公開側・管理画面は `/media/...` を `<img>` で読む（Worker が R2 から返し、長期キャッシュさせる） |

### インフラ管理

| 対象 | 管理方法 |
|---|---|
| Worker・バインディング（D1・R2・Rate Limiting）・独自ドメイン・環境変数 | `wrangler.jsonc`（リポジトリで管理。トップレベル = ローカル、`env.staging`、`env.production`） |
| D1・R2 の作成 | 初回だけ wrangler CLI で作る（`docs/04_deployment-procedure.md` 3章）。作った ID を `wrangler.jsonc` に書く |
| DB スキーマ | Drizzle のスキーマ（`src/db/schema.ts`）→ drizzle-kit で SQL のマイグレーションを生成 → wrangler で D1 に適用 |
| シークレット | ローカルは `.dev.vars`（Git に入れない）、staging・本番は `wrangler secret put` |
| DNS | `eastasian.dev` のゾーンを Cloudflare で管理する。Worker の Custom Domain を作ると DNS レコードと証明書が自動で用意される |
| IaC ツール | 使わない（ADR-017） |

---

## 3. 技術選定と判断理由（ADR）

確定したスタックの一覧:

| 層 | 選定 |
|---|---|
| アプリの形 | 一体型（1つの Worker の入口で、API と UI に振り分ける） |
| ホスティング | Cloudflare Workers（Paid プラン）、独自ドメイン `x.eastasian.dev` |
| UI | TanStack Start（React） |
| API | Elysia ＋ oRPC（コントラクト先行、OpenAPI の REST） |
| DB / ORM | Cloudflare D1 ／ Drizzle ORM（drizzle-kit） |
| バリデーション | Zod |
| 認証 | Better Auth（GitHub OAuth、DB セッション） |
| 画像 | Cloudflare R2（Worker の `/media/*` から配信） |
| Markdown | unified（remark-gfm・rehype-sanitize）＋ Shiki |
| i18n | 自前の型付き辞書 ＋ Intl |
| スタイル・UI 部品 | Panda CSS（strictTokens）＋ Ark UI。エディタは CodeMirror 6、並べ替えは dnd-kit |
| ツール | TypeScript、Bun（パッケージ管理・スクリプト）、Node.js 24（wrangler・Vite の実行）、Biome、Vitest、Playwright |
| CI/CD | GitHub Actions ＋ wrangler。staging・本番とも昇格 PR でデプロイ |
| 監視 | Workers Logs ＋ Sentry（エラー・稼働監視） |

### ADR-001: アプリの形は一体型（1つの Worker の入口で API と UI に振り分ける）

**決定:** 公開サイト・管理画面・CMS API を1つのリポジトリ、1つのパッケージ、1つの Worker にまとめる。Worker の入口（`src/server.ts`）で、`/api/*` と `/media/*` を Elysia に、それ以外を TanStack Start に振り分ける。

**理由:** 今のサイトの保守がつらかった原因は、Nx モノレポと別ホストの Express API という構成の重さだった。管理者1人・訪問者向けの読み取り中心という規模なら、デプロイ先と設定を1つに保つのが最も手を入れやすい。それでも「CMS ＋ フロント」の分離は、入口の振り分けと、管理画面が API 経由でしかデータを書かないという境界でコード上に残せる。

**トレードオフ:** 公開側と管理側を別々にスケールしたりデプロイしたりはできない（個人サイトでは不要）。API を別ホストに切り出したくなったら、Elysia の部分（`src/api/`）をそのまま別 Worker に移せる構成にしておく。捨てた案: 2アプリ（公開サイトと管理画面を分ける）、3分割（今の構成に近い）、BaaS ＋ フロント（CMS API を自作する部分が薄くなる）。

### ADR-002: ホスティングは Cloudflare Workers（Paid）と独自ドメイン

**決定:** Cloudflare Workers の Paid プラン（月 $5）で動かす。本番は `x.eastasian.dev`、staging は `x-staging.eastasian.dev`（どちらも Worker の Custom Domain）。`eastasian.dev` のゾーンは Cloudflare で管理する。

**理由:** D1・R2・Rate Limiting をバインディングで直接使え、ローカルでも wrangler（Miniflare）で同じものが動く。R2 は下り転送が無料で、画像配信のコストが伸びない。Paid にするのは、Markdown の描画（Shiki）や Better Auth の処理が Free プランの CPU 時間（1リクエスト 10ms）を超えうるのと、Worker のサイズ上限（Free 3MB）に TanStack Start・Elysia・Better Auth・Shiki が収まらない可能性があるため。staging を `x.eastasian.dev` のサブドメイン（2階層目）ではなく `x-staging.eastasian.dev` にするのは、Universal SSL の証明書がカバーするのが1階層目のサブドメインまでで、2階層目には追加の証明書が要る場合があるため。

**トレードオフ:** Workers は Node.js と完全には互換でなく（`nodejs_compat` で主要な API は使える）、CPU 時間にも制限がある。Vercel（Next.js と相性がよい）や、コンテナ常駐（Fly.io・Cloud Run）は選ばなかった。`eastasian.dev` のネームサーバーがまだ Cloudflare でなければ、移す作業が要る（`.dev` は HTTPS が必須のドメインだが、Custom Domain の証明書で満たせる）。

### ADR-003: UI フレームワークは TanStack Start（React）

**決定:** 公開側と管理画面の UI を TanStack Start で作る。公開側のルートはサーバーのローダーで中身を用意して SSR し、管理画面のルート（`/admin/*`）は `ssr: false` でクライアント描画にする。Cloudflare へは `@cloudflare/vite-plugin` で載せる。

**理由:** 1つのフレームワークで「公開側は SSR、管理画面は SPA」を使い分けられる。ルートの型が強く、`/$lang` のようなパラメーターも型付きで扱える。oRPC に TanStack Query 連携（`@orpc/tanstack-query`）があり、管理画面のデータ取得・更新・キャッシュの無効化をまとめて書ける。Workers への載せ方が公式に用意されている。

**トレードオフ:** Next.js（今のサイトで経験がある）に比べると情報が少ない。React Router v7 は Cloudflare での実績が最も多いが、ルートの型安全は型生成で補う形になる。Next.js は Workers では変換アダプター（OpenNext）を挟み、ISR などに追加の設定が要る。Astro は公開側には最適だが、管理画面を React のアイランドで作ることになり、UI の作り方が2種類になる。

### ADR-004: API フレームワークは Elysia（Cloudflare Worker アダプター）

**決定:** `/api/*` と `/media/*` を Elysia で受ける。Elysia は Cloudflare Worker アダプター（`elysia/adapter/cloudflare-worker`）を使い、モジュールのトップレベルで `.compile()` しておく。oRPC と Better Auth のハンドラーは Elysia のルートにぶら下げ、本文を Elysia に読ませない（`parse: 'none'`）。

**理由:** ユーザーの指定。HTTP の入口（認証の受け口・API・画像配信）を1か所にまとめ、`src/api/` だけで CMS API の HTTP 層が完結する。

**トレードオフ:** Elysia は Bun を主な実行環境としており、Workers のアダプターは比較的新しい。Workers は実行時のコード生成（`new Function`）を許さないため、アダプターの設定に依存する。**Phase 5 の最初のステップで、TanStack Start ＋ Elysia ＋ oRPC が `wrangler dev` と本番の両方で動くことを確かめる（スパイク）。** 動かない場合の代替は、Elysia の AOT を切る（`aot: false`）こと、それでも駄目なら oRPC の fetch ハンドラーを入口から直接呼ぶこと（ADR を更新する）。Hono（Workers での実績が最も多い）は選ばなかった。

### ADR-005: 通信方式は oRPC（コントラクト先行の REST）。公開側はサーバー関数で直接読む

**決定:**
- 管理画面 ↔ サーバーは oRPC。`@orpc/contract` でコントラクト（HTTP メソッド・パス・入出力の Zod スキーマ・定義済みエラー）を先に書き、サーバーはそれを実装する。サーバーは `OpenAPIHandler` で REST として公開し、管理画面は `OpenAPILink` の型付きクライアントで呼ぶ。OpenAPI の仕様は `GET /api/admin/openapi.json` で出す。
- 公開側は CMS API を通さない。TanStack Start のサーバー関数（`createServerFn`）がサーバー内で D1 から公開中の中身だけを読み、表示用の形（ビューモデル）にして返す。
- リアルタイム通信（WebSocket・SSE）は使わない（要件がない）。

**理由:** コントラクトが API 設計書と実装の両方の正になり、5章をそのまま実装に移せる。REST にしておくと、curl や OpenAPI のツールで確かめられ、将来 API を別ホストに切り出しても形が変わらない。公開側を API 経由にしないのは、SSR のたびに自分自身へ HTTP を投げる無駄を避け、公開中の中身しか返さない読み取り専用の経路を分けておくため。

**トレードオフ:** `OpenAPILink` は JSON にできる型しか運べないので、日時は ISO 8601 の文字列で受け渡す（Date 型は使わない）。oRPC 標準の `RPCHandler` よりリクエストが少し冗長になる。tRPC（REST として呼べない）と Server Actions（API の境界が画面に溶ける）は選ばなかった。

### ADR-006: DB は Cloudflare D1

**決定:** D1（SQLite）を使う。作成時に場所のヒントを `apac` にする。本番と staging で別の DB を持つ。

**理由:** Worker からバインディングで直接読め、接続の管理が要らない。ローカルは wrangler だけで動き、Docker が要らない。個人サイトの件数（数百件）なら容量・性能とも十分で、無料枠に収まる。Time Travel（Paid で30日）で任意の時点に戻せる。

**トレードオフ:** SQLite なので、UUID・enum・日付の型を持たない（文字列と CHECK 制約で表す。6章）。書き込みは1か所（プライマリ）に集まる。今の DB（Supabase の Postgres）とは系統が変わるので、データ移行は SQL のダンプではなく変換スクリプトで行う。Postgres ＋ Hyperdrive は、外部サービスが1つ増え、ローカルに Docker が要るので選ばなかった。

### ADR-007: ORM は Drizzle、マイグレーションは drizzle-kit で生成して wrangler で適用

**決定:** スキーマは Drizzle（`drizzle-orm/sqlite-core`）で書く。`drizzle-kit generate` で `drizzle/migrations/` に SQL を作り、`wrangler d1 migrations apply` で適用する（`wrangler.jsonc` の `migrations_dir` をこのディレクトリにする）。マイグレーションは前進のみで、戻すときは新しいマイグレーションを足す。

**理由:** Drizzle は D1 に正式に対応していて軽く、Workers のバンドルを圧迫しない。`db.batch()` で複数のクエリを1往復にまとめられる。SQL ファイルがリポジトリに残るので、何が適用されるかをレビューできる。

**トレードオフ:** Prisma（今のサイトで使っていた）ほどのリレーションの表現力はない。`drizzle-kit push` は D1 のローカルと相性が悪いので使わず、開発中もマイグレーションを生成して適用する。

### ADR-008: バリデーションは Zod（コントラクトと管理画面のフォームで共有）

**決定:** API の入出力は Zod（v4）で定義する。同じスキーマを管理画面のフォームの入力チェックにも使う。

**理由:** oRPC が Standard Schema に対応しており、Zod のスキーマがそのままコントラクトと OpenAPI の仕様になる。サーバーとフォームでルールが食い違わない。

**トレードオフ:** 公開時の必須チェック（言語ありの判定など）は状態によって変わるので、Zod だけでは書かず `src/domain/` の関数で行う（5.3）。

### ADR-009: 認証は Better Auth（GitHub OAuth）、管理者は環境変数の GitHub ID で決める

**決定:**
- Better Auth を Drizzle アダプター（D1）で使い、GitHub のソーシャルログインだけを有効にする。セッションは DB に持ち、HttpOnly の Cookie で渡す（有効期限30日、1日ごとに延長）。
- 管理者として通す GitHub アカウントは、環境変数 `ADMIN_GITHUB_USER_ID`（GitHub の数値 ID）で決める。初めてログインしたときに、その ID の人だけ `admin_user` が作られる（`databaseHooks.user.create.before` でそれ以外を拒否する）。セッションを作るとき（`databaseHooks.session.create.before`）と、API の認可（5.1）でも同じ ID かを確かめる。
- テーブル名は design-spec の `admin_user` に合わせ、Better Auth のテーブルを `admin_user`・`admin_session`・`admin_account`・`auth_verification` として持つ（6章）。

**理由:** ユーザーの指定。OAuth の state・PKCE、Cookie の署名、セッションの延長と失効など、自前で書くと間違えやすい部分をライブラリに任せられる。Elysia・Drizzle・D1 との組み合わせ方が公式に用意されている。管理者の登録をシードではなく環境変数と初回ログインで行うので、本番 DB に手で行を入れる作業がない。

**トレードオフ:** 管理者1人には大きめのライブラリで、Better Auth の都合のテーブル（`admin_account`・`auth_verification`）とカラム（`email` など）が増える。GitHub のアクセストークンが `admin_account` に保存される（スコープは `read:user` と `user:email` だけで、リポジトリの権限は持たない）。Arctic（OAuth だけのライブラリ）＋ 自前のセッションは、コードは小さいが自分で守る範囲が広いので選ばなかった。

### ADR-010: 画像は R2 に置き、Worker の `/media/*` から配信する

**決定:** 画像は R2 のバケット（`MEDIA` バインディング）に `uploads/{yyyy}/{mm}/{uuid}.{拡張子}` のキーで置く。DB には `/media/uploads/...` というルート相対のパスを持つ。`/media/*` は Elysia が R2 から読み、`Cache-Control: public, max-age=31536000, immutable` を付けて返す。アップロードの上限は 5MB、形式は PNG・JPEG・WebP・GIF・AVIF・SVG。

**理由:** キーに UUID を使うので同じ URL の中身は変わらず、ブラウザと Cloudflare に長くキャッシュさせられる。ルート相対のパスにすると、ローカル・staging・本番で同じデータが使え、独自ドメインを変えても DB を書き換えずに済む。R2 は下り転送が無料。

**トレードオフ:** 画像のリサイズや形式変換はしない（サムネイルは CSS で同じ縦横比に切り抜く）。必要になったら Cloudflare Images を検討する。使われなくなった画像は残る（掃除はスコープ外。design-spec 9章）。下書きの中身に使った画像も、URL を知っていれば見られる（UUID なので推測はできない）。

### ADR-011: 公開側は毎回 SSR し、HTML はキャッシュしない（保存した瞬間に反映）

**決定:** 公開側のページは、リクエストのたびに D1 から読んで SSR する。HTML にはエッジのキャッシュをかけない（`Cache-Control: private, no-cache`）。重い処理である Markdown の描画結果だけを、Workers の Cache API に `md:{種類}:{id}:{言語}:{updated_at}` のキーで保存する。

**理由:** design-spec 9章の「公開サイトに変更を反映するタイミング」を「保存した瞬間」に決める。個人サイトのアクセス量なら毎回の D1 読み取りで足り、キャッシュの無効化を考えずに済む。Markdown のキャッシュはキーに `updated_at` を含むので、保存すれば自動的に別のキーになり、古い結果が出ることはない。

**トレードオフ:** アクセスが急に増えると D1 の読み取りが増える（Paid の無料枠は月 250 億行で、余裕がある）。Cache API はデータセンターごとなので、最初のアクセスは描画からやり直しになる。ISR やページ単位のキャッシュは Non-Goal。

### ADR-012: Markdown は unified ＋ rehype-sanitize ＋ Shiki で、公開側とプレビューで同じ描画をする

**決定:** `src/markdown/` に描画の関数を1つ持ち、公開側（サーバー）と管理画面のプレビュー（ブラウザ）の両方から使う。処理は remark-parse → remark-gfm → remark-rehype（生の HTML は通さない）→ rehype-sanitize（GitHub のスキーマ）→ 見出しのレベル下げ・外部リンクの処理 → Shiki（コードの色分け）→ HTML 文字列。Shiki は JavaScript の正規表現エンジンと、使う言語だけを読み込む細かいバンドルにする。テーマはライト・ダークの2つを CSS 変数で切り替える。

**理由:** design-spec 6.3.1 のルール（GFM、生の HTML を無効、見出しを1段下げる、外部リンクは別タブと ↗、コードの色分け）を1か所で実装し、プレビューと公開の見た目を一致させる。サニタイズを Shiki より前に置くのは、Shiki が付けるスタイルを消さないため。

**トレードオフ:** Shiki は重いので、管理画面ではエディタを開いたときにだけ読み込む。対応する言語を増やすとバンドルが大きくなる（初期は ts・tsx・js・jsx・json・bash・html・css・python・go・rust・sql・yaml・markdown・diff）。

### ADR-013: i18n はライブラリを使わず、型付きの辞書と Intl で行う

**決定:** 固定文言は `src/i18n/messages/ja.ts` と `en.ts` に持ち、日本語の辞書の型をもう一方に満たさせる（`satisfies`）。日付は `Intl.DateTimeFormat` に `timeZone: 'Asia/Tokyo'` を付けて整形する。詳しくは9章。

**理由:** 公開側の2言語だけで、文言も少ない。URL の言語（`/ja`・`/en`）が常に正なので、ライブラリの言語判定の仕組みは要らない。

**トレードオフ:** 複数形や言語が増えたときの仕組みは自分で足すことになる（3言語目はスコープ外）。

### ADR-014: スタイルは Panda CSS（strictTokens）、UI 部品は Ark UI。トークンは自作スクリプトで変換する

**決定:**
- Panda CSS を使い、`strictTokens: true` と `strictPropertyValues: true` で、トークン以外の値を型エラーにする。
- `docs/06_design-tokens.json` を正とし、`scripts/tokens/build.ts`（Bun で実行）が Panda の `tokens`（プリミティブ層）と `semanticTokens`（セマンティック層。ライト・ダークは条件付きの値）を `src/styles/tokens.generated.ts` に書き出す。`panda.config.ts` はそれを読む。生成物は Git に入れず、`make setup`・`make dev`・`make build` の前に作り直す。Style Dictionary は使わない。
- ダークモードは `<html data-theme="light|dark">` で切り替え、Panda の `_dark` 条件を `[data-theme=dark] &` に設定する。OS に合わせる設定のときは、`<head>` の小さなスクリプトが `prefers-color-scheme` を見て `data-theme` を描画前に入れる。
- ブレークポイントは design-spec 4.3 の値を `panda.config.ts` に設定する。
- UI 部品（ダイアログ・メニュー・トースト・タブ・セレクト・スイッチ・コンボボックス・ツールチップ）は Ark UI（ヘッドレス）で作り、見た目は Panda のレシピで付ける。

**理由:** design-spec 4.4 の「見た目はすべてデザイントークン経由で指定し、コンポーネントに値を直接書かない」を、レビューではなく型の仕組みで守れる。Panda のトークンは「プリミティブ＋セマンティック（条件付き）」の2層で、06 の構造にそのまま対応する。ビルド時に CSS を生成するので、SSR でもランタイムの負荷がない。Ark UI は Panda と同じチームが作っていて、アクセシビリティ（キーボード操作・読み上げ）をライブラリに任せられる。

**トレードオフ:** Tailwind ＋ shadcn/ui に比べて情報とコピーして使える部品が少なく、部品の見た目は自分で作る。変換スクリプトを自分で保守する（DTCG の型のうち、06 で使っているもの: color・dimension・fontFamily・fontWeight・duration・cubicBezier・number・shadow・typography・transition だけに対応すればよい）。

### ADR-015: 管理画面のエディタは CodeMirror 6、並べ替えは dnd-kit

**決定:** Markdown エディタは CodeMirror 6（`@codemirror/lang-markdown`）。画像の貼り付け・ドロップでアップロードし、カーソル位置に画像の記法を入れる処理を拡張で足す。一覧の並べ替えと、作品・プロジェクトの使用技術のチップの並べ替えは dnd-kit（sortable）で行い、キーボードでも並べ替えられるようにする。

**理由:** CodeMirror 6 は拡張で貼り付け・ドロップを扱いやすく、軽い。dnd-kit はキーボード操作と読み上げに対応している。

**トレードオフ:** WYSIWYG にはしない（Markdown をそのまま書く）。どちらも管理画面のチャンクだけに入れ、公開側のバンドルには含めない。

### ADR-016: パッケージ管理とスクリプトは Bun、wrangler・Vite・Vitest は Node.js で動かす

**決定:** パッケージ管理（`bun install`、`bun.lock`）とスクリプトの実行（`bun run`、`bun scripts/*.ts`）は Bun で行う。wrangler・Vite・Vitest・Playwright・drizzle-kit は Node.js 24 で動く（`bun run` は各 CLI の shebang に従って Node.js で起動する）。Linter・Formatter は Biome、テストは Vitest と Playwright。

**理由:** ユーザーの指定。インストールが速く、TypeScript のスクリプト（トークン変換・シード生成）をそのまま実行できる。wrangler と Workers 用の Vitest（`@cloudflare/vitest-pool-workers`）は Node.js を前提としているので、そこは Node.js に任せる。本番はどちらでもなく Workers のランタイム（workerd）で動く。

**トレードオフ:** 開発者のマシンに Bun と Node.js の両方が要る。`bun test` は workerd で動かせないので使わない。

### ADR-017: CI/CD は GitHub Actions ＋ wrangler。staging・本番とも昇格 PR でデプロイし、IaC ツールは使わない

**決定:**
- コードの PR では lint・型チェック・テスト・ビルド・E2E を GitHub Actions で走らせる。`main` へのマージではデプロイしない。
- 環境ごとのバージョン宣言ファイル `deploy/staging/version` と `deploy/production/version`（中身は `main` のコミット SHA）を更新する昇格 PR をマージすると、その環境へデプロイする。手順は D1 のマイグレーション適用 → ビルド → `wrangler deploy` → 疎通確認。
- 本番の昇格 PR では、その SHA が staging に出したことのある SHA であることを CI で確かめる。
- ロールバックは昇格 PR の revert。
- インフラは `wrangler.jsonc` と、初回だけ使う wrangler CLI で管理し、Terraform などは使わない。

**理由:** ユーザーの指定で、staging にも昇格 PR で出す。どのバージョンがどの環境で動くべきかが Git の履歴だけでわかり、デプロイもロールバックも PR で行える。Cloudflare の構成要素は少なく、`wrangler.jsonc` で十分に表せる。

**トレードオフ:** `main` にマージしても自動では staging に出ないので、確かめたいときは昇格 PR を作る手間がある（`make promote` で作業を減らす）。マイグレーションは前進のみなので、ロールバックしてもスキーマは戻らない。そのため、マイグレーションは古いコードでも動く形（追加 → 移行 → 削除の順に分ける）で書く。

### ADR-018: 監視は Workers Logs ＋ Sentry

**決定:** Workers Logs（`observability.enabled`）で全リクエストのログを持つ。エラーは Sentry に送る（サーバーは `@sentry/cloudflare` で Worker の入口を包み、ブラウザは `@sentry/react`）。稼働監視は Sentry の Uptime Monitoring で `/ja` を見る。ログとエラーには、リクエストID（Cloudflare の `cf-ray`）を付ける。

**理由:** 1人で運用するので、エラーと停止にメールで気づければよい。Workers Logs は設定だけで使え、Sentry は Workers に公式に対応している。

**トレードオフ:** Sentry の無料枠（エラー件数・稼働監視の数）を超えるとデータが落ちる。アクセス解析はしない（design-spec 9章でスコープ外）。

### ADR-019: ページのタイトル・説明・OGP は静的なルールで作り、OGP 画像は動的に生成しない

**決定:** design-spec 9章の「各ページのタイトル・説明・OGP 画像の作り方」を次に決める。

| ページ | `<title>` | 説明（description・og:description） | og:image |
|---|---|---|---|
| P1 トップ | `eastasian — {プロフィールの名前}` | プロフィールの肩書き。なければ自己紹介の抜粋 | 言語ごとの既定画像 `/og/default-{lang}.png` |
| P2・P3 | `{タイトル} — eastasian` | 概要。なければ詳細本文の抜粋 | サムネイル。なければ既定画像 |
| P4・P5 | `{タイトル} — eastasian` | 本文の抜粋 | サムネイル。なければ既定画像 |
| C1・C2 | `{見つかりません ／ エラー} — eastasian` | なし | 既定画像 |

- テキストは表示中の言語のもの（項目単位の代替表示は design-spec 1.4 に従う）。抜粋の作り方は design-spec 6.1.4。
- `og:image` などの絶対 URL は `SITE_URL` から作る。`og:locale` は `ja_JP` ／ `en_US`、`og:locale:alternate` にもう一方を入れる。
- 各ページに `<link rel="canonical">` と、`hreflang` の `ja`・`en`・`x-default`（`x-default` はルート `/`）を出す。
- 管理画面は `<meta name="robots" content="noindex">`、`/admin/*` と `/api/*` のレスポンスと staging のすべてのレスポンスに `X-Robots-Tag: noindex, nofollow` を付ける。`robots.txt` で `/admin` と `/api` を拒否する。

**理由:** OGP 画像の動的生成（Satori など）は CPU とバンドルを食い、個人サイトでは割に合わない。サムネイルがあればそれで十分伝わる。

**トレードオフ:** サムネイルのない記事は、どれも同じ既定画像になる。

### ADR-020: リポジトリは単一パッケージ

**決定:** モノレポにせず、1つの `package.json` で全体を持つ。`src/` の中で公開側・管理画面・API・共有コードを分ける（`docs/03_dev-setup.md` 2章）。

**理由:** 今のサイトの Nx モノレポが保守の重さの原因だった。デプロイ単位が1つなので、パッケージを分ける利点がない。

**トレードオフ:** 公開側のコードが管理画面の依存を誤って読み込まないよう、`src/admin/` と `src/api/` を公開側から import しない決まりを Biome のルール（`noRestrictedImports`）で守る。

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
| 公開側で一致しないパス、`$lang` が `ja`・`en` 以外、中身が見つからない | `$lang/route.tsx` と `__root.tsx` の `notFoundComponent` | C1（HTTP 404） |
| 公開側で中身の取得に失敗 | `$lang/route.tsx` の `errorComponent` | C2（HTTP 500） |
| `/admin/login` | `admin/login.tsx` | A1 |
| `/admin` | `admin/_authed/index.tsx` | A2 |
| `/admin/profile` | `admin/_authed/profile.tsx` | A3 |
| `/admin/careers`、`/admin/careers/{id}` | `admin/_authed/careers.index.tsx`、`careers.$id.tsx` | A4（一覧、編集） |
| `/admin/projects`、`/admin/projects/{id}` | `admin/_authed/projects.index.tsx`、`projects.$id.tsx` | A6 |
| `/admin/works`、`/admin/works/{id}` | `admin/_authed/works.index.tsx`、`works.$id.tsx` | A5 |
| `/admin/stacks`、`/admin/stacks/{id}` | `admin/_authed/stacks.index.tsx`、`stacks.$id.tsx` | A7 |
| `/admin/blog`、`/admin/blog/{id}` | `admin/_authed/blog.index.tsx`、`blog.$id.tsx` | A8 |
| `/admin/coding`、`/admin/coding/{id}` | `admin/_authed/coding.index.tsx`、`coding.$id.tsx` | A9 |
| 管理画面で一致しないパス | `admin/_authed/route.tsx` の `notFoundComponent` | 画面なし。design-spec 6.6 の「存在しない管理画面の URL」の扱い |

- 編集ビューの `{id}` が `new` のときは新規作成（design-spec 3.3・6.7.1）。
- `admin/_authed/route.tsx` は `ssr: false` のレイアウトで、`beforeLoad` でセッションを確かめ、なければ `/admin/login?redirect={開こうとしたパス}` へ移す。A1 はこのレイアウトの外に置く（`ssr: false`）。
- トップのセクションの ID（ヘッダーのメニュー・戻るリンクのハッシュ）: `profile`、`career`、`projects`、`works`、`stack`、`blog`、`coding`。
- セクション内ページングのページ番号は URL に載せない（design-spec 6.1.3）。詳細ページの戻るリンクは `/{lang}#{セクションID}` へ移り、どの項目を含むページを開くかを history state（`{ section, itemId }`）で渡す。ブラウザの「戻る」では、離れたときのページ番号を history state から戻す。
- 言語の切り替えは、同じルートのパラメーター `lang` だけを変えて移る。トップでは、表示中のセクションの ID を history state で渡し、移ったあとにそのセクションまでスクロールする。

### 4.2 画面以外のエンドポイント

| パス | 処理 | 説明 |
|---|---|---|
| `/api/auth/*` | Elysia → Better Auth | ログイン・コールバック・ログアウト・セッション取得（5.2） |
| `/api/admin/*` | Elysia → oRPC `OpenAPIHandler` | CMS API（5.3〜5.9） |
| `/media/*` | Elysia → R2 | 画像の配信（5.10） |
| TanStack Start のサーバー関数 | TanStack Start | 公開側の読み取り（5.11）。URL は TanStack Start が決める（`/_serverFn/...`） |
| `/robots.txt`、`/og/*`、`/favicon.svg` | 静的アセット（`public/`） | |

---

## 5. API設計

### 5.0 共通の決まり

- CMS API のベースパスは `/api/admin`。コントラクトは `src/api/contract/`、実装は `src/api/router/`。
- リクエスト・レスポンスの本文は JSON（アップロードだけ `multipart/form-data`）。文字コードは UTF-8。
- ID は UUID の文字列。日時は ISO 8601 の文字列（UTC。例: `"2026-09-30T03:12:45.000Z"`）。年月は `"YYYY-MM"` の文字列（例: `"2024-04"`）。
- 日英を持つ項目は `ja` と `en` のオブジェクトに分ける。文字列は前後の空白を取り除き、空文字は `null` として保存する。
- 状態は `"draft"` ／ `"published"`。作成（POST）と更新（PUT）の本文の `status` に「保存後にしたい状態」を入れ、サーバーが今の状態との組み合わせで、design-spec 6.7.1 のボタンの意味（下書き保存・公開する・更新する・非公開に戻す）を決める（5.3）。
- 一覧はページングしない（design-spec 6.6）。並び順は design-spec 6.6 の表のとおりにサーバーで並べて返す。
- 文字数などの技術的な上限（超えたら `INPUT_VALIDATION_FAILED`）: タイトル・名前・所属・場所・肩書き・表示名 200字、概要 500字、Markdown の本文 100,000字、URL 2,048字、スラッグ・識別名 100字。
- URL の項目（外部リンク・GitHub・参考リンク・SNS リンク・使用技術のリンク）は `https://` で始まること（design-spec 6.7.3）。画像の URL の項目は `/media/` で始まること。
- すべてのレスポンスに `x-request-id`（`cf-ray` の値）を付ける。
- 管理画面のクライアントは、oRPC の CSRF 対策プラグインが付けるヘッダー（`x-csrf-token: orpc`）を必ず送る（7章）。

### 5.1 ミドルウェアと認可

`/api/admin/*` のすべての手続きは、次の順のミドルウェアを通る（`src/api/middleware/`）。

| 順 | ミドルウェア | 失敗したとき |
|---|---|---|
| 1 | リクエストID: `cf-ray`（ローカルでは UUID）をコンテキストとレスポンスヘッダーに入れる | — |
| 2 | レート制限: `ADMIN_RATE_LIMITER` をセッションのユーザーID（なければ IP）で数える | `TOO_MANY_REQUESTS`（429） |
| 3 | CSRF: `SimpleCsrfProtectionHandlerPlugin` がヘッダーを確かめる | `CSRF_TOKEN_MISMATCH`（403） |
| 4 | 認証: Better Auth の `getSession` でセッションを読む | セッションがない・切れている → `UNAUTHORIZED`（401） |
| 5 | 認可: `session.user.githubUserId === env.ADMIN_GITHUB_USER_ID` | 一致しない → `FORBIDDEN`（403） |

例外は `GET /api/admin/openapi.json`（同じく 1〜5 を通す）だけで、認証なしで呼べる手続きはない。

### 5.2 認証（Better Auth。`/api/auth`）

Better Auth の標準のエンドポイントを使う。管理画面は `better-auth/react` のクライアント（`src/auth/client.ts`）から呼ぶ。

| メソッド・パス | 用途 | リクエスト | レスポンス |
|---|---|---|---|
| `POST /api/auth/sign-in/social` | A1 の「GitHubでログイン」 | `{ "provider": "github", "callbackURL": "/admin/works/0f8c…", "errorCallbackURL": "/admin/login" }`（`callbackURL` は `redirect` クエリの値。なければ `/admin`） | `200 { "url": "https://github.com/login/oauth/authorize?...", "redirect": true }` → クライアントが `url` へ移る |
| `GET /api/auth/callback/github` | GitHub からの戻り | `?code=...&state=...` | 成功: `302` で `callbackURL` へ（セッションの Cookie を付ける）。失敗: `302` で `errorCallbackURL?error={コード}` へ |
| `GET /api/auth/get-session` | セッションの確認（A2〜A9 の表示前、サイドメニューの GitHub ユーザー名） | Cookie | `200 { "session": { "id", "expiresAt", … }, "user": { "id", "name", "email", "image", "githubUserId": "1234567", "githubLogin": "octocat" } }`。ないときは `200 null` |
| `POST /api/auth/sign-out` | ログアウト | Cookie | `200 { "success": true }`。クライアントは `/admin/login?loggedOut=1` へ移る |

A1 での `error` の出し分け（design-spec 6.4）:

| `error` | 表示 |
|---|---|
| `unable_to_create_user`、`unable_to_create_session`（管理者でないアカウントを hooks が拒否） | 「このアカウントでは管理画面に入れません」 |
| `access_denied`（GitHub 側でキャンセル） | 「ログインがキャンセルされました」 |
| それ以外 | 「ログインできませんでした。もう一度お試しください」 |

※ Better Auth が返すコードの値は版によって変わりうるので、Phase 5 で実際の値を確かめてこの表を直す。

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
        githubUserId: { type: 'string', required: true, input: false },
        githubLogin: { type: 'string', required: true, input: false },
      },
    },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    databaseHooks: {
      user: { create: { before: async (user) => (user.githubUserId === env.ADMIN_GITHUB_USER_ID ? { data: user } : false) } },
      session: { create: { before: async (session) => ((await isAdminUser(env, session.userId)) ? { data: session } : false) } },
    },
    advanced: { cookiePrefix: 'eastx', database: { generateId: () => crypto.randomUUID() } },
  })
```

### 5.3 公開状態の遷移（作成・更新に共通）

経歴・作品・プロジェクト・ブログ・コーディング記録の POST・PUT は、今の状態（新規作成は「なし」）と、本文の `status` の組み合わせで次のように動く。

| 今の状態 → `status` | design-spec 6.7.1 のボタン | 入力チェック | 自動で入れる値 |
|---|---|---|---|
| なし ／ draft → `draft` | 下書き保存 | 下書きのルール | — |
| なし ／ draft → `published` | 公開する | 公開のルール | 作品・プロジェクト: `first_published_at` が空なら今の日時。ブログ・コーディング記録: `published_at` が空なら今の日時 |
| published → `published` | 更新する | 公開のルール | ブログ・コーディング記録: タイトルか本文（どちらかの言語）が変わっていれば `content_updated_at` を今の日時 |
| published → `draft` | 非公開に戻す | 下書きのルール | — （`first_published_at`・`published_at` は消さない） |

- 下書きのルール・公開のルールの中身は design-spec 6.7.3。判定は `src/domain/publishing.ts` の関数で行い、足りない項目は `PUBLISH_REQUIREMENTS_NOT_MET`、形式の誤りは `INPUT_VALIDATION_FAILED` で返す。
- スラッグの自動生成と追従（design-spec 6.7.2）は管理画面が `GET /slugs/suggest` を使って行う。サーバーは保存のときに形式と重複だけを確かめる（重複は `SLUG_CONFLICT`）。
- ブログ・コーディング記録の `publishedAt` は本文で受け取る。未来の日時は不可、一度公開したもの（今の `published_at` が入っている）は `null` にできない（design-spec 6.7.3）。

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
  }
}
```

- `type` は `"career"` ／ `"project"` ／ `"work"` ／ `"blog-post"` ／ `"coding-log"`。
- `items` は全種類の下書きを `updatedAt` の新しい順に最大10件。`total` は下書きの総数（11件以上のときの添え書きに使う）。

### 5.5 プロフィール（A3）

#### `GET /api/admin/profile`

```json
// 200
{
  "id": "6b1f…",
  "ja": { "name": "東 太郎", "headline": "フロントエンドエンジニア", "bio": "## こんにちは\n…" },
  "en": { "name": "Taro Higashi", "headline": "Frontend Engineer", "bio": "## Hi\n…" },
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

- `languages` は「言語あり」の判定（design-spec 1.4。プロフィールは名前）。言語タブの印に使う。
- プロフィールがまだない（シード前）ときは `NOT_FOUND`。

#### `PUT /api/admin/profile`

```json
// リクエスト
{
  "ja": { "name": "東 太郎", "headline": "フロントエンドエンジニア", "bio": "…" },
  "en": { "name": "Taro Higashi", "headline": null, "bio": null },
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
- 新規作成の表示順は先頭（今の最小の `sortOrder` − 1）。
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

- `sortOrder` を 0 から振り直す。`ids` が今の作品の集合と一致しないとき（別のタブで追加・削除されたなど）は `ORDER_OUT_OF_DATE`（409）を返し、管理画面は一覧を読み直して design-spec 6.6 の「並べ替えの保存に失敗」を出す。

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
      "showOnTop": true,
      "sortOrder": 0,
      "usageCount": 5
    }
  ]
}
```

`usageCount` は、この技術を使っている作品とプロジェクトの数の合計（一覧の列と削除の確認ダイアログに使う）。並び順は `sortOrder`。A5・A6 の「+ 追加」の候補もこの一覧を使う。

#### `GET /api/admin/stacks/{id}`

一覧の1件と同じ形に `createdAt`・`updatedAt` を加えたもの。

#### `POST /api/admin/stacks`（201）

```json
// リクエスト（A7 の新規作成）
{ "key": "react", "displayName": "React", "iconUrl": null, "linkUrl": "https://react.dev", "showOnTop": true }
// リクエスト（A5・A6 の「新しい技術として追加」。表示名だけ）
{ "displayName": "Hono" }
// 201: GET /stacks/{id} と同じ形
```

- `key` を省くと、表示名からスラッグと同じ規則で作る（重複は `-2`、`-3` …。変換して空なら `stack`）。
- `showOnTop` を省くと `true`。表示順は末尾。
- エラー: `INPUT_VALIDATION_FAILED`、`STACK_KEY_CONFLICT`（`key` を指定して重複したとき）。

#### `PUT /api/admin/stacks/{id}`（200）

本文は POST と同じで、`key`・`displayName`・`showOnTop` は必須。

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
- エラー: `INPUT_VALIDATION_FAILED`（`fieldErrors.file` に「画像ファイルではありません」「5MBを超えています」）。

#### `GET /media/{key}`（認証なし）

- R2 から読んで返す。ないときは `404`。
- ヘッダー: `Content-Type`（保存時の形式）、`Cache-Control: public, max-age=31536000, immutable`、`ETag`、`X-Content-Type-Options: nosniff`。`If-None-Match` が一致すれば `304`。
- SVG には `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` を付ける（直接開かれてもスクリプトを動かさない）。

#### `GET /api/admin/openapi.json`

oRPC の `OpenAPIGenerator` で作った OpenAPI 3.1 の仕様（管理者だけ）。

### 5.11 公開側のサーバー関数（`src/content/`）

公開側のローダーが呼ぶ、読み取り専用のサーバー関数。**公開中（`status = 'published'`）の中身だけを返す。** 言語の代替（design-spec 1.4）はここで行い、表示用の形で返す。

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

```ts
type TopPageView = {
  lang: Lang
  meta: PageMeta
  profile: null | {
    name: LocalizedText | null
    headline: LocalizedText | null
    bio: LocalizedHtml | null
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
  stacks: StackChip[]                       // show_on_top のものだけ、表示順
  blogPosts: {
    id: string; slug: string; publishedAt: string; title: LocalizedText; excerpt: LocalizedText | null
    thumbnailUrl: string | null; availability: Availability
  }[]
  codingLogs: {
    id: string; slug: string; kind: CodingLogKind; publishedAt: string; title: LocalizedText
    excerpt: LocalizedText | null; thumbnailUrl: string | null; availability: Availability
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
```

- 各配列は design-spec 6.1.3 の並び順で返す。0件の配列はそのまま返し、セクションを出すかどうかは画面が決める。
- `getTopPage` は1回の `db.batch()` で全セクションを読む。抜粋のために本文は先頭 2,000 字だけを読む（`substr`）。
- 詳細ページの `body` が両方の言語で空のブログ・コーディング記録は、公開のルールで起こらない。

---

## 6. データモデル

<!-- データモデルの正はこのドキュメント（Phase 3でdesign-specの論理設計から章ごと引き継ぎ、design-spec側の章は削除される）。
スキーマ変更時はここを更新する。ER図に加え、選定したORMのスキーマコードで書く。 -->

### 6.1 共通の約束

- すべてのテーブルに `id`（UUID の文字列、主キー）、`created_at`、`updated_at` を持たせる。例外は中間テーブル（`work_stack`・`project_stack`）で、これらは持たない。Better Auth のテーブル（`admin_*`・`auth_verification`）は Better Auth が値を入れる。
- 日英を持つテキストは `_ja` と `_en` の2つのカラムに分ける。どちらも空を許す（空文字は保存せず `NULL` にする）。「言語あり」の判定（design-spec 1.4）は各テーブルの注記のとおりで、`src/domain/languages.ts` に実装する。
- 公開状態 `status` は `draft`（下書き）か `published`（公開）。公開側には `published` だけを出す。
- 「公開時に必須」の項目は、下書きでは空を許し、`status` を `published` にするときに必須とする（design-spec 6.7.3）。DB にも CHECK 制約で入れる。
- 表示順 `sort_order` は小さいほど先。新規作成時は、作品・プロジェクトは先頭（最小値 − 1）、使用技術・SNS リンクは末尾（最大値 ＋ 1）。並べ替えると 0 から振り直す。
- 画像は R2 のファイルのルート相対パス（`/media/...`）を持つ。本文中の画像は Markdown の中に同じ形で入る。
- Markdown のカラムは、Markdown 記法のテキストをそのまま持つ。
- SQLite（D1）の型への対応: UUID → `text`、enum → `text` ＋ CHECK 制約、真偽値 → `integer`（0/1）、日時 → `integer`（UNIX ミリ秒）、年月 → `text`（`YYYY-MM`）。年月は日を持たないので、論理設計の「日は1日に揃える」は不要になった。
- 外部キーは D1 で有効（`ON DELETE CASCADE` が効く）。

### 6.2 ER図

```
profile (1件) ··· social_link (N)         ※ profile は1件だけなので、social_link は外部キーを持たない

career (N)

work (N) ──< work_stack >── (N) stack (N) ──< project_stack >── (N) project

blog_post (N)
coding_log (N)

admin_user (1件) ──< admin_session (N)
           └──────< admin_account (N)     ※ GitHub の1件だけ
auth_verification (N)                     ※ OAuth の state などの一時データ。どこにも紐づかない
```

### 6.3 テーブルごとの注記

| テーブル | 内容 | 言語ありの判定 | 注記 |
|---|---|---|---|
| `profile` | プロフィール。1件だけ | その言語の `name` | シードで必ず1件作る。`singleton` カラム（常に1、一意）で2件目を防ぐ。名前は日英のどちらかが必須 |
| `social_link` | SNS リンク | — | `service` はアイコンの出し分けに使う。`other` のときは `label` 必須 |
| `career` | 経歴（職歴と学歴） | その言語の `title` | `kind` で職歴・学歴を分ける（初期値 `work`）。`end_date` が空なら「現在」 |
| `work` | 作品 | その言語の `title` | `body_ja` か `body_en` があれば詳細ページを持つ。`first_published_at` は初めて公開した日時で、非公開に戻しても消さない（スラッグの自動追従と警告の判定に使う） |
| `project` | プロジェクト | その言語の `title` | 作品との違いは、GitHub を持たず期間を持つこと（今の DB に合わせた）。詳細ページの有無・`first_published_at` は作品と同じ |
| `stack` | 使用技術 | — | `key` は識別名（例: `nextjs`）、`display_name` は日英共通の表示名。`show_on_top` の初期値は true |
| `work_stack` ／ `project_stack` | 作品・プロジェクトと使用技術の紐づけ | — | 主キーは2つの外部キーの組。`sort_order` が作品・プロジェクトの中での技術の表示順（カードに出す最大6個もこの順） |
| `blog_post` | ブログ記事 | その言語の `title` と `body` の両方 | `published_at` は初めて公開したときに入れ、非公開に戻しても消さず、再公開しても変えない。公開後は管理画面で変えられる。`content_updated_at` は公開中に「更新する」でタイトルか本文が変わったときに入れる。抜粋はカラムを持たず本文から作る |
| `coding_log` | コーディング記録 | ブログ記事と同じ | `kind` は `learning_log`（初期値）・`snippet`・`problem`・`memo`。日時の扱いはブログ記事と同じ |
| `admin_user` | 管理者（Better Auth の user） | — | `github_user_id`（GitHub の数値 ID）で管理者かを判定する。`github_login` はサイドメニューに出す。初回ログインで作られる（ADR-009）。`name`・`email`・`image` は Better Auth が GitHub から入れる |
| `admin_session` | ログインのセッション | — | Cookie のトークンに対応する。有効期限30日 |
| `admin_account` | GitHub のアカウントとの紐づけ | — | `provider_id = 'github'`、`account_id` は GitHub の数値 ID |
| `auth_verification` | OAuth の一時データ | — | Better Auth が使う |

### 6.4 Drizzle のスキーマ（`src/db/schema.ts`）

```ts
import { relations, sql } from 'drizzle-orm'
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

// ---- 値の定義 ----------------------------------------------------------
export const STATUSES = ['draft', 'published'] as const
export const SOCIAL_SERVICES = ['github', 'linkedin', 'instagram', 'x', 'zenn', 'qiita', 'other'] as const
export const CAREER_KINDS = ['work', 'education'] as const
export const CODING_LOG_KINDS = ['learning_log', 'snippet', 'problem', 'memo'] as const

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
  sql`${col} is null or ${col} glob '[0-9][0-9][0-9][0-9]-[01][0-9]'`
const httpsOrNull = (col: unknown) => sql`${col} is null or ${col} like 'https://%'`
const mediaOrNull = (col: unknown) => sql`${col} is null or ${col} like '/media/%'`

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
    check('social_link_url', sql`${t.url} like 'https://%'`),
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
    // 前後関係の正は画面の入力チェック（design-spec 6.7.3）。DB は逆転だけを防ぐ
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
    /** 初めて公開した日時。非公開に戻しても消さない */
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
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
    /** 初めて公開したときに入れる。非公開に戻しても消さず、再公開しても変えない */
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** 公開中に「更新する」でタイトルか本文が変わったときに入れる */
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
| Profile | `profile` ＋ `social_link` | 名前・自己紹介を `_ja`／`_en` に揃える。肩書きを追加。SNS（Instagram・LinkedIn・GitHub）を `social_link` に分ける |
| Experience ＋ Education | `career` | 1つにまとめて `kind` で分ける。タイトル以外（所属・場所）も日英に分ける。公開状態を追加 |
| Work | `work` | 概要と詳細本文を分ける。サムネイル・表示順・公開状態・初めて公開した日時・スラッグを追加 |
| Project | `project` | Work と同じ |
| Stack | `stack` | `name` → `key`、`stackImage` → `icon_url`。表示順とトップに表示するかを追加 |
| （Work・Project と Stack の暗黙の中間テーブル） | `work_stack` ＋ `project_stack` | 技術の表示順を追加 |
| Coding（中身なし） | `coding_log` | 新しく作る |
| なし | `blog_post` | 新しく作る |
| なし | `admin_user` ほか Better Auth のテーブル | 新しく作る（GitHub ログイン用） |

移行の手順と方針（今の説明を `summary` に入れる、最初は下書きで入れる、など）は design-spec 9章。変換スクリプトは `scripts/migrate-legacy/` に置き、D1 に流す SQL を生成する。画像は R2 の `uploads/legacy/` に置き直し、パスを書き換える。

---

## 7. セキュリティ・パフォーマンス

### セキュリティ

#### 認可（権限マトリクス）

ロールは design-spec 2.1 の「訪問者」と「管理者」。管理者は `ADMIN_GITHUB_USER_ID` と一致する GitHub アカウントのセッションを持つ人。管理者でないセッションは、Better Auth の hooks で作られないので通常は存在しないが、`ADMIN_GITHUB_USER_ID` を別のアカウントに変えた場合などに残りうるので、列として持つ。

| リソース / 操作 | 管理者 | 管理者でないセッション | 未認証（訪問者） |
|----------------|----------|----------|--------|
| 公開側の画面（P1〜P5・C1・C2）の閲覧、公開側のサーバー関数（5.11） | ✓ | ✓ | ✓ |
| 下書きの中身の、公開側での閲覧 | ✕（404） | ✕（404） | ✕（404） |
| `GET /media/*`（画像） | ✓ | ✓ | ✓ |
| A1 ログイン画面 | ✓（A2 へ移す） | ✓ | ✓ |
| A2〜A9 の表示 | ✓ | ✕（A1 へ。「このアカウントでは管理画面に入れません」） | ✕（A1 へ） |
| `/api/auth/*`（ログイン開始・コールバック・セッション取得・ログアウト） | ✓ | ✓ | ✓（`admin_user` が作られるのは `ADMIN_GITHUB_USER_ID` の人だけ） |
| `GET /api/admin/*`（ダッシュボード・一覧・詳細・スラッグ・OpenAPI） | ✓ | ✕（403） | ✕（401） |
| `POST`・`PUT`・`DELETE /api/admin/*`（作成・更新・公開・非公開・削除・並べ替え） | ✓ | ✕（403） | ✕（401） |
| `POST /api/admin/uploads` | ✓ | ✕（403） | ✕（401） |

- 認可は 5.1 のミドルウェアで、`/api/admin/*` の全手続きに一律にかける。手続きごとに付け外ししない。
- 公開側のサーバー関数は、`status = 'published'` の条件を `src/content/` の中の共通のクエリ部品に入れ、個別のクエリで書き忘れないようにする。
- 管理画面のルートガード（`beforeLoad`）は表示のためのもので、守りの正は API 側。

#### その他の設計判断

| 項目 | 決定 |
|---|---|
| 入力バリデーション | API の境界（oRPC のコントラクトの Zod）で必ず行う。管理画面のフォームは同じスキーマで補助的に行う。公開・下書きのルールは `src/domain/` の関数。最後の守りとして DB の CHECK 制約（6.4） |
| Markdown の XSS | 生の HTML は通さず、rehype-sanitize（GitHub のスキーマ）で `javascript:` などの URL も除く（ADR-012） |
| 画像 | 形式を宣言と先頭のバイトの両方で確かめる。SVG は `sandbox` の CSP 付きで配信する（5.10） |
| シークレット | ローカルは `.dev.vars`（`.gitignore` 済み。見本は `.dev.vars.example`）。staging・本番は `wrangler secret put`。CI のデプロイ用トークンは GitHub Actions の Secrets。リポジトリには入れない。一覧は `docs/03_dev-setup.md` 3章 |
| CSRF | Better Auth は `trustedOrigins`（`SITE_URL`）で Origin を確かめる。CMS API は、Cookie を `SameSite=Lax` にしたうえで、oRPC の `SimpleCsrfProtection` プラグイン（カスタムヘッダーがないリクエストを拒否）を使う |
| CORS | 開けない（同じ origin からだけ使う）。`Access-Control-Allow-Origin` を返さない |
| レート制限 | `/api/auth/*`: IP ごとに 60秒 10回（`AUTH_RATE_LIMITER`）。`/api/admin/*`: ユーザーごとに 60秒 300回（`ADMIN_RATE_LIMITER`）。公開側は Cloudflare 標準の DDoS 対策に任せ、独自の制限はかけない |
| Cookie | セッション: `__Secure-eastx.session_token`（HttpOnly・Secure・SameSite=Lax・Path=/）。表示設定: `eastx-lang`（`ja`／`en`）と `eastx-theme`（`system`／`light`／`dark`）。どちらも1年、HttpOnly ではない（クライアントで書く） |
| セキュリティヘッダー | Worker が HTML と API のレスポンスに付ける: `Strict-Transport-Security: max-age=31536000; includeSubDomains`、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://*.ingest.sentry.io; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`。`script-src` の `'unsafe-inline'` はテーマの初期化と SSR のデータ受け渡しのため。訪問者が中身を書き込む経路がないので許容し、nonce 方式は今後の改善とする |
| 個人情報 | 訪問者の個人情報は集めない（フォーム・アカウント・アクセス解析なし）。管理者については GitHub の数値 ID・ユーザー名・名前・メール・アバター URL（`admin_user`）、セッションの IP と User-Agent（`admin_session`。30日で失効）、GitHub のアクセストークン（`admin_account`。`read:user`・`user:email` だけ）を持つ。画面には GitHub のユーザー名だけを出す。暗号化はしない（D1 の保存時の暗号化に任せる） |
| 検索エンジン | 管理画面・API・staging は noindex（ADR-019） |

### パフォーマンス

| 目標 | 値 |
|---|---|
| P1 の TTFB（日本から、p75） | 500ms 以下 |
| P1〜P5 の LCP（モバイル、p75） | 2.5秒以下 |
| CMS API の応答（p95） | 300ms 以下（アップロードを除く） |

守るための設計:

- D1 の場所のヒントを `apac` にする（訪問者と管理者の多くが日本から）。
- `getTopPage` は全セクションのクエリを1回の `db.batch()` で送る。必要なカラムだけを選び、抜粋のための本文は先頭 2,000 字だけを読む。
- インデックス: 一覧の絞り込みと並び（`status` ＋ `sort_order` ／ `start_date` ／ `published_at`）、スラッグの一意、中間テーブルの `stack_id`（6.4）。
- Markdown の描画結果を Cache API に置く（ADR-011）。Shiki は使う言語だけを読み込む（ADR-012）。
- 画像は長期キャッシュ（ADR-010）。サムネイルには `width`・`height` か `aspect-ratio` を指定してレイアウトのずれを防ぎ、ファーストビューの外は `loading="lazy"`。
- フォントは Inter と JetBrains Mono の可変フォントだけを自前で配信し（`@fontsource-variable`）、和文は OS のゴシック体を使う（`docs/06_design-tokens.json`）。
- 管理画面（`/admin/*`）は別のチャンクにし、CodeMirror・dnd-kit・Shiki は公開側のバンドルに入れない。
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
| `INPUT_VALIDATION_FAILED` | 422 | `{ "fieldErrors": { "ja.title": ["…"], "linkUrl": ["https:// で始めてください"] }, "formErrors": ["…"] }` | 形式の誤り・上限超え・存在しない ID（Zod のエラーを、インターセプターでこの形に変える） |
| `PUBLISH_REQUIREMENTS_NOT_MET` | 422 | `{ "missing": [{ "field": "slug" }, { "field": "title", "lang": "en" }] }` | 公開・更新するのに足りない項目（design-spec 6.7.3） |
| `SLUG_CONFLICT` | 409 | `{ "suggestion": "my-app-2" }` | 同じ種類の中でスラッグが重複 |
| `STACK_KEY_CONFLICT` | 409 | `{ "suggestion": "react-2" }` | 使用技術の識別名が重複 |
| `ORDER_OUT_OF_DATE` | 409 | — | 並べ替えの ID の集合が今のものと違う |
| `NOT_FOUND` | 404 | — | ID が存在しない |
| `UNAUTHORIZED` | 401 | — | セッションがない・切れている |
| `FORBIDDEN` | 403 | — | 管理者でないセッション |
| `CSRF_TOKEN_MISMATCH` | 403 | — | CSRF 対策のヘッダーがない |
| `TOO_MANY_REQUESTS` | 429 | — | レート制限 |
| `INTERNAL_SERVER_ERROR` | 500 | `{ "requestId": "8c1f2a…-NRT" }` | 想定外のエラー。`message` は一般的な文言にし、中身は出さない |

`message` は日本語（管理画面だけが使うため）。

公開側のサーバー関数は、見つからなければ `notFound()`（C1、HTTP 404）、それ以外の失敗は例外のまま投げ、ルートの `errorComponent`（C2、HTTP 500）で受ける。

### フロントエンドでの表示方針

文言と出し方の正は design-spec（公開側は 6.1.5・6.2.3・6.3、管理側は 6.4〜6.7.4）。ここではエラーの種類との対応だけを決める。

| エラー種別 | 表示方法 |
|-----------|----------|
| バリデーションエラー | `INPUT_VALIDATION_FAILED` → `fieldErrors` のキーに対応する入力欄の下に赤字で出す。`PUBLISH_REQUIREMENTS_NOT_MET` → 足りない項目を一覧で出し、該当する言語タブと入力欄に印を付ける。`SLUG_CONFLICT` → スラッグ欄の下に出し、`suggestion` を候補として示す |
| 通信・サーバーエラー | 管理画面: 保存・削除・並べ替えの失敗はトーストで出し、入力は消さない。一覧・編集ビューの取得失敗は画面内に「読み込めませんでした」と「再試行」。公開側: C2 |
| 認可エラー | `UNAUTHORIZED` → 編集中ならフォームの内容を localStorage（`eastx:backup:{種類}:{id か new}`）に一時保存して通知し、`/admin/login?redirect={今のパス}` へ移す（design-spec 6.4）。`FORBIDDEN` → ログアウトして A1 で「このアカウントでは管理画面に入れません」 |
| 想定外のエラー | Sentry に送り、管理画面は「保存できませんでした。もう一度お試しください」など design-spec の一般的な文言、公開側は C2。開発中（`ENVIRONMENT=local`）だけ詳細を出す |

### ログとの対応

- リクエストID は Cloudflare の `cf-ray`（ローカルでは UUID）。Worker の入口で決め、`x-request-id` のレスポンスヘッダー、`INTERNAL_SERVER_ERROR` の `data.requestId`、すべてのログ行、Sentry のタグ（`request_id`）に入れる。
- ログは JSON の1行（`{ "level": "error", "msg": "...", "requestId": "...", "route": "PUT /api/admin/works/{id}", "code": "SLUG_CONFLICT" }`）で `console.log` ／ `console.error` に出し、Workers Logs で検索する（11章）。
- 定義済みのエラー（4xx）は `warn`、想定外のエラー（5xx）は `error` で出し、5xx だけ Sentry に送る。

---

## 9. i18n（国際化）

要否: **必要**（公開側は日本語と英語。管理画面は日本語のみ）。仕様（URL・振り分け・代替表示・言語ラベル・日付の表記・タイムゾーン）は design-spec 1.4 が正。ここでは実装の方法を決める。

| 項目 | 実装 |
|---|---|
| ライブラリ | 使わない（ADR-013） |
| メッセージカタログ | `src/i18n/messages/ja.ts`（型の基準）と `en.ts`（`satisfies Messages`）。領域ごとに入れ子にする（例: `section.career`、`label.jaOnly`、`paging.next`、`notice.bodyOnlyIn`）。値に差し込みがあるものは関数にする（例: `notice.bodyOnlyIn: (lang) => ...`）。管理画面の文言は辞書にせず、日本語を直接書く |
| ロケールの判定 | 公開側はルートのパラメーター `lang`（`ja`／`en` 以外は C1）が常に正。ルート `/` だけ、Cookie `eastx-lang` → `Accept-Language` の最優先の言語が `ja` で始まるか → それ以外は `en` の順で振り分けて 302 |
| 言語の記憶 | 言語を切り替えたときに Cookie `eastx-lang` を書く（1年） |
| 代替表示と言語ラベル | `src/domain/languages.ts`（言語ありの判定）と `src/content/localize.ts`（`LocalizedText`・`Availability` を作る）で行う。画面は `lang` 属性を `LocalizedText.lang` から付けるだけ |
| 日付の書式 | `src/i18n/format.ts`。日時は `Intl.DateTimeFormat(locale, { timeZone: 'Asia/Tokyo', ... })` で、ja は `2026年9月12日`、en は `Sep 12, 2026`（`month: 'short'`）。年月（`YYYY-MM`）は時刻を持たないので、タイムゾーンをかけずに整形する。期間の区切りは ` – `、終わりがなければ「現在」／`Present`。管理画面は `2026/09/12`・`2026/09` |
| HTML の宣言 | `<html lang>` は URL の言語。代替した部分に `lang` 属性。`hreflang` の代替ページ（ADR-019） |
| 数値 | 件数・ページ番号（`1 / 3`）だけで、桁区切りは使わない |

---

## 10. テスト戦略

| レイヤー | ツール | カバレッジ目標 | 対象 |
|----------|--------|---------------|------|
| ユニット | Vitest（Node.js 環境） | `src/domain/`・`src/i18n/`・`src/markdown/` の行カバレッジ 90% | スラッグの生成と重複の連番、言語ありの判定と代替、抜粋の作り方、公開状態の遷移（5.3）と公開のルール、日付・期間の書式、Markdown の描画（生の HTML・`javascript:`・見出しのレベル・外部リンク） |
| API 結合 | Vitest ＋ `@cloudflare/vitest-pool-workers`（workerd 上で、ローカルの D1・R2 を使う。テストごとにマイグレーションを適用） | `/api/admin/*` の全手続きについて、未認証で 401・管理者でないセッションで 403 になるテストを必ず持つ（認可マトリクスの照合）。主要な手続きの正常系とエラー系 | CMS API の全手続き、Better Auth の hooks（管理者でない ID を拒否）、アップロードの形式・上限、`/media/*` |
| 公開側の読み取り | 同上 | 各サーバー関数の正常系と、下書き・詳細本文なしが返らないこと | 公開中だけを返す、並び順、前後のナビ、言語の代替 |
| E2E | Playwright（Chromium）＋ ローカルの D1（デモデータのシード） | design-spec のコアフロー（2.2）を1本ずつ | 訪問者: トップ → ページング → 作品詳細 → 戻るで元のページ、言語の切り替え、0件のセクションが消える（空のシード）。管理者: ログイン済みの状態から作品を作成 → 下書き保存 → 公開 → 公開サイトで確認、並べ替え、セッション切れ → 一時保存の復元 |
| アクセシビリティ | Playwright ＋ `@axe-core/playwright` | P1〜P5・A1・A2 で重大（serious 以上）な違反 0件 | 自動で検出できる範囲 |

- E2E のログイン: テスト用のヘルパーが、ローカルの D1 に管理者とセッションを作り、Better Auth と同じ方式で署名した Cookie をブラウザに入れる。本番のコードにテスト用の入口は作らない。
- 実行のコマンドは `make test`（ユニット・結合）と `make e2e`（`docs/03_dev-setup.md`）。CI ではどちらも PR ごとに走る。

---

## 11. モニタリング・ログ

運用の手順（アラートの閾値・ログの見方・障害対応）は `docs/05_operation-runbook.md` が持つ。ここでは道具と設定を決める。

| 項目 | ツール | 設定 |
|------|--------|------|
| リクエストのログ | Workers Logs | `wrangler.jsonc` の `observability.enabled: true`、`head_sampling_rate: 1`（全件）。アプリのログは JSON の1行（8章） |
| エラー追跡（サーバー） | Sentry（`@sentry/cloudflare`） | `src/server.ts` を `withSentry` で包む。`environment` は `ENVIRONMENT`、`tracesSampleRate` は本番 0.1・staging 1.0。5xx と想定外の例外だけ送る |
| エラー追跡（ブラウザ） | Sentry（`@sentry/react`） | DSN はルートのローダーがサーバーの `SENTRY_DSN` から渡す（ビルド時の環境変数にしない）。React のエラー境界で受けたものを送る |
| 稼働監視 | Sentry Uptime Monitoring | 本番の `https://x.eastasian.dev/ja` を5分ごと |
| メトリクス | Cloudflare ダッシュボード（Workers・D1・R2） | リクエスト数・エラー率・CPU 時間・D1 の読み書き行数を見る |
| リアルタイムのログ | `wrangler tail` | 障害調査のときに使う |
