# eastx — Claude Code プロンプト集

Claude Code のチャットに **1つずつ** コピペして使う。
前のステップが完了・動作確認できてから次を投げること。
このファイルは派生物。docs/ のソース層から再生成でき、docs/ と食い違ったら docs/ が正。

**チャット分割の目安:**
- Step 1〜2 → Chat 1（骨格とスキーマは依存が近い）
- Step 3 → Chat 2
- Step 4 → Chat 3
- Step 5 → Chat 4
- Step 6 → Chat 5
- Step 7 → Chat 6
- Step 8 → Chat 7
- Step 9〜10 → Chat 8
- Step 11 → Chat 9

UI の実装は重いので、共通の部品（Step 5）、コア画面（Step 6）、残りの画面（Step 7・8）を別のチャットに分ける。
ADR-022 のスパイク（新しいライブラリの動作確認）は、各ライブラリを最初に入れるステップの冒頭で行う。駄目だったら ADR の「代わり」に切り替え、その ADR を直してから先に進む。

---

各Stepの見出し直下の `Status:` 行が進捗の記録先。値は次の3つで、無人ループの停止判定にも使われる:

- 空欄: 未着手
- `done YYYY-MM-DD`: 動作確認まで完了
- `blocked YYYY-MM-DD`: 着手したが、人の判断なしには閉じられない。直後の1行に閉じられない理由を具体的に書く

/draft:prep を再実行して作り直すときは、この行（とブロッカーの理由行）と追記されたステップを新版へ移送する。

## Step 1: 骨格と開発環境（スパイク: UI・入口・スタイル）

Status: done 2026-10-03

```
docs/03_dev-setup.md のリポジトリ構成に従って、単一パッケージの骨格と開発環境を作ってください。
あわせて docs/02-01_system-design-doc.md（以下 SDD）ADR-022 のスパイクのうち、
このステップで入れるライブラリの項目（ADR-002・003・004・014・020）を確かめてください。

先に読む: SDD 2章・3章（ADR-001〜004・014・016・020・022）・4章、docs/03_dev-setup.md 2・3・5・8・10章

やること:
1. `.git` が無ければ `git init`。.gitignore（03 2章の「Git に入れないもの」）と .editorconfig
2. package.json（Bun。依存は正確な版で固定する。ADR-022）と tsconfig.json（03 10章）
3. TanStack Start を Cloudflare の Vite プラグインで Workers に載せる（vite.config.ts。ポート 3000）
4. wrangler.jsonc のトップレベル（ローカル用。03 5章。env.staging・env.production は Step 9 で足す）と、
   .dev.vars.example（03 3.2 の全変数）
5. src/server.ts: /api/*・/media/* を Elysia へ、それ以外を TanStack Start へ振り分ける（ADR-001・004）
6. src/api/app.ts: Elysia を Cloudflare Worker アダプターで作る。/api/admin/* に oRPC の OpenAPIHandler を
   `parse: 'none'` でつなぐ（コントラクトは Step 3 で書くので、ここでは空のルーター）。
   /media/* は SDD 5.10 と ADR-010 のとおり R2（ローカル）から返す（Cache API・ヘッダー・SVG の CSP まで）
7. ルート: `/`（design-spec 1.4 の振り分けで 302。SDD 9章）、`$lang/route.tsx`（ja・en 以外は 404）、
   `$lang/index.tsx`（サーバー関数で lang を受け取ってサイト名の見出しを出すだけ。中身は Step 6）
8. Panda CSS: panda.config.ts（strictTokens・strictPropertyValues、`_dark` の条件、design-spec 4.3 の
   ブレークポイント）、scripts/tokens/build.ts（docs/06_design-tokens.json → src/styles/tokens.generated.ts。
   ADR-014 の対応表のとおり）、`src/` からプリミティブ層を参照していないかの検査（make lint に入れる）
9. biome.json（03 10章。noRestrictedImports で公開側から src/admin・src/api の import を止める）
10. Vitest（Node のユニットと @cloudflare/vitest-pool-workers の結合の2プロジェクト）と Playwright の設定
11. Makefile: docs/03_dev-setup.md 8章の全ターゲットを、実コマンドへの薄い委譲として定義する。
   以後の操作は全てmake経由で行う。生成物を読むターゲットは最初に「生成」（03 8章）を走らせる。
   doc-lint は scripts/doc-lint.sh --docs を呼び、setup は git config core.hooksPath .githooks を含める
   （scripts/doc-lint.sh と .githooks/pre-commit はPhase 4で配置済み）。
   db-seed・db-seed-empty・db-reset・promote が呼ぶスクリプトは Step 2・9 で作る

スパイク（ADR-022）:
- TanStack Start の SSR とサーバー関数が workerd で動く（make dev と、ビルドしたもののプレビューの両方）
- Elysia のアダプターで /api/admin/openapi.json と /media/* に届く
- 生成したトークンで Panda（strictTokens）がビルドでき、トークン以外の値が型エラーになる
- Biome で公開側から src/admin を import すると lint が落ちる
- ビルドした Worker の大きさを wrangler の dry-run で確かめ、圧縮後 10MB に収まる

まだ画面・API・DB の中身は作らない。
make setup が通り、make dev で http://localhost:3000 が /ja か /en に 302 し、/ja・/en が SSR で表示され、
/xx が 404 になり、make lint・make typecheck・make test・make build・make doc-lint が通る状態をゴールとする。
```

---

## Step 2: D1 スキーマ + シード

Status: done 2026-10-03

```
SDD の「6. データモデル」にあるスキーマを実装し、デモデータを入れられるようにしてください。

先に読む: SDD 6章・ADR-006・007、design-spec 8章（デモデータ仕様）、docs/03_dev-setup.md 4章

やること:
1. src/db/schema.ts（SDD 6.4。CHECK 制約・インデックス・リレーションを含む）、src/db/client.ts、drizzle.config.ts
2. make db-generate で drizzle/migrations/ に SQL を作り、中身を読んでから make db-migrate で当てる
3. scripts/seed/: design-spec 8章の件数とバリエーションどおりのデモデータの SQL と、ダミー画像（ローカルの R2）。
   make db-seed-empty 用の「ブログ・コーディング記録が0件」の版も作る。
   1文のパラメーターは100個まで（ADR-006）なので、複数行の insert は分ける。管理者はシードで作らない（ADR-009）
4. make db-seed・make db-seed-empty・make db-reset の中身を入れ、make setup のシード投入（docs/03 3.1）もつなぐ
5. 結合テスト（workerd ＋ ローカル D1）: CHECK 制約（スラッグの形式・公開時に必須の項目・https）と、
   外部キーの ON DELETE CASCADE が D1 で効くこと

スパイク（ADR-022）: drizzle-kit が出した SQL が D1 にそのまま当たる（ADR-007）。

make db-reset でテーブルの作成とデモデータの投入が通り、make db-studio で design-spec 8章の件数どおりの
データが見え、make test が通る状態をゴールとする。
```

---

## Step 3: CMS API

Status: done 2026-10-03

```
SDD の「5. API設計」に従って、CMS API（/api/admin/*）を実装してください。
認証は本物のセッションの検証で行い、GitHub でのログインの流れは Step 4 で作る。

先に読む: SDD 5.0〜5.10、7章（権限マトリクス・その他の設計判断）、8章、ADR-005・006・008・009・010・021、
design-spec 6.5〜6.7（入力チェックと保存の振る舞い）

やること:
1. src/auth/server.ts: Better Auth のサーバー側の設定のうち、セッションの検証に要る部分
   （Drizzle アダプター・テーブル・セッションの期限・additionalFields。SDD 5.2）
2. 処理の順序（SDD 5.1）: Elysia でリクエストID、oRPC の SimpleCsrfProtectionHandlerPlugin、
   ミドルウェア（認証 → ADMIN_RATE_LIMITER → 認可）。JSON の1行のログとリクエストID（SDD 8章）
3. src/domain/: スラッグの生成と重複の連番、言語ありの判定（design-spec 1.4）、公開状態の遷移と
   下書き・公開のルール（SDD 5.3、design-spec 6.7.3）。ユニットテストを付ける
4. src/api/contract/ と src/api/router/: 次の全手続き（パス・入出力・エラーは SDD 5章のとおり）
   - ダッシュボード: GET /dashboard
   - プロフィール: GET /profile、PUT /profile
   - 経歴: GET /careers、POST /careers、GET・PUT・DELETE /careers/{id}
   - 作品: GET /works、POST /works、GET・PUT・DELETE /works/{id}、POST /works/reorder
   - プロジェクト: GET /projects、POST /projects、GET・PUT・DELETE /projects/{id}、POST /projects/reorder
   - 使用技術: GET /stacks、POST /stacks、GET・PUT・DELETE /stacks/{id}、POST /stacks/reorder
   - ブログ記事: GET /blog-posts、POST /blog-posts、GET・PUT・DELETE /blog-posts/{id}
   - コーディング記録: GET /coding-logs、POST /coding-logs、GET・PUT・DELETE /coding-logs/{id}
   - スラッグ: GET /slugs/suggest、GET /slugs/availability
   - アップロード: POST /uploads（multipart。R2 へ）
   - OpenAPI: GET /openapi.json
5. エラー（SDD 8章の表）: Zod のエラーを INPUT_VALIDATION_FAILED に変えるインターセプター、
   一意インデックスの違反を SLUG_CONFLICT・STACK_KEY_CONFLICT に変える処理、5xx の requestId
6. テスト用のヘルパー: ローカル D1 に管理者とセッションを作り、Better Auth と同じ方式で署名した Cookie を返す
   （SDD 10章。本番のコードにテスト用の入口は作らない）
7. 結合テスト: 全手続きで「CSRF のヘッダー付きの未認証 → 401」「管理者でないセッション → 403」
   「CSRF のヘッダーなし → 403」。主要な手続きの正常系とエラー系、公開状態の遷移と日時のカラム、
   並べ替えで updated_at が変わらないこと、アップロードの形式と上限

スパイク（ADR-022）: oRPC の OpenAPIHandler と OpenAPILink（型付きクライアントでテストから呼ぶ）、
Zod v4 からの openapi.json の生成（ADR-005・008）。

まだ GitHub ログイン・画面は作らない。
make test が通り（全手続きの 401・403 を含む）、openapi.json に SDD 5章の全手続きが載る状態をゴールとする。
```

---

## Step 4: 認証

Status: done 2026-10-03

```
Better Auth で GitHub ログインを実装し、管理画面を守ってください。

先に読む: SDD ADR-009・021、5.1・5.2、4.1、7章（Cookie）、design-spec 6.4、docs/03_dev-setup.md 6章

やること:
1. Better Auth の GitHub プロバイダー（mapProfileToUser・overrideUserInfoOnSignIn）、
   hooks（user.create.before・session.create.before で ADMIN_GITHUB_USER_ID 以外を拒否）、generateId（SDD 5.2）
2. Elysia で /api/auth/* を Better Auth に渡す。sign-in と callback だけを AUTH_RATE_LIMITER で数える（SDD 5.2）
3. src/auth/client.ts（better-auth/react）
4. A1 ログイン（/admin/login）: design-spec 6.4 の全状態（認可中・管理者でないアカウント・キャンセル・
   通信エラー・ログイン済みで開いた・ログアウト後）。redirect クエリで元の画面へ戻す。
   見た目はトークンだけで付ける（L3 の部品への切り出しは Step 5）
5. admin/_authed のレイアウト（ssr: false）: beforeLoad でセッションを確かめ、なければ
   /admin/login?redirect= へ。サイドメニューの下部に GitHub のユーザー名とログアウト
6. 管理画面の API クライアント: UNAUTHORIZED → /admin/login?redirect= へ、FORBIDDEN → ログアウトして A1 に
   管理者でないアカウントの表示（SDD 8章。編集中の一時保存は Step 7 の編集ビューで付ける）
7. 管理画面の存在しない URL は /admin へ移す（通知のトーストは Step 7 で付ける）
8. 結合テスト: hooks が管理者でない GitHub ID を拒否する、AUTH_RATE_LIMITER が get-session を数えない

スパイク（ADR-022）: 実際の GitHub ログインで、管理者の登録・ログイン・管理者でないアカウントの拒否・
キャンセルを試し、A1 に返ってくる `error` の実際の値で SDD 5.2 の表を直す（ADR-009）。

.dev.vars に OAuth のキーを入れれば、ローカルで GitHub ログインから /admin まで進めて、
ログアウトできる状態をゴールとする。キーが未設定でもアプリはクラッシュせず、A1 で通信エラーの表示になること。
キーが無くて実際のログインを試せないときは、Status を blocked にし、理由（ローカル用の OAuth App のキーが要る）を書く。
```

---

## Step 5: 共通UIコンポーネント

Status: done 2026-10-04

```
docs/design-spec.md の「4. デザインシステム」と 6.1.2 に従って、
公開側と管理画面で共通に使う部品とレイアウトを実装してください。

先に読む: design-spec 1.4・4章・6.1.2・6.3.1、SDD ADR-011〜015・9章、docs/06_design-tokens.json

やること:
1. docs/06_design-tokens.json のセマンティック層だけを参照する（値の直書き・プリミティブ直参照は禁止。
   Step 1 の検査で止まる）。textStyles と、ボタン・入力欄・チップ・ラベル・カードのレシピ
2. Ark UI に見た目を付けた部品（src/ui/）: Dialog、Menu、Toast、Tabs、Select、Switch、Combobox、Tooltip
3. レイアウト（design-spec 4.1・4.3）:
   - L1 シングルカラム・ロングページ
   - L2 記事カラム
   - L3 中央カード（Step 4 の A1 をこれに載せ替える）
   - L4 サイドメニュー＋一覧
   - L5 サイドメニュー＋2ペイン編集
   - L6 サイドメニュー＋フォーム
   - 管理画面のサイドメニュー（並びは design-spec 3.3。下部に GitHub のユーザー名・テーマ切り替え・ログアウト）
4. 公開側のヘッダーとフッター（design-spec 6.1.2）: サイト名、セクションメニュー（出すセクションは引数で受ける）、
   JA｜EN の切り替え（Cookie eastx-lang と history state。SDD 4.1・9章）、テーマの切り替え
   （Cookie eastx-theme と <head> のスクリプト。ADR-014）
5. i18n（SDD 9章）: src/i18n/messages/ja.ts・en.ts（design-spec 1.4 の対訳と、各画面の固定文言）、src/i18n/format.ts
6. Markdown の描画（src/markdown/。ADR-012、design-spec 6.3.1）と、描画結果の Cache API（ADR-011。RENDER_VERSION）
7. C1 見つからないページ・C2 エラー（design-spec 3.1。L2 の上。HTTP 404・500）
8. ユニットテスト: Markdown（生の HTML・javascript: の URL・見出しのレベル・外部リンク・コードブロック）と日付の書式

スパイク（ADR-022）: 長くコードの多い記事の Markdown の描画にかかる CPU 時間を測る（ADR-012）。

まだ画面の中身（P1〜P5・A2〜A9）は作らない。
/ja/no-such で C1 がヘッダー・フッター付きで 404 になり、テーマと言語の切り替えが覚えられ、
ログインした /admin で L4 とサイドメニューがデスクトップ・タブレット・モバイルの幅で崩れず、
make test が通る状態をゴールとする。
```

---

## Step 6: コア画面（P1 トップ・P2 作品詳細・P3 プロジェクト詳細）

Status: done 2026-10-04

```
docs/design-spec.md の「6. コア画面詳細仕様」の 6.1・6.2 に従って、
コアフロー「何者かつかみ、作品で確かめる」（design-spec 2.2）の画面を実装してください。

先に読む: design-spec 1.4・6.1・6.2、SDD 4.1・5.11・ADR-011・ADR-019

やること:
1. src/content/: getTopPage・getWorkDetail・getProjectDetail（SDD 5.11）、localize.ts（言語の代替）、
   公開中だけを読む共通のクエリ部品（SDD 7章）、抜粋（design-spec 6.1.4。SDD 5.11 の切り詰め方）
2. P1 トップ: 全セクション（design-spec 6.1.4）と状態（6.1.5）。セクション内ページング（6.1.3。5件ずつ、
   ボタン・スワイプ・キーボード、高さ揃え、読み上げ、視差効果を減らす設定）、経歴の「続きを読む」、
   言語ラベル、0件のセクションとメニューを出さない、画像の代わりの枠
3. P2 作品詳細・P3 プロジェクト詳細（design-spec 6.2）: 戻るリンク（history state で元のページへ。SDD 4.1）、
   前後のナビ、詳細本文の言語の注記、C1 になる条件
4. ページのタイトル・説明・OGP・canonical・hreflang（ADR-019）、/robots.txt（環境ごと）
5. 既定の OGP 画像 public/og/default-{ja,en}.png（1200×630）と favicon。画像はトークンの色で作った
   HTML を Playwright で撮るスクリプト（scripts/og/）で生成してコミットする
6. 結合テスト: 公開中だけを返す、並び順、前後のナビ、詳細ページを持たないものは返さない、言語の代替
7. P1 は L1（src/site/layouts.tsx の SingleColumnLayout）に載せ、各セクションに SDD 4.1 のセクションの ID を付ける。
   言語の切り替えで表示中のセクションへスクロールする処理（src/site/section-scroll.ts。Step 5 で作成済み。
   セクションのある画面がないので Step 5 では確かめられなかった）を、トップで作品のセクションまでスクロールして
   EN に切り替え、/en でも作品のセクションが画面の上端にあることと、そのあと詳細ページから「戻る」で
   離れたときのスクロールの位置に戻ることを E2E で確かめる

make db-seed のデータで make dev を開き、ja と en の両方で「トップ → 作品をページング → 作品詳細 →
戻るで元のページ」が動き、make db-seed-empty でブログ・コーディング記録のセクションとメニューが消え、
make test が通る状態をゴールとする。
```

---

## Step 7: 残りの公開画面と、管理画面の基盤（P4・P5・A2・A3・A4・A7）

Status: done 2026-10-04

```
残りの公開画面と、管理画面の一覧・短いフォームの画面を実装してください。

先に読む: design-spec 6.3・6.4（期限切れの扱い）・6.5・6.6・6.7、SDD 4.1・5.4〜5.6・5.8・8章・ADR-008・015

やること:
1. P4 ブログ記事・P5 コーディング記録詳細（design-spec 6.3）: getBlogPost・getCodingLog（SDD 5.11）、
   更新日の出し方、前後のナビ、SEO（ADR-019）。P1 のブログ・コーディング記録の行（src/site/top-items.tsx の PostRow）は、
   P4・P5 のルートがなかったので URL で移っている。ルートを作ったら型付きの Link に替える
2. 管理画面の共通の仕組み（src/admin/）:
   - oRPC のクライアント（OpenAPILink ＋ CSRF のプラグイン）と TanStack Query
   - 一覧ビュー（design-spec 6.6）: 絞り込み（クエリ。SDD 4.1）、全状態、削除の確認、公開サイトで見る、
     dnd-kit の並べ替え（キーボード対応）
   - L6 の編集ビュー（design-spec 6.7.1・6.7.3・6.7.4）: TanStack Form と Zod、保存ボタンと状態の遷移、
     fieldErrors と PUBLISH_REQUIREMENTS_NOT_MET の表示、言語タブの印、画像欄のアップロード、
     保存していない変更の確認、期限切れのときの一時保存と復元（design-spec 6.4。SDD 8章の localStorage のキー）
   - 通知（トースト）と、存在しない管理画面の URL の通知（design-spec 6.6）
3. A2 ダッシュボード（design-spec 6.5）
4. A3 プロフィール編集（design-spec 6.7.2。SNS リンクの追加・削除・並べ替え、プロフィールがまだないときの空のフォーム）
5. A4 経歴管理（一覧と L6 の編集）
6. A7 使用技術管理（一覧の並べ替えと L6 の編集、使っている数を出す削除の確認）
7. 結合テスト: P4・P5 のサーバー関数

まだ A5・A6・A8・A9（L5 の長文の編集）は作らない。
ローカルでログインし、デモデータに対して A2・A3・A4・A7 の全操作（作成・下書き保存・公開・更新・
非公開に戻す・削除・並べ替え・絞り込み）と期限切れからの復元が動き、P4・P5 が読め、make test が通る状態をゴールとする。
```

---

## Step 8: 管理画面の長文の編集（A5・A6・A8・A9）

Status: done 2026-10-04

```
Markdown を書いて公開する管理画面（L5）を実装してください。

先に読む: design-spec 4.1（L5）・4.3・6.6・6.7、SDD 5.7〜5.10・ADR-012・015

やること:
1. L5 の編集ビュー: CodeMirror 6 の自前の部品（ADR-015）、画像の貼り付け・ドロップでのアップロード
   （design-spec 6.7.1・6.7.4）、src/markdown のプレビュー（Shiki は遅延読み込み）、モバイルでのタブの切り替え
2. A5 作品管理・A6 プロジェクト管理: 一覧（並べ替え・詳細ページの有無）、使用技術の選択
   （Combobox の検索、新しい技術として追加。design-spec 6.7.1・SDD 5.8）とチップの並べ替え、
   スラッグの自動生成と追従・公開済みのスラッグを変えるときの警告（design-spec 6.7.2）、サムネイル
3. A8 ブログ管理・A9 コーディング記録管理: 一覧の並びと絞り込み、公開日の欄（SDD 5.9・design-spec 6.7.3）、
   種類と参考リンク（A9）
4. 期限切れの一時保存と保存していない変更の確認を、Step 7 の仕組みで L5 にもつなぐ

ローカルでログインし、作品・プロジェクト・ブログ・コーディング記録のそれぞれで「書く → 下書き保存 →
プレビューで確認 → 公開 → 公開サイトで確認 → 更新 → 非公開に戻す」が動き、本文への画像の貼り付けが動き、
make test が通る状態をゴールとする。
```

---

## Step 9: CI/CD

Status:

```
docs/04_deployment-procedure.md と docs/03_dev-setup.md に従って、CI/CD を実装してください。
IaC ツールは使わない（ADR-017）。

先に読む: docs/04_deployment-procedure.md 1〜3章・5章、docs/03_dev-setup.md 5章・9章、SDD ADR-017・022

やること:
1. wrangler.jsonc の env.staging・env.production（03 5章）。D1 の ID・OAuth の Client ID などの値は、
   ユーザーが 04 3章 Step 2〜5 で用意するので、03 5章の例と同じ <...> の形で置く
2. .github/workflows/ci.yml（04 2章）: PR と main への push で lint → typecheck → test → build → e2e
3. 昇格の確認（promotion-check）: 判定をスクリプトにし（scripts/promotion-check.sh）、
   deploy/*/version だけを変えた PR で ci.yml から呼ぶ
4. .github/workflows/deploy.yml（04 2章）: 変わった環境ごとに、SHA のチェックアウト → マイグレーション →
   CLOUDFLARE_ENV でビルド → wrangler deploy → 疎通確認。concurrency を付ける
5. scripts/promote.sh と make promote（03 9章）

本番の資格情報は使わない。staging・本番へのデプロイは、ユーザーが 04 3章の準備を終えてから昇格 PR で行う。
make build（CLOUDFLARE_ENV=staging と production）と wrangler の dry-run が通り、
promotion-check のスクリプトがローカルで「正しい SHA」「main の祖先でない SHA」「staging に出していない SHA を本番へ」
の3通りを正しく判定し、このステップの PR で ci.yml が緑になる状態をゴールとする。
初回の staging のデプロイのあとに、ADR-022 の staging で見る項目を確かめる。
```

---

## Step 10: テスト + 仕上げ

Status:

```
テストとコード品質・運用の仕上げをしてください。

先に読む: SDD 7章（セキュリティヘッダー・パフォーマンス）・10章・11章・ADR-018、docs/01_prd.md 5章、design-spec 2.2

やること:
1. カバレッジ: SDD 10章の目標（src/domain・src/i18n・src/markdown の行 90%）に届かせる
2. 認可の網羅: SDD 7章の権限マトリクスの全行が結合テストに対応していることを確かめ、足りなければ足す
3. E2E: design-spec 2.2 のコアフロー（訪問者の「何者かつかみ、作品で確かめる」と「人となりを知る」、
   管理者の「書いて公開する」）を1本ずつ。異常系の最低ライン（不正な入力のエラーの出し方・未認証の拒否・
   空の状態の表示・期限切れからの復元）。コアフローの E2E は受入スイートを兼ねるので、
   実装の内部ではなく仕様の振る舞いで書く。管理者の流れのログインは tests/e2e/fixtures.ts の
   login({ admin: true }) を使う。make e2e を走らせる環境（手元と CI）の .dev.vars に ADMIN_GITHUB_USER_ID が要る
4. アクセシビリティ: P1〜P5・A1・A2 で axe の重大な違反 0件
5. Lighthouse CI: PRD 5章の Lighthouse の目標を assert する（SDD 10章）
6. KPI と監視: Sentry（サーバーは withSentry、ブラウザは @sentry/react、DSN はルートのローダーから。SDD 11章）と、
   ブラウザのパフォーマンス計測（Web Vitals の TTFB・LCP。SDD 7章の測り方）
7. セキュリティヘッダーと X-Robots-Tag（SDD 7章・ADR-019）。E2E でブラウザのコンソールに CSP の違反が出ないこと
8. コミット前の検査は .githooks/pre-commit（doc-lint）が担い、lint は CI で止める（Husky と lint-staged は使わない）
9. リポジトリのルートの README.md（何のリポジトリか、make setup と make dev での始め方、docs/README.md への案内）

make test と make e2e が全パスし、make lint がエラー0、カバレッジの目標を満たす状態をゴールとする。
```

---

## Step 11: 今のサイトからのデータ移行

Status:

```
design-spec 9章「データ移行」に従って、今のサイトのデータを移す変換スクリプトを作ってください。

先に読む: design-spec 9章、SDD 6章（6.5 今の DB からの対応）・ADR-006・010、docs/04_deployment-procedure.md 3章 Step 7

やること:
1. scripts/migrate-legacy/: https://eastasian.vercel.app/ の日英のページの __NEXT_DATA__ から、
   プロフィール・経歴・作品・プロジェクト・使用技術を取り出す
2. SDD 6章の形に変換する（SDD 6.5 の対応。今の説明は summary に入れる。移したものは下書きで入れる）。
   1文のパラメーターは100個まで（ADR-006）
3. 画像（写真・技術アイコン）を今の置き場から取ってきて、R2 の uploads/legacy/ のキーに対応させ、
   D1 に流す SQL と、R2 に置く画像の一覧を出す
4. ローカルで確かめる: マイグレーションだけを当てた空のローカル D1 に SQL を入れ、画像をローカルの R2 に置き、
   取り出した件数と D1 の件数が一致し、管理画面で日英とも中身が見えること

staging・本番への投入はしない（ユーザーが 04 3章 Step 7 の手順で行う）。
この環境のネットワークの設定で eastasian.vercel.app や画像の置き場に届かないときは、
Status を blocked にし、理由（どのホストへの通信が許可されていないか）を書く。
ローカルで変換と投入が通り、件数が一致する状態をゴールとする。
```
