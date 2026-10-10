# Feature Design Doc — アクセス解析を Analytics Engine で集め、管理画面で見る

> 原則: 1ユーザーストーリー = 1 Feature Design Doc
> 変更規模: 大（PRD 6章・design-spec 9章のスコープ外を外し、SDD 1章の Non-Goal（Cron）と 7章の個人情報の方針を変える。公開側に計測のコード、管理画面に新しい画面 A10、受け口・定期実行・テーブルが増える）
> 関連: `docs/features/20261010-1346_privacy-page.md`（訪問者への告知。こちらより先に本番に出し、本文を書いてから昇格する。ロールアウト計画）

## 背景と目的

今のサイトはアクセス解析をしていない（PRD 5章・design-spec 9章でスコープ外）。分かるのは Cloudflare のダッシュボードのリクエスト数の合計と、Sentry が性能のために10%だけ送る Web Vitals だけで、「どのページ・どの作品が見られたか」「どこから来たか」「P1 のどこまで読まれたか」「実物（サイト・GitHub）まで進んだか」が分からない。そのため、コアフロー（design-spec 2.2「何者かつかみ、作品で確かめる」）が訪問者に届いているかを確かめられず、PRD 5章の「発信の継続」で書いたブログ・記録がどれだけ読まれたかも分からない。

持ち主が決めたこと（2026-10-10）:

- 知りたいことは、閲覧数・流入元・サイト内の行動・訪問者の属性の4つ全部。
- 仕組みは Workers Analytics Engine に書き、自作の CMS に解析の画面を足して見る（外部の解析サービスと Cloudflare Web Analytics は使わない）。
- 訪問者は Cookie を使わずに、日ごとに変わるハッシュで数える（IP は残さない）。数えられるのは日ごとの訪問者数まで。
- 集め方は、ブラウザから同じ origin の受け口へ送る。サーバー関数の呼び出しでは数えない（先読みで多めに出て、行動が取れないため）。
- 除くもの: 管理者自身の閲覧、ボット、Do Not Track・Global Privacy Control を送るブラウザ。計測は本番だけ（staging・ローカルのデータは残さない）。
- 記録する行動: P1 の行を広げた・ページングした、外部リンクを押した、P1 のどのセクションまで見たか・詳細ページの読了、言語・テーマの切り替え、コードのコピー。
- 見る場所: 管理画面に新しい画面 A10「アクセス解析」（縦に1枚。サイドメニューは Coding Log の後）と、A2 ダッシュボードに昨日までの7日の要約。
- Analytics Engine の保持は3か月なので、毎日の Cron で日ごとの集計を D1 に残し、1年・全期間の推移も見られるようにする。
- 計測しない環境（ローカル・staging）では、A10・A2 は D1 に入っている集計（ローカルはシードのデモデータ）を出し、「この環境では計測していません」を添える。
- 訪問者への告知は、別の FDD（プライバシーのページ）で行う。
- 訪問者のハッシュに混ぜる日ごとのランダムな値は、Workers KV に期限付きで置く（D1 は Time Travel で消した行を30日戻せるため、「日が終わったら照合できない」が成り立たない。レビューの指摘を受けて持ち主が選んだ）。

## Goal / Non-Goal

### Goal

1. 本番の公開側の画面（P1〜P5、P6（`docs/features/20261010-1346_privacy-page.md` が足すプライバシーのページ）、`$lang` の下で出す C1（`$lang` が `ja`・`en` 以外のときを含む））の表示と、詳細設計の「イベント」の表の行動を、ブラウザから `POST /api/collect` に送り、Analytics Engine に1件ずつ書く。C2 と、どのルートにも当たらない C1 は送らない。
2. 訪問者は、日ごとにランダムな値と IP（IPv6 は上位64ビット）と User-Agent から作るハッシュで数える。日ごとの値は Workers KV に置き、日本時間のその日の終わりから10分以内に期限切れで消える。IP・User-Agent は残さない。
3. 管理者のセッションを持つ送信、ボットの User-Agent、DNT・GPC を送る送信は書かない。staging・ローカルは書かない。
4. 毎日、日本時間の 00:15 に Cron が、昨日と一昨日（遅れて届いた送信を拾うため毎回集計し直す）と、計測の開始日から昨日までの未集計の日を Analytics Engine から集計し、D1 の日ごとの集計に入れる。1日の取りこぼしは次の実行で埋まる（Analytics Engine に残っている範囲）。
5. A10 で、期間（7日・30日・90日・1年・すべて）を選び、合計（閲覧・訪問者・外部へ）と前の期間との差、推移、ページ、流入元、P1 のセクション到達率、行動、属性を見られる。
6. A2 に、昨日までの7日の閲覧数・訪問者数（D1 の集計だけ）を出し、A10 へ移れる。
7. PRD 5章の費用と Lighthouse の目標を保つ。費用: 想定の量（1日 1,000 閲覧で、1閲覧あたりイベント約8件 → 月約24万件の書き込み。SQL API は Cron と A10 で月数千回）は、Workers Paid に含まれる枠（書き込み月1,000万件・読み取り月100万回）と KV の枠に収まる。Lighthouse: 今の Lighthouse CI（送信のモジュールを含むプレビュー）で目標を満たす。外部のスクリプトは読まない。

### Non-Goal

- 訪問者を日をまたいで識別すること（再訪の判定・リテンション・ファネルを日をまたいで追う）。Cookie や端末の識別子を使わない決定による。
- リアルタイムの表示（今いる人数）。今日の分は A10 を開いたときに読むだけ。
- セッション（1回の訪問）の単位の集計（滞在時間・直帰率）。1件ずつの記録から作れるが、今回は扱わない。
- 検索のキーワード（Search Console との連携）。
- 管理画面（`/admin/*`）の利用の計測。
- 解析の結果の書き出し（CSV など）と、外部への通知。
- 流入元のホスト名をサービス名（`t.co` → X など）にまとめること。ホスト名のまま出す。
- 同意のバナー。Cookie を使わず、日をまたいで訪問者を識別できる値を残さない（ハッシュは日ごとに変わり、元にした日ごとの値はその日の終わりに消える）ので出さない（告知はプライバシーのページ）。
- staging での通しの確認（計測は本番だけという決定による。staging で確かめられる範囲はロールアウト計画）。

## 影響範囲

| 影響箇所 | 変更内容 |
|----------|----------|
| フロントエンド（公開側） | 新しい `src/site/analytics.ts`（送信のモジュール。表示・行動のイベントを作って `navigator.sendBeacon` で送る）。`src/routes/__root.tsx` か `$lang/route.tsx`（ルーターの移動の完了で表示のイベント。送信のオン・オフをローダーで受け取る）。P1 のセクション（`src/routes/$lang/index.tsx`・`src/site/section-pager.tsx`・`src/site/top-items.tsx`）、詳細ページ（`src/site/portfolio-detail-page.tsx`・`post-detail-page.tsx`）、ヘッダー（`src/site/site-header.tsx` の言語・テーマ）、本文（`src/ui/markdown-body.tsx` のコピー）、外部リンクを出す部品（`src/site/content-parts.tsx`・`detail-parts.tsx`・`profile-section.tsx`・`site-footer.tsx`）に、送信の呼び出しか `data-analytics-link` の属性を足す |
| フロントエンド（管理画面） | 新しい `src/admin/analytics.tsx`（A10）とルート `src/routes/admin/_authed/analytics.tsx`。`src/admin/dashboard.tsx`（昨日までの7日の要約）。`src/admin/sidebar.tsx`（メニューに「アクセス解析」）。グラフは新しい部品（SVG）で、ライブラリを足さない |
| バックエンドAPI | 新しい受け口 `POST /api/collect`（`src/api/collect.ts`。Elysia のルート。oRPC の外）。CMS API に `GET /api/admin/analytics`（コントラクト `src/api/contract/analytics.ts`、実装 `src/api/router/analytics.ts`）。`GET /api/admin/dashboard` の応答に `analytics` を足す |
| 定期実行 | `src/server.ts` に `scheduled` のハンドラー。集計の処理は新しい `src/api/analytics/rollup.ts`。Analytics Engine の SQL API を呼ぶ部品は `src/api/analytics/sql.ts` |
| 純粋関数 | 新しい `src/domain/analytics/`（イベントの形と値の検査、ボットの判定、デバイスの判定、流入元の正規化、日本時間の日付と期間の計算、上位100件と「その他」へのまとめ） |
| DBスキーマ | 新しいテーブル `analytics_daily`・`analytics_rollup`。`src/db/enums.ts` に `ANALYTICS_DIMENSIONS`。マイグレーションを足す |
| 認証・認可 | `/api/collect` は認証なし（公開側の訪問者が送る）。管理者の除外のために、セッションの Cookie があるときだけ Better Auth の `getSession` で読む。`GET /api/admin/analytics` は 5.1 のミドルウェアがそのままかかる |
| インフラ | `wrangler.jsonc`: 本番だけに Analytics Engine のバインディング `ANALYTICS`（データセット `eastx_analytics`）、KV のバインディング `ANALYTICS_SALTS`（日ごとの値）、`triggers.crons`。全環境にレート制限 `COLLECT_RATE_LIMITER`。変数 `ANALYTICS_BEACON`（本番・ローカルは `on`、staging は `off`）と、本番の `CF_ACCOUNT_ID`。本番のシークレット `ANALYTICS_API_TOKEN`（Account Analytics: Read）。Cloudflare で API トークンと KV の namespace を作る |
| シード | `scripts/seed/`（`analytics_daily`・`analytics_rollup` に、ローカル用のデモの集計を入れる） |
| デザイントークン | `size.chart`（推移のグラフの高さ）と `size.meter`（到達率の横の棒の太さ）を足す。色は既存のセマンティックトークンで描く（詳細設計。実装で決めた細部） |
| 監視 | Cron の失敗を Sentry に送る（`withSentry` が `scheduled` も包む）。`/api/collect` はトレースの対象から外す（`tracesSampler` で0。量が多く、Sentry の無料枠を食うため。ADR-018）。ログは8章の形 |

ソースドキュメントの変更（/draft:feature-implement が所有権マップに従って直す）。CMS API の形はコントラクトが正なので、SDD 5章（5.0・5.4・5.11・新しい節）とコントラクトは実装の最初に直し、ほかの行は実装の完了後に直す。5章の新しい節の番号は、プライバシーの FDD と入る順で決める（先に入った方が 5.12 を取る）:

| ドキュメント | 節 | 変え方 |
|---|---|---|
| PRD | 4章 | 管理者のストーリーに M-13「どのページ・作品が見られ、どこから来て、どこまで読まれたかを管理画面で見たい（6.8）」（Should）を足す |
| PRD | 5章 | 前置きの「アクセス解析はしない（スコープ外）ので、測れるものに絞る」を、「アクセス解析は Cookie を使わない日ごとの集計に限る（SDD ADR-023）」に直す。目標の表は変えない |
| design-spec | 3章 | 画面の数を直し、3.3 に A10「アクセス解析」（L4、認証必要。期間を選んで閲覧・流入元・行動・属性を見る）を足す。サイドメニューの並びの文に「Coding Log の後にアクセス解析」を足す（中身の種類ではないので公開側のセクションの並びの外に置く） |
| design-spec | 4.2 | A10 の行（L4、縦にスクロール） |
| design-spec | 6.5 | A2 に「昨日までの7日の要約」の要素と、計測しない環境の表示を足す。図に要約を足す |
| design-spec | 6.8（新しい節） | A10 の画面の仕様（詳細設計の UI 変更の A10 をそのまま移す） |
| design-spec | 8章 | `analytics_daily` のデモデータの行を足す |
| design-spec | 9章 | 拡張候補から「アクセス解析」を外す |
| design-spec | 別紙 `screen_flow.mermaid` | A10 と、サイドメニュー・A2 からの遷移を足す |
| System Design Doc | 1章 | Goal に「公開側の閲覧と行動を Cookie を使わずに集計し、管理画面で見る（ADR-023）」を足す。Non-Goal の「定期実行（Cron）やジョブキュー」を「ジョブキュー。定期実行は解析の日ごとの集計だけ（ADR-023）」に直す |
| System Design Doc | 2章 | 図とフローに `/api/collect` → Analytics Engine、Cron → SQL API → D1 を足す。インフラ管理の表に Analytics Engine と Cron を足す |
| System Design Doc | 3章 | ADR-023「アクセス解析は Workers Analytics Engine に書き、日ごとの集計を D1 に残す」を足す（実装アプローチの決定・理由・トレードオフ・捨てた案。日ごとの値を KV に置く理由を含む）。一覧の表に行を足す。ADR-001: 「管理画面が API 経由でしかデータを書かない」の境界に、訪問者の解析の送信（`/api/collect`。中身のデータは書かず、Analytics Engine にだけ書く）を例外として足す。ADR-004: Elysia の受け持ちに `/api/collect` を足す。ADR-018: トレードオフの「アクセス解析はしない」を「アクセス解析は ADR-023」に直し、`/api/collect` をトレースから外すことを足す。ADR-021: 決定の「バインディングを2つ使う」「公開側には独自の制限をかけない」を書き換え、3つ目の `COLLECT_RATE_LIMITER`（訪問者の送信を IP ごとに60秒120回）と、公開側でこの受け口だけを例外にする理由（書き込みの経路で、ボットの大量の送信がデータと費用を膨らませる）を足す。ADR-022: 表に、詳細設計の「実装の最初に確かめること」の行を足す（結果もここに記録する） |
| System Design Doc | 4.1・4.2 | ルート `/admin/analytics`（`admin/_authed/analytics.tsx`、A10）。エンドポイント `/api/collect`（Elysia、認証なし）。4.2 の `/api/admin/*` の行の「CMS API（5.3〜5.9）」を、CMS API の節すべてを指す書き方（5.3〜5.10 と新しい CMS API の節）に直す |
| System Design Doc | 5.0 | 「日本時間の日（暦の日）は `"YYYY-MM-DD"` の文字列」を足す（A10 の `from`・`to`・区切りの `start`） |
| System Design Doc | 5.2 | `get-session` の用途の「A2〜A9 の表示前」を、管理画面の認証の要る画面すべて（A2〜A10。プライバシーの FDD が入っていれば A2〜A11）に直す |
| System Design Doc | 5.11 | `SiteChromeView` に `analyticsBeacon` を足し、TSDoc の用途（フッター）を「公開側の全画面の共通の中身（フッターと解析の送信のオン・オフ）」に直す。読めなかったときは SNS リンクを空、`analyticsBeacon` を `false` にすることを決まりとして書く |
| System Design Doc | 5.4 | ダッシュボードの応答に `analytics` を足す |
| System Design Doc | 5章の新しい節（CMS API） | `GET /api/admin/analytics` |
| System Design Doc | 5章の新しい節（公開の受け口） | `POST /api/collect`（公開の受け口。CMS API の外であること、5.1 のミドルウェアをかけない理由、受け付ける本文、応答） |
| System Design Doc | 6章 | 6.1 に「日付（暦の日）は `YYYY-MM-DD` の文字列（日本時間の日）」と、`analytics_daily`・`analytics_rollup` が `id`・`created_at`・`updated_at` を持たない例外（行が日と次元とキーで決まり、Cron が丸ごと書き直すだけで、更新の日時に意味が無い）を足す。6.2・6.3・6.4 に2つのテーブル、`ANALYTICS_DIMENSIONS`。CHECK の部品に `dateFormat` |
| System Design Doc | 7章 | 個人情報の行を、詳細設計の「個人情報」の段落の内容に直す。権限マトリクスに `POST /api/collect`（全員 ✓）の行を足し、「A2〜A9 の表示」の行と、その下のルートガードの注記の「A2〜A9」を「A2〜A10」（プライバシーの FDD が入っていれば「A2〜A11」）に直す（`GET /api/admin/analytics` は既存の `GET /api/admin/*` の行に入る）。CSRF の行に「`/api/collect` は Origin が `SITE_URL` と違えば 403（訪問者の送信で、守る権限は無い。他サイトからのデータの混入を抑える）」を足す。パフォーマンスの「CMS API の応答（p95）300ms 以下」に、`GET /api/admin/analytics` を除くこと（今日の分で外部の SQL API を呼ぶ。タイムアウト3秒）を足す |
| System Design Doc | 9章 | 「数値」の行を「公開側は件数とページ番号だけで、桁区切りは使わない。管理画面の A10・A2 の解析の数字は桁区切りを使う」に直す |
| System Design Doc | 10章 | 詳細設計のテスト方針の対象を足す |
| System Design Doc | 11章 | Cron の失敗の扱い（Sentry に送る）と、`/api/collect` をトレースから外すこと（`tracesSampler`）を足す |
| dev-setup | 3.2 | 変数 `ANALYTICS_BEACON`・`CF_ACCOUNT_ID`、シークレット `ANALYTICS_API_TOKEN`（ローカルは空でよい） |
| dev-setup | 5章 | `wrangler.jsonc` の例に、本番の `analytics_engine_datasets`・`kv_namespaces`・`triggers`、全環境の `COLLECT_RATE_LIMITER`、`ANALYTICS_BEACON` を足す |
| deployment | 3章 | Step 2 に本番の KV の namespace の作成（`wrangler kv namespace create eastx-analytics-salts`）を、Step 4 に `ANALYTICS_API_TOKEN` の登録と API トークンの作り方（権限は Account Analytics: Read だけ）を足す |
| deployment | 5章 | ロールバックで、Cron のトリガーが外れたかを確かめる手順（スパイクの結果に合わせる）を足す |
| deployment | 4章・6章 | リリース前チェックとデプロイ後確認に、Cron の初回の実行の確認と A10 の今日の分を足す |
| runbook | 2章・3章・6章 | 監視に Cron の失敗、障害に「解析の数字が出ない・今日の分が読めない」（API トークンの期限・権限、SQL API の障害）、定期メンテナンスに API トークンの更新を足す |

## 実装アプローチ

### 計測の流れ

```
ブラウザ（公開側、ANALYTICS_BEACON = on のとき）
  表示・行動 ──sendBeacon──▶ POST /api/collect（Elysia）
                                ├ 形・大きさ・Origin の検査（違えば 400 / 403）
                                ├ COLLECT_RATE_LIMITER（IP ごと。超えたら 429）
                                ├ 除外（DNT・GPC・ボット・管理者のセッション）→ 書かずに 204
                                ├ バインディング ANALYTICS が無い（staging・ローカル）→ 書かずに 204
                                └ 訪問者のハッシュを作り、Analytics Engine に1件書いて 204
Cron（本番、毎日 15:15 UTC = 00:15 JST）
  昨日・一昨日・未集計の日 ──SQL API──▶ 集計 ──db.batch()──▶ D1 analytics_daily・analytics_rollup
  明日の日ごとの値を KV に作る（期限付き）
A10・A2（管理画面）
  GET /api/admin/analytics ─▶ 確定した日は D1、今日の分は SQL API（A10 だけ）
```

- 受け口は CMS API（`/api/admin/*`）と分け、`/api/collect` に置く。CMS API は管理者だけが使う API で、5.1 のミドルウェア（CSRF・認証・認可）を全手続きに一律にかける決まり（CLAUDE.md）なので、訪問者が送る受け口を oRPC の手続きにすると例外を作ることになる。Elysia のルートとして `/media/*` と同じ並びに置き、入力の検査は `src/domain/analytics/` の関数で行う（Zod を公開側のバンドルに入れないため、検査はサーバーだけで行い、公開側は同じイベントの名前の定数だけを共有する）。
- 送るかどうかはブラウザ側で決める。サーバーは `ANALYTICS_BEACON` を `$lang/route.tsx` のローダー（`getSiteChrome`）で返し、`on` のときだけ送信のモジュールが動く。staging は `off` なので送らない。ローカルは `on` で、受け口はバインディングが無いので書かずに 204 を返す。ローカルを `on` にするのは、E2E で「どの操作でどのイベントが送られるか」を受け口までの実際の経路で確かめるため（データはどこにも残らない）。
- 書くかどうかはバインディング `ANALYTICS` の有無で決める。`wrangler.jsonc` の本番の環境にだけ書く。計測しているか（A10・A2 の表示）も、サーバーがバインディングの有無で判定して API で返す。
- サーバー関数（`/_serverFn/...`）の呼び出しで数えない理由: リンクにポインターを乗せた先読みでも呼ばれ、JavaScript を動かさないボットの SSR も混ざり、行動のイベントは取れない。
- 送信は `navigator.sendBeacon` で、本文は JSON の文字列を `text/plain` の Blob で送る（同じ origin なので CORS の事前確認は無いが、Content-Type による違いを持ち込まない）。ページを離れる途中でも届き、画面の操作を待たせない。`sendBeacon` が無いブラウザでは `fetch(..., { keepalive: true })`。
- CSP は変えない（`connect-src 'self'` に収まる）。Cookie は増やさない。

### 訪問者の数え方

- ハッシュ = SHA-256(`日ごとの値` ‖ `日本時間の日付` ‖ `IP` ‖ `User-Agent`) の先頭16バイトの16進。`IP` は `cf-connecting-ip` を `rateLimitKeyOf`（`src/api/rate-limit-key.ts`）と同じ規則で、IPv6 は上位64ビットにまとめた値（プライバシー拡張で末尾が変わっても同じ人として数えるため）。
- `日ごとの値` は32バイトのランダムな値（64文字の16進）で、KV（`ANALYTICS_SALTS`）のキー `salt:{YYYY-MM-DD}` に置く。期限（KV の `expiration`）は、日本時間のその日の終わり＋10分の UNIX 時刻（日付の境目の直前に送られた送信を処理し終えるための余裕）。
- 作るのは Cron: 毎日 00:15 の実行で、翌日の値を作って置く（使い始める約24時間前に置くので、KV の拠点への伝わりの遅れ（最大60秒程度）が問題にならない）。
- 受け口は、Worker の isolate の中のキャッシュ（日付ごと）→ KV の `get` の順で読む。KV に無い（初回のデプロイの当日、Cron が失敗した日）ときは、受け口がその場で作って `put` する。KV は「無ければ書く」を原子的にできないので、その日の最初の数十秒は拠点ごとに別の値が作られうる。その間は同じ人が別の訪問者として数えられうる（訪問者数がわずかに多く出る）ことを受け入れる。後から書いた値が残り、伝わり終えた後はどの拠点も同じ値を使う。
- 期限が切れた値は KV から消え、利用者が戻す仕組みは無い（スパイクで公式の文書を確かめる）。消えた後は、IP と User-Agent が分かってもハッシュと結び付けられない。
- 固定のシークレットを使う案を採らない理由: シークレットを知る人は、ある IP の過去の日のハッシュを作り直して照合できる。
- D1 に置く案を採らない理由: 本番の D1 は Time Travel（ADR-006）で、消した行を30日戻せる。
- Worker のメモリーだけに持つ案を採らない理由: isolate・拠点ごとに別の値になり、訪問者数が大きく多めに出る。
- 数えられるのは、日ごとの訪問者数（その日のハッシュの種類の数）まで。期間の訪問者数は「日ごとの訪問者数の合計」で、A10 にもそう書く。
- Analytics Engine の index（サンプリングの単位）にハッシュを入れる。量が少ないあいだはサンプリングされないが、集計の SQL は `_sample_interval` を掛けて数える（公式の推奨）。

### 除外

| 条件 | 判定の場所 | 扱い |
|---|---|---|
| DNT（`navigator.doNotTrack === '1'`）・GPC（`navigator.globalPrivacyControl === true`） | ブラウザ（送らない）とサーバー（`DNT: 1`・`Sec-GPC: 1` のヘッダーがあれば書かない） | 両方で見る。ブラウザだけだと、拡張機能などでヘッダーだけを付けている場合を落とす |
| ボット | サーバー（User-Agent の正規表現。`src/domain/analytics/bots.ts`）とブラウザ（`navigator.webdriver` なら送らない） | Sentry の稼働監視（`SentryUptimeBot`）、Lighthouse（`Chrome-Lighthouse`）、ヘッドレスのブラウザ（`HeadlessChrome`）、主なクローラー・プレビューの取得（`bot`・`crawl`・`spider`・`slurp`・`facebookexternalhit`・`embedly` などの語）。JavaScript を動かさないボットは、そもそも送らない |
| 管理者 | サーバー | Cookie にセッション（`eastx.session_token`。本番は `__Secure-` 付き）があるときだけ、`getSession`（`disableRefresh`）で読み、`isAdminGithubUserId` なら書かない。Cookie が無い送信では D1 を読まない |
| staging・ローカル | サーバー | バインディングが無いので書かない |

除外したときも 204 を返し、除外したかどうかを外から見せない。

### Cron での集計と保持

- `wrangler.jsonc` の本番の `triggers.crons` に `15 15 * * *`（UTC。日本時間の 00:15）を書く。staging・ローカルには書かない。
- 計測の開始日: `analytics_rollup` が空なら、SQL API でデータセットの最も古い `timestamp`（保持の3か月の範囲）を読み、その日本時間の日を開始日とする（データが無ければ、その回は何もしない）。`analytics_rollup` に行があれば、その最も古い日を開始日とする。開始日より前の日は集計せず、`analytics_rollup` にも入れない（計測前の空の日で埋めない）。
- 集計する日: (1) 昨日と一昨日（集計済みでも毎回集計し直す。日付の境目の直前に送られ、遅れて Analytics Engine に入った送信を拾うため）、(2) max(開始日, 今日の89日前) から3日前までのうち `analytics_rollup` に行の無い日を古い順に。1回の実行で集計するのは (1) と (2) を合わせて7日まで（長く失敗が続いた後に、CPU 時間と SQL API の呼び出しが膨らまないように）。残りは次の実行で埋まる。
- 1日ぶんの集計: 次元（後述）ごとに SQL API へ問い合わせ、上位100件と「その他」（キー `(other)`）にまとめる。イベントが0件の日も、`analytics_rollup` には入れる（「集計した結果0件」と「集計していない」を分けるため）。
- 1日ぶんの書き込みは1回の `db.batch()`（D1 の batch は全体が1つのトランザクションで、途中で失敗すれば何も残らない）: その日の `analytics_daily` の行を消す → 行を入れる（1行に5つのパラメーターなので、1文に20行ずつ。100個の上限。ADR-006。1日の最大は18次元×101行で、約91文）→ `analytics_rollup` に `INSERT ... ON CONFLICT(date) DO UPDATE SET rolled_up_at = …`。同じ日を何度集計しても、Cron が二重に動いても、結果は同じになる。
- 集計の後に、明日の日ごとの値を KV に作る（上の「訪問者の数え方」）。
- 失敗（SQL API の 4xx・5xx、D1 のエラー）は ERROR のログと Sentry に送る。その日は `analytics_rollup` に入らないので、次の実行でやり直す。Analytics Engine の保持（3か月）を過ぎると、その日は埋められない。

### A10 の読み方

- 確定した日（`analytics_rollup` にある日）は D1 の `analytics_daily` から読む。今日の分は SQL API から読む（Cron と同じ問い合わせの部品で、今日の 00:00 JST から今まで）。
- 昨日までで `analytics_rollup` に無い日（Cron がまだ動いていない・失敗した）は、A10 を開いたときにも埋めない（埋めるのは Cron だけにする。A10 の表示が遅くならないように、書き込みを1か所にまとめるため）。A10 は「集計していない日があります（n日）」を出す。
- `ANALYTICS_API_TOKEN` か `CF_ACCOUNT_ID` が無い（未登録の `undefined` と空文字の両方を「無い」とする。staging・ローカル）、または SQL API が失敗した・3秒で応答しないとき（`AbortSignal.timeout`）は、今日の分を足さずに出し、その旨を出す。
- A2 は今日の分を読まない（D1 の集計だけ）。ダッシュボードの応答を外部の API の速さに左右させないため（SDD 7章の CMS API の応答の目標）。

### 採らなかった案

- Cloudflare Web Analytics: 無料で Cookie を使わないが、カスタムイベントが無く、行動が取れない。見る場所も Cloudflare のダッシュボードに分かれる。
- 外部の解析サービス（Umami Cloud・PostHog・GA4）: 外部のスクリプトと送信先が増え、CSP と SDD 7章の方針を変えることになる。GA4 は Cookie を使い、重い。有料のプランは PRD 5章の費用を超える。
- D1 に1件ずつ書く: 送信のたびに D1 への書き込みが増え、行も増え続ける（ADR-021 で D1 の数え方を捨てた理由と同じ）。
- 画面を開いたときに集計して D1 に残す（Cron を使わない）: 3か月以上 A2・A10 を開かないと、その間が欠ける。
- ファーストパーティの Cookie で再訪を数える: 訪問者を識別する値を持つことになり、SDD 7章の方針と同意の扱いを変える必要がある。持ち主が日ごとのハッシュを選んだ。
- 計測を staging にも広げ、環境ごとにデータセットを分ける: 持ち主が本番だけを選んだ。

## 詳細設計

### イベント

イベントの種類と、ブラウザが送る値。共通の値（全イベント）: `type`、`path`（`location.pathname`。クエリとハッシュは送らない）、`lang`（表示している言語 `ja`・`en`。`$lang` が `ja`・`en` 以外の C1 でも、表示に使った言語）。サーバーが足す値: 国（`request.cf.country`。無ければ `XX`）、デバイス（User-Agent から `mobile`・`tablet`・`desktop`）、ブラウザの言語（`Accept-Language` の最優先の言語タグの主の部分。例 `ja`・`en`・`zh`。無ければ空）、訪問者のハッシュ。

| `type` | 送るとき | 固有の値 |
|---|---|---|
| `page_view` | 送る経路はルーターの `onResolved` の1つだけで、送信のモジュールが前回送った `path` と違うときだけ送る（最初の描画で `onResolved` が来ても来なくても二重にならないよう、モジュールの初期化で今の `path` を1回送り、それを「前回」とする）。ハッシュだけの移動・同じパスの読み込み直しは送らない。ブラウザの戻る・進むは、`path` が変われば送る。bfcache から戻ったとき（`pageshow` の `persisted`）は、前回の `path` を消してから今の `path` を送る | `referrer`（文書を読み込んだ最初の1回だけ `document.referrer`。ルーターの移動では送らない）、`utm`（文書を読み込んだ最初の1回だけ。URL の `utm_source`・`utm_medium`・`utm_campaign`） |
| `section_view` | P1 で、各セクション（`profile`・`career`・`projects`・`works`・`stack`・`blog`・`coding`）の見出しが初めて画面に入ったとき（`IntersectionObserver`。1回の表示で各セクション1回） | `section` |
| `read_complete` | P2〜P5 で、本文の最後（前後のナビの直前に置く印）が初めて画面に入ったとき（1回の表示で1回）。P6・C1 では送らない | なし |
| `row_expand` | P1 の経歴・作品・プロジェクトの行を広げたとき（閉じたときは送らない） | `section`（`career`・`projects`・`works`）、`itemId` |
| `paging` | P1 のセクション内ページングで、ページを移ったとき | `section`、`page`（移った先のページ番号） |
| `outbound` | 別タブで開く外部リンクを押したとき（`click`。中ボタン・修飾キー付きも `auxclick` で拾う） | `linkKind`（`site`: サイトを見る、`github`: GitHub、`social`: プロフィールとフッターの SNS、`stack`: 使用技術のリンク、`reference`: コーディング記録の参考リンク、`body`: 本文中の外部リンク）、`host`（行き先のホスト名） |
| `lang_switch` | ヘッダーの言語の切り替えを押したとき | `to`（`ja`・`en`） |
| `theme_switch` | ヘッダーのテーマの切り替えを押したとき | `to`（`system`・`light`・`dark`） |
| `code_copy` | 本文のコードブロックの「コピー」を押したとき | なし |

- `outbound` は、公開側のレイアウトの1か所で `click` を委ねて受け、`a[target="_blank"]` のうち、`data-analytics-link` の属性を持つものはその値を、持たないもの（Markdown の本文）は `body` を `linkKind` にする。部品ごとに送信を書かない。
- `section_view` の見出しの判定に、トップのセクションの要素の ID（SDD 4.1）をそのまま使う。

`POST /api/collect` の本文（例）:

```json
{ "type": "page_view", "path": "/ja/works/my-app", "lang": "ja", "referrer": "https://www.linkedin.com/feed/", "utm": { "source": "linkedin", "medium": "social", "campaign": null } }
{ "type": "row_expand", "path": "/ja", "lang": "ja", "section": "works", "itemId": "a7e3c1d2-…" }
{ "type": "outbound", "path": "/en/works/my-app", "lang": "en", "linkKind": "github", "host": "github.com" }
```

値の検査（`src/domain/analytics/events.ts`。違えば 400）:

| 値 | 規則 |
|---|---|
| 本文 | 4KB まで。JSON のオブジェクト。`type` ごとに決めたキーだけ（ほかのキーがあれば 400） |
| `path` | `/` で始まり、300字まで。公開側のルート（SDD 4.1）の形に当たらないもの（C1 の URL。`/fr/foo` なども）も受け付け、そのまま記録する（存在しない URL への流入も見たいため） |
| `lang` | `ja`・`en` |
| `referrer` | 2,048字まで。`http:`・`https:` の URL か空。サーバーはホスト名だけを残し（パスとクエリは捨てる）、自分のホスト（`SITE_URL`）なら記録しない（空にする） |
| `utm` の各値 | 100字まで。英小文字にし、前後の空白を除く |
| `section` | 上の表の値 |
| `itemId` | UUID の形 |
| `page` | 1〜1000 の整数 |
| `linkKind` | 上の表の値 |
| `host` | 253字まで、ホスト名の形 |
| `to` | 上の表の値 |

### Analytics Engine の1件の形

| 位置 | 値 |
|---|---|
| `index1` | 訪問者のハッシュ |
| `blob1` | `type` |
| `blob2` | `path` |
| `blob3` | `lang`（表示している言語） |
| `blob4` | 流入元のホスト名（`page_view` の最初の1回だけ。無ければ空） |
| `blob5` | `utm`（`source\|medium\|campaign`。無いものは空。全部無ければ空） |
| `blob6` | 国 |
| `blob7` | デバイス |
| `blob8` | ブラウザの言語 |
| `blob9` | `section` |
| `blob10` | `itemId` |
| `blob11` | `linkKind` |
| `blob12` | `host` |
| `blob13` | `to` |
| `blob14` | 訪問者のハッシュ（index と同じ値。SQL で種類の数を数えるために blob にも置く） |
| `double1` | `page` |

データセットの名前は `eastx_analytics`。日時は Analytics Engine が書き込みの時刻を `timestamp` に入れる。

### 集計の次元（`analytics_daily.dimension`）

| `dimension` | 元のイベント | `key` | `count` | `visitors` |
|---|---|---|---|---|
| `total` | `page_view` | 空文字 | 閲覧数 | 訪問者数 |
| `page` | `page_view` | `path` | 閲覧数 | 訪問者数 |
| `referrer` | `page_view`（`blob4` が空でないもの） | ホスト名 | 件数 | 訪問者数 |
| `utm` | `page_view`（`blob5` が空でないもの） | `source\|medium\|campaign` | 件数 | 訪問者数 |
| `country` | `page_view` | 国のコード | 閲覧数 | 訪問者数 |
| `device` | `page_view` | `mobile`・`tablet`・`desktop` | 閲覧数 | 訪問者数 |
| `browser_lang` | `page_view` | 言語タグ（空は `(unknown)`） | 閲覧数 | 訪問者数 |
| `site_lang` | `page_view` | `ja`・`en` | 閲覧数 | 訪問者数 |
| `top_view` | `page_view`（`path` が `/ja`・`/en`） | 空文字 | 閲覧数 | 訪問者数（セクション到達率の分母） |
| `section_view` | `section_view` | `section` | 件数 | 訪問者数（到達率の分子） |
| `read_complete` | `read_complete` | `path` | 件数 | 訪問者数 |
| `row_expand` | `row_expand` | `section:itemId` | 件数 | 訪問者数 |
| `paging` | `paging` | `section` | 件数 | 訪問者数 |
| `outbound` | `outbound` | `linkKind:host` | 件数 | 訪問者数 |
| `outbound_total` | `outbound` | 空文字 | 件数 | 訪問者数（A10 の合計の「外部へ」） |
| `lang_switch` | `lang_switch` | `to` | 件数 | 訪問者数 |
| `theme_switch` | `theme_switch` | `to` | 件数 | 訪問者数 |
| `code_copy` | `code_copy` | `path` | 件数 | 訪問者数 |

- 1日・1次元の行は、`count` の多い順に上位100件と、残りをまとめた `(other)` の1行（残りがあるときだけ）まで。`(other)` の `visitors` は、上位に入らなかった行の訪問者数の合計（同じ人が重なりうるので上限の目安。A10 では「その他」の訪問者数を出さない）。
- `visitors` は、その日・そのキーの訪問者のハッシュの種類の数。SQL API の集計関数で数えられるか（`count(DISTINCT blob14)` など）は実装の最初に確かめ（スパイク）、数えられなければ `GROUP BY` で（キー, ハッシュ）の組を読み、Worker で数える。

### API変更

#### `POST /api/collect`（新規。CMS API の外）

| 応答 | 条件 |
|---|---|
| `204`（本文なし） | 書いた、または除外した、またはバインディングが無い |
| `400` | 本文が 4KB を超える・JSON でない・値の検査に通らない。本文は8章の形（`{ "defined": false, "code": "INPUT_VALIDATION_FAILED", "status": 400, "message": … }`。oRPC の手続きの外なので `defined` は `false`。5.2 の 429 と同じ扱い） |
| `403` | `Origin` があり、`SITE_URL` の origin と違う（ほかのサイトのページからの送信）。本文は8章の形（`FORBIDDEN`）。`Origin` の無い送信は受け付ける（`sendBeacon` は付けるが、付けないブラウザがありうる） |
| `404` | `POST` 以外。今の Elysia の受け皿（`notFound`。5.1 の「手続きの無いメソッドは 404」）に合わせる |
| `429` | `COLLECT_RATE_LIMITER`（IP ごとに60秒120回。キーは `rateLimitKeyOf`）を超えた。本文は8章の形（`TOO_MANY_REQUESTS`） |

- 400 の `code` は、CMS API の 422 の `INPUT_VALIDATION_FAILED` と同じ名前で、状態は 400 にする（`fieldErrors` を返さない。送信のモジュールは応答を読まない（`sendBeacon` は応答を受け取れない）ので、欄の対応は要らない）。
- 本文の読み込みは `/api/admin/*` と同じく、上限で読むのを止める（Content-Length に頼らない）。
- `x-request-id` を付ける。ログは 4xx を `warn` で出さない（量が多く、ボットの送信で埋まるため）。書き込み（`writeDataPoint`）の例外は `error` のログと Sentry に送り、応答は 204 にする（送信のモジュールはやり直さないので、500 を返しても結果は同じ）。
- `X-Robots-Tag` は `/api/*` の決まり（ADR-019）どおり付く。

#### `GET /api/admin/analytics?range={7d|30d|90d|1y|all}`（新規。A10）

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
  "otherActions": { "langSwitch": { "ja": 3, "en": 9 }, "themeSwitch": { "system": 1, "light": 2, "dark": 5 }, "codeCopy": 4, "paging": { "works": 12, "blog": 5 } },
  "audience": {
    "countries": [{ "key": "JP", "count": 800, "visitors": 300 }],
    "devices": [{ "key": "mobile", "count": 700, "visitors": 280 }],
    "browserLangs": [{ "key": "ja", "count": 900, "visitors": 330 }],
    "siteLangs": [{ "key": "ja", "count": 1000, "visitors": 380 }]
  }
}
```

- `measuring` はサーバーにバインディング `ANALYTICS` があるか。`false` のとき A10 は「この環境では計測していません。表示しているのは保存済みの集計だけです」を出す（ローカルはシードの集計、staging は0件）。
- `range` の期間は、日本時間の今日を含む N 日: `7d` は7日、`30d` は30日、`90d` は90日、`1y` は365日。`all` は計測の開始日（`analytics_rollup` の最も古い日）から今日まで（行が無ければ今日だけ）。`all` の最初の月の区切りは、開始日から始まる（月の途中でもよい）。
- `today.included` は今日の分を足したか（`false` は、API トークンが無い・SQL API が失敗した）。`missingDays` は、期間の中で、計測の開始日から昨日までのうち `analytics_rollup` に無い日の数（開始日より前の日は数えない）。
- `previous` は、同じ長さの直前の期間の合計（D1 の集計だけ）。直前の期間が計測の開始日より前に始まるとき（データが足りない）と、`all` のときは `null`。
- `series.bucket` は `7d`・`30d`・`90d` が `day`、`1y` が `week`（月曜始まり）、`all` が `month`。`start` はその区切りの最初の日。区切りの訪問者数は日ごとの訪問者数の合計。
- 一覧（`pages`・`referrers`・`utm`・`rowExpands`・`outbounds`・`readCompletes`・`audience` の各配列）は、期間で合計して `count`（`pages` は `pageViews`）の多い順に上位10件。`(other)` の行は除く（A10 は上位だけを出す）。
- `title` は、`path` が `/{lang}/(works|projects|blog|coding)/{slug}` の形なら、今の D1 の中身（公開中かを問わない）のタイトルを `{ ja, en }` で返す。P1・P6 と、スラッグが今の中身に無いもの（スラッグを変えた・消した）は `null`（A10 はパスを出す）。`rowExpands` の `title` は `itemId` で引く（消したものは `null`）。
- `sectionReach` は、`section_view` の `visitors` ÷ `top_view` の `visitors`（どちらも期間の日ごとの合計）。`profile` から `coding` まで SDD 4.1 の順で全部返し、分母が0なら `rate` は `null`。
- エラー: `INPUT_VALIDATION_FAILED`（`range` が4つ以外）。SQL API の失敗はエラーにせず `today.included: false` にする。D1 の失敗は `INTERNAL_SERVER_ERROR`。

#### `GET /api/admin/dashboard`（変更）

応答に次を足す。

```json
"analytics": { "measuring": true, "pageViews": 210, "visitors": 95 }
```

昨日までの7日（今日は含めない）の、D1 の集計の合計。SQL API は呼ばない（A10 の読み方）。

#### 公開側のサーバー関数（5.11）

`SiteChromeView` に `analyticsBeacon: boolean`（`ANALYTICS_BEACON === 'on'`）を足す。`$lang/route.tsx` のローダーが今どおり読み、送信のモジュールに渡す。`$lang` の下の C1（`$lang` が `ja`・`en` 以外のときを含む）も、読んだ結果を使うので同じく送る。中身を読めなかったとき（C2）と、どのルートにも当たらない C1 は `EMPTY_SITE_CHROME`（`analyticsBeacon: false`）を使うので送らない。

### UI変更

#### A10 アクセス解析（L4）

```
┌──┬──────────────────────────────────────────────────────┐
│  │ アクセス解析                  [7日｜30日｜90日｜1年｜すべて] │
│  │ （計測しない環境: この環境では計測していません。…）         │
│  │ 閲覧 1,234   訪問者 456   外部へ 78                       │
│  │ +12%         +11%        +30%   ← 前の期間との差          │
│  │ 訪問者は日ごとの訪問者数の合計です                         │
│  │ ▁▂▃▅▂▁▃▆▇▅▃▂▁▂▃▅▇  日ごとの推移（閲覧・訪問者）          │
│  │ ページ                          閲覧    訪問者            │
│  │  トップ（/ja）                    520     210              │
│  │  Lab: マイアプリ（/ja/works/my-app） 88   60              │
│  │ 流入元                           件数    訪問者            │
│  │  www.linkedin.com                  40      31              │
│  │ キャンペーン（UTM）                                        │
│  │ P1 のセクション到達率                                      │
│  │  Profile ███████████ 100%                                │
│  │  Career  ████████    72%  …                              │
│  │ 広げた行 ／ 押した外部リンク ／ 最後まで読まれたページ        │
│  │ その他の操作（言語・テーマ・コードのコピー・ページング）      │
│  │ 国 ／ デバイス ／ ブラウザの言語 ／ /ja と /en               │
└──┴──────────────────────────────────────────────────────┘
```

| 要素 | 表示 | 操作 |
|---|---|---|
| 題 | 「アクセス解析」 | — |
| 期間 | セグメント「7日｜30日｜90日｜1年｜すべて」。開いたときの期間は、URL のクエリ `?range=` → このブラウザに覚えた値 → 30日 の順で決める | 押すと、URL のクエリを置き換え（履歴を増やさない）、その値をこのブラウザに覚え、読み直す。クエリ付きで開いたとき（ダッシュボードの要約から `7d` で来たときなど）は、覚えた値を書き換えない（覚えた値を書くのはセグメントを押したときだけ。design-spec 6.7 の表示の切り替えと同じ扱い） |
| 計測しない環境 | 上に「この環境では計測していません。表示しているのは保存済みの集計だけです」 | — |
| 今日の分を読めない | 合計の下に「今日の分を読めませんでした。表示は昨日までです」 | — |
| 集計していない日 | 合計の下に「集計していない日があります（n日）。毎日 0:15 の集計で埋まります」 | — |
| 合計 | 閲覧・訪問者・外部へ（`outbound` の件数）。数字は等幅で桁区切り（管理画面の表記。SDD 9章の「桁区切りは使わない」は公開側の件数とページ番号の決まりなので、A10 には当てない。この点を SDD 9章に書き足す）。下に前の期間との差（`+12%`・`−5%`。前が0なら`—`、`previous` が `null` なら出さない）。下に「訪問者は日ごとの訪問者数の合計です」 | — |
| 推移 | 棒グラフ（区切りごとの閲覧数の棒と、訪問者数の点）。横軸に区切りの最初の日（管理画面の日付の表記） | 棒にポインターを乗せる・フォーカスすると、その区切りの日付・閲覧・訪問者をツールチップで出す |
| ページ | 表: ページ（タイトルとパス。タイトルは日本語、なければ英語。種類の名前（1.4 のセクションの名前）を頭に付ける。タイトルが無ければパスだけ）、閲覧、訪問者 | パスは公開サイトのそのページへのリンク（別タブ） |
| 流入元 | 表: ホスト名（空の参照元は「直接・不明」として別に出さない。記録しないので表に無い）、件数、訪問者 | — |
| キャンペーン（UTM） | 表: source / medium / campaign、件数、訪問者。0件なら節ごと出さない | — |
| P1 のセクション到達率 | セクションの名前（1.4）と、横の棒と割合。分母が0なら`—` | — |
| 広げた行 | 表: 種類（セクションの名前）・タイトル（消したものは「削除済み」）、件数、訪問者 | — |
| 押した外部リンク | 表: 種類（サイトを見る・GitHub・SNS・使用技術・参考リンク・本文のリンク）・ホスト名、件数、訪問者 | — |
| 最後まで読まれたページ | 表: ページ（「ページ」の表と同じ見せ方）、件数、訪問者 | — |
| その他の操作 | 言語の切り替え（日本語へ・英語へ）、テーマの切り替え（OSに合わせる・ライト・ダーク）、コードのコピー、ページング（セクションごと）の件数 | — |
| 国・デバイス・ブラウザの言語・/ja と /en | 4つの小さな表（名前、閲覧、訪問者）。国の名前は `Intl.DisplayNames`（日本語）で出し、`XX` は「不明」 | — |

- 各表は上位10件。0件の表は「まだありません」を1行出す（セクションごと消さない。A10 は持ち主が全体を見渡す画面なので、空であることも見せる）。例外はキャンペーン（使わない人には常に空なので、0件なら出さない）。
- 管理画面の原則（一覧性）に合わせ、カードの枠を使わず、区切り線と見出しで分ける。表は 6.6 の一覧のテーブルと同じ見た目。
- グラフは SVG を部品で描き、色は既存のセマンティックトークン（閲覧の棒は `text.muted` 相当の無彩色、訪問者の点は `text.default`）で付ける。アクセントは使わない（design-spec 4.4 のアクセントの用途に入らない）。値はトークンを通す。グラフの SVG は `aria-hidden` にし、同じ値を読み上げ用の表（見えない）で持つ。
- モバイル（<768px）: 合計は縦に積み、表は主要な列（名前と閲覧／件数）だけを残す。グラフは横にスクロールせず、幅に合わせて棒を細くする。

| 状態 | 表示 |
|---|---|
| 読み込み中 | 合計・グラフ・表にスケルトン |
| 取得に失敗 | 「読み込めませんでした」と「再試行」 |
| 期間にデータが無い | 合計を0で出し、グラフの場所に「この期間のデータはまだありません」 |

#### A2 ダッシュボード

件数カードの上に1行の要約を足す: 「昨日までの7日　閲覧 210・訪問者 95　アクセス解析を見る →」（リンクは A10 の `?range=7d`）。計測しない環境では後ろに「（この環境では計測していません）」を足す。読み込み中は1行のスケルトン、取得に失敗したときはダッシュボード全体の今の扱い（「読み込めませんでした」と「再試行」）に含める。

#### サイドメニュー

並びを「ダッシュボード、プロフィール、Career、Projects、Lab、Tech Stack、Blog、Coding Log、アクセス解析」にする（プライバシーの FDD が先に入っていれば、「アクセス解析」は Coding Log と「プライバシー」の間）。アイコンは折れ線のグラフ。

#### 公開側

見た目は変えない。送信のモジュールは公開側のバンドルに入る（大きさは Goal 7 の Lighthouse で確かめる）。`ANALYTICS_BEACON` が `on` でなければ、イベントのリスナーも置かない。

### 個人情報（SDD 7章の「個人情報」の行に入れる内容）

訪問者について持つのは、Analytics Engine の1件（ページのパス、イベントの値、流入元のホスト名、UTM、国、デバイスの種類、ブラウザの言語、日ごとの訪問者のハッシュ。3か月で消える）と、D1 の日ごとの集計（訪問者を区別できる値を含まない）だけ。IP・User-Agent・Cookie・端末の識別子は残さない。ハッシュの元にする日ごとの値は KV に置き、日本時間のその日の終わりから10分以内に期限切れで消える（戻す仕組みは無い）。管理者・ボット・DNT・GPC の送信は記録しない。集める項目と保持は、プライバシーのページ（`docs/features/20261010-1346_privacy-page.md`）で訪問者に示す。

### データマイグレーション

スキーマ差分（`src/db/schema.ts`）:

```ts
// src/db/enums.ts
export const ANALYTICS_DIMENSIONS = [
  'total', 'page', 'referrer', 'utm', 'country', 'device', 'browser_lang', 'site_lang', 'top_view',
  'section_view', 'read_complete', 'row_expand', 'paging', 'outbound', 'outbound_total',
  'lang_switch', 'theme_switch', 'code_copy',
] as const

// ---- analytics_daily --------------------------------------------------
/** 解析の日ごとの集計（ADR-023）。Cron だけが書く。id・created_at・updated_at は持たない（行は日と次元とキーで決まり、Cron が日ごとに丸ごと書き直すので、更新の日時に意味が無い。SDD 6.1 の例外） */
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

// ---- CHECK 制約の部品（既存の yearMonthFormat の隣に置く） --------------
const dateFormat = (col: unknown) =>
  sql`${col} glob '[0-9][0-9][0-9][0-9]-[01][0-9]-[0-3][0-9]' and substr(${col}, 6, 2) between '01' and '12' and substr(${col}, 9, 2) between '01' and '31'`
```

- `visitors <= count` は、どの次元でも1人が少なくとも1件を送るので成り立つ（`(other)` の行も、上位に入らなかった行の合計どうしなので成り立つ）。
- `dimension` の CHECK は値の一覧を持つので、次元を足すときは CHECK を変えるマイグレーションになり、drizzle-kit はテーブルを作り直す SQL を出す。`analytics_daily` は外部キーを持たず、ほかのテーブルからも参照されないので、作り直しで行が消える心配（ADR-007）は無い。

1. 新しいテーブルを足すだけなので、既存のテーブルを作り直す SQL は出ない見込み。`make db-generate`（drizzle-kit 0.31.11）の出力を読み、`CREATE TABLE` と `CREATE INDEX` だけであることを確かめる（ADR-007・`docs/03_dev-setup.md` 4章）。
2. 既存のデータの移行は無い。本番の `analytics_daily`・`analytics_rollup` は空で始まり、計測を始めた日の翌日の Cron から行が入る（計測の開始日は Cron が Analytics Engine から決める。上の「Cron での集計と保持」）。
3. 古いコードとの両立: 古いコードは新しいテーブルを読まず書かないので、そのまま動く（`docs/03_dev-setup.md` 4章の前進のみの決まり）。
4. ロールバック: アプリを戻す（昇格 PR の revert）と、受け口・Cron・A10 が無くなり、テーブルは残る。消したいときは、テーブルを消すマイグレーションを足す（前進のみ）。Analytics Engine のデータセットは、書かれなくなるだけで3か月で消える。KV の値は期限で消える。Cron のトリガー: デプロイは `wrangler deploy`（`docs/04_deployment-procedure.md` 2章）で、そのときの設定の `triggers` を反映する。`triggers` を書かない古い版をデプロイしたときに既存の Cron が外れるかはスパイクで確かめ、外れないなら、ロールバックの手順に Cron を外す操作（持ち主が `docs/04_deployment-procedure.md` の手順で行う）を足す。外れずに残ると、`scheduled` を持たない古い版で毎日失敗の記録が出る。
5. シード（`scripts/seed/`）: ローカルの `analytics_daily`・`analytics_rollup` に、シードを流した日（日本時間）の前日までの400日ぶんのデモの集計を入れる（`1年`・`すべて` の推移と、`30d` の前の期間との差が出るように）。
   - 値は固定の種（シード値）の擬似乱数で作り、同じ日に流せば同じ値になる。日付は流した日に連動するので、E2E は数値を固定で書かず、API の応答と画面の表示が一致することを確かめる。
   - 1日の行: 全次元をそろえる。`page` は公開中のデモの中身のパス（P1・P2〜P5 から10件）、`referrer` 5件、`utm` 2件、`country` 4件（JP・US・PH・XX）、`device` 3件、`browser_lang` 3件、`site_lang` 2件、`section_view` 7件、`read_complete` 5件、`row_expand` 5件（デモの作品・プロジェクトの ID）、`paging` 3件、`outbound` 6件（各 `linkKind`）、`lang_switch`・`theme_switch`・`code_copy` 各2〜3件。1日約60行、全体で約2万4千行。
   - `missingDays` を確かめるため、3日前を `analytics_rollup` から抜く（その日の `analytics_daily` の行も入れない）。
   - insert は1文に20行ずつに分ける（ADR-006 の100個の上限）。`scripts/seed/insert.ts` の消すテーブルの並びに2つのテーブルを足す。`scripts/seed/data.test.ts` に、行の CHECK（`visitors <= count`、空のキーの規則）を満たすことと、抜いた日の検査を足す。
   - `make db-seed-empty` でも同じ集計を入れる（ブログ・記録の0件と解析は関係しないため）。design-spec 8章に「analytics_daily・analytics_rollup | 400日 | 上の内容」を足す。

### `wrangler.jsonc`

```jsonc
// トップレベル（ローカル）
"vars": { "ENVIRONMENT": "local", "SITE_URL": "http://localhost:3000", "ANALYTICS_BEACON": "on" },
"ratelimits": [
  // 既存の2つ
  { "name": "COLLECT_RATE_LIMITER", "namespace_id": "1003", "simple": { "limit": 120, "period": 60 } }
],
// env.staging: "ANALYTICS_BEACON": "off"、COLLECT_RATE_LIMITER の namespace_id 2003
// env.production:
"vars": { /* 既存 */ "ANALYTICS_BEACON": "on", "CF_ACCOUNT_ID": "<アカウント ID>" },
"analytics_engine_datasets": [{ "binding": "ANALYTICS", "dataset": "eastx_analytics" }],
"kv_namespaces": [{ "binding": "ANALYTICS_SALTS", "id": "<KV の namespace の ID>" }],
"triggers": { "crons": ["15 15 * * *"] },
// COLLECT_RATE_LIMITER の namespace_id 3003
```

- `namespace_id` は、今の採番（環境ごとの千の位: ローカル 1xxx・staging 2xxx・本番 3xxx。下の桁はバインディングの順）に合わせて 1003・2003・3003。
- `ANALYTICS`・`ANALYTICS_SALTS` は本番にだけあるので、型（`wrangler types` が作る `Env`）で省けるもの（`ANALYTICS?`）になるかを確かめる（スパイク）。全環境に共通の型として必ずあるものになる場合は、コードで `'ANALYTICS' in env` を確かめてから使う部品（`src/api/analytics/binding.ts`）を1つ置き、ほかから直接読まない。計測しているか（`measuring`）は、2つのバインディングが両方あるときだけ真にする。
- `ANALYTICS_API_TOKEN` はシークレット（本番だけ。`.dev.vars` は空、staging は登録しない）。コードは未登録（`undefined`）と空文字の両方を「無い」として扱う。

### 実装の最初に確かめること（スパイク。結果は SDD ADR-022 の表に記録する）

| 確かめること | 駄目だったときの代わり |
|---|---|
| `@cloudflare/vitest-pool-workers`（0.22.0）で、テストの設定に Analytics Engine のバインディングを足し、`writeDataPoint` の呼び出しを確かめられる | 書き込みの部品をバインディングを受け取る関数にし、結合テストでは記録用の偽のバインディングを渡す |
| `withSentry`（`@sentry/cloudflare`）で包んだ `scheduled` が動き、例外が Sentry に送られる。結合テストから `scheduled` のハンドラーを呼べる | 集計の関数を直接呼ぶテストにし、`scheduled` は集計の関数を呼ぶだけの薄い形にする |
| SQL API で、訪問者のハッシュの種類の数を数えられる（`count(DISTINCT blob14)` など）。`_sample_interval` の扱い | （キー, ハッシュ）の組を `GROUP BY` で読み、Worker で数える |
| SQL API の日時の条件（日本時間の日の境目を UTC の時刻で書く）と、`blob` の空文字の扱い | 結果を Worker で絞る |
| 本番だけに書いたバインディングが `Env` の型で省けるものになる | `src/api/analytics/binding.ts` で有無を確かめる（上） |
| Workers KV で、期限の切れた値・消した値を利用者が戻す仕組みが無い（公式の文書） | 仕組みがあるなら、持ち主に置き場所を選び直してもらい、この FDD と個人情報の段落を直す |
| wrangler 4.147.0 の `wrangler deploy` で、`triggers` を書かない設定をデプロイしたときに既存の Cron が外れるか（公式の文書・wrangler のソース） | 外れないなら、ロールバックの手順に Cron を外す操作を足す（データマイグレーションの4） |
| SQL API でデータセットの最も古い `timestamp` を読める（計測の開始日） | 開始日を D1 の新しい表に残す形に変え、この FDD を直す |

## テスト方針

| テスト種別 | 対象 |
|-----------|------|
| Unit | `src/domain/analytics/`: イベントの値の検査（種類ごとのキーの過不足、各値の規則、4KB）、訪問者のハッシュ（IPv6 の上位64ビットが同じなら同じ値、日付か日ごとの値が違えば違う値、IPv4 埋め込みの IPv6 は IPv4 として扱う）、日ごとの値の期限（日本時間の日の終わり＋10分の UNIX 時刻）、ボットの判定（Sentry・Lighthouse・HeadlessChrome・主なクローラーを除き、普通のブラウザを通す）、デバイスの判定、流入元のホスト名への正規化と自分のホストの除外、UTM の正規化、日本時間の日付（UTC の 15:00 の前後）、期間（`7d`〜`all`。`1y` は365日）と前の期間・区切り（週は月曜始まり、月、`all` の最初の月は開始日から）の計算、`missingDays` と `previous` が `null` になる条件、計測の開始日の決め方、集計する日の選び方（昨日・一昨日と未集計の日、7日まで）、上位100件と `(other)` へのまとめ、20行ずつの文への分け方。送信のモジュールの規則（DNT・GPC・`webdriver` で送らない、`page_view` は前回と違う `path` だけ、ハッシュだけの移動で送らない、bfcache から戻ったら送る、`referrer`・`utm` は最初の1回だけ）。A10 の期間の決め方（クエリ → 覚えた値 → 30日、クエリでは覚えた値を書き換えない） |
| Integration | `POST /api/collect`: 正しい本文で 204 と1件の書き込み（バインディングの値の並び）、除外（DNT・GPC のヘッダー、ボット、管理者のセッション）で書かずに 204、管理者でないセッションは書く、バインディングが無いと書かずに 204、400（大きすぎる・形の誤り・余分なキー）、403（違う Origin）、404（POST 以外）、429。日ごとの値: KV に無ければ作って期限付きで置く、あれば KV の値を使う、同じ isolate の2回目は KV を読まない。`scheduled`: SQL API の応答を `fetchMock` で返し、`analytics_daily`・`analytics_rollup` に入る、同じ日の2回目で結果が変わらない（昨日・一昨日の集計し直し）、`analytics_rollup` が空なら最も古い `timestamp` の日から始め、それより前の日を入れない、0件の日も `analytics_rollup` に入る、7日を超える未集計は7日で止まる、SQL API の失敗でその日が `analytics_rollup` に入らない、明日の日ごとの値を KV に作る。`GET /api/admin/analytics`: 未認証 401・管理者でないセッション 403（認可マトリクス）、`range` の誤りで 422、D1 の集計からの合計・区切り・上位10件・タイトルの引き当て（消した中身は `null`）、`ANALYTICS_API_TOKEN` が未登録・空で `today.included: false`、SQL API が3秒で応答しないと `today.included: false`、`measuring`。`GET /api/admin/dashboard` の `analytics`（SQL API を呼ばない）。マイグレーションの後の2つのテーブルの CHECK（日付の範囲、`visitors <= count`、空のキーの規則） |
| E2E | 公開側（ローカルは `ANALYTICS_BEACON=on`）: Playwright で `/api/collect` への送信を待ち、P1 を開くと `page_view`（`referrer` 付き）、スクロールで `section_view`、行を広げて `row_expand`、ページングで `paging`、詳細へ移って `page_view`（`referrer` 無し）、本文の最後まで送って `read_complete`、GitHub のリンクで `outbound`（`github`）、言語・テーマの切り替え、コードのコピーで、それぞれの本文が送られる。`$lang` の下の C1（`/ja/works/none` と `/fr/foo`）で `page_view` が送られ、受け口が 204 を返す。Playwright の Chromium の User-Agent はボットの判定に当たるが、送信のモジュールはブラウザ側の `webdriver` を見るので送らない。E2E では `navigator.webdriver` を偽にする初期化スクリプトを入れて送信を確かめる（受け口は User-Agent で除外するので、書き込みは起きない。ローカルはそもそもバインディングが無い）。管理画面: シードの集計で A10 が出る（期間の切り替えで合計と推移が変わる、ページ・流入元・広げた行・押した外部リンク・最後まで読まれたページ・その他の操作・国・デバイス・ブラウザの言語・/ja と /en の各表が API の応答と一致する、到達率、「集計していない日があります（1日）」、「この環境では計測していません」）、A2 の要約から A10 の `7d` へ移り、覚えた期間が変わらない、サイドメニューの並び |
| アクセシビリティ | A10（ライト・ダーク）を axe の対象に足す。期間のセグメントとグラフのツールチップをキーボードで操作できる |
| Lighthouse | 今の対象のまま。送信のモジュールを足しても目標を保つ（ローカルのプレビューは `on` で、受け口は 204 を返す） |

## ロールアウト計画

1. プライバシーのページ（`docs/features/20261010-1346_privacy-page.md`）は、この変更と同じ昇格で staging・本番に出す（持ち主の決定、2026-10-10。昇格を1回ずつにまとめる）。本番は出た時点で計測を始め、A11 も同じデプロイで出るので、5 で本文を保存するまでの数分は告知の無いまま計測する。
2. 実装の最初にスパイク（詳細設計の表）を行い、結果で駄目だったときの代わりに切り替えたら、この FDD と SDD を先に直す。
3. 持ち主が `docs/04_deployment-procedure.md` 3章（この変更で足す手順）に沿って、Cloudflare で API トークンを作る（権限は Account Analytics: Read だけ、対象はこのアカウント）、`wrangler secret put ANALYTICS_API_TOKEN --env production` で登録する、本番の KV の namespace を作る。KV の ID と `CF_ACCOUNT_ID` を `wrangler.jsonc` の本番に書く（実装のセッションは本番の資格情報を使わない。CLAUDE.md）。
4. `main` にマージし、staging に昇格する。staging で確かめること: 公開側が送信しない（`ANALYTICS_BEACON=off`）、A10・A2 が「この環境では計測していません」と0件で出る、マイグレーションが適用される。
5. 本番に昇格し、デプロイの直後に、本番の A11 でプライバシーのページの本文に解析のこと（集める項目・保持・除外）を書いて保存する。
6. 本番のデプロイの後に確かめること: 自分のブラウザ（管理者のセッションがある）で開いても A10 の今日の分が増えない。管理者のセッションの無いブラウザ（プライベートウィンドウ）で P1 を開き、数分後に A10 の今日の分に `page_view` が出る。Workers Logs に `/api/collect` の 5xx が無い。
7. 翌日の 00:15 以降に、A10 の昨日が `analytics_rollup` に入っている（`missingDays` が0）、Cron の失敗が Sentry に無いことを確かめる。
8. ロールバック: 昇格 PR の revert。テーブルは残り、Analytics Engine のデータは3か月で消え、KV の値は期限で消える。Cron のトリガーが外れたかを確かめ、残っていれば外す（データマイグレーションの4）。解析を戻した後に、持ち主が A11 でプライバシーのページの解析の記述を戻す（告知を消すのは計測を止めた後）。

## 実装で決めた細部

実装の最初のスパイク（詳細設計の表）の結果と、実装で FDD の記述から変えた細部。結果は SDD ADR-022 の表に記録した。

### スパイクの結果

| 確かめること | 結果 | 取った形 |
|---|---|---|
| vitest-pool-workers 0.22.0 で Analytics Engine のバインディング | テストの設定（`miniflare.analyticsEngineDatasets`・`kvNamespaces`）に足せ、`writeDataPoint` を `vi.spyOn` で確かめられる。env から外せば「バインディングが無い」も試せる | 予定どおり。ただし 0.22.0 は `fetchMock` を持たないので、SQL API は `vi.spyOn(globalThis, 'fetch')` で返す |
| `withSentry` の `scheduled` | @sentry/cloudflare 11.4.0 は `scheduled` も包み、例外を送る。`src/server.ts` は TanStack Start の仮想モジュールに依存して結合テストから import できない | 駄目だったときの代わり: `scheduled` は `runAnalyticsCron`（`src/api/analytics/rollup.ts`）を呼ぶだけにし、それを結合テストで呼ぶ |
| SQL API の訪問者の種類の数・`_sample_interval` | `count(DISTINCT)` がある。サンプリングは index ごとに均す | 件数は `SUM(_sample_interval)`、訪問者数は `COUNT(DISTINCT blob14)` |
| 日時の条件・空の blob | `toDateTime(UNIX 秒)` がある。値の無い blob の扱いは文書に無い | 14個の blob を空文字も含めて必ず書き、`blob4 != ''` が書いた値どおりに当たるようにした |
| 本番だけのバインディングの `Env` の型 | wrangler 4.147.0 の `wrangler types` で `ANALYTICS?`・`ANALYTICS_SALTS?`・`CF_ACCOUNT_ID?` になる | `src/api/analytics/binding.ts` は置かない。使う側で `undefined` を確かめる（`isMeasuring`・`sqlApiConfigOf`） |
| KV の期限切れの値を戻す仕組み | 公式の文書に、期限が来た値は消えて読めなくなることだけがあり、戻す仕組みの記述は無い | 予定どおり KV |
| `triggers` を書かない設定のデプロイで Cron が外れるか | wrangler 4.147.0 は `triggers.crons` が無ければ Cron の設定を送らず、既存の Cron が残る（ビルドの出力も `"triggers":{}`） | ロールバックの手順（`docs/04_deployment-procedure.md` 5章）に、ダッシュボードで Cron を外す操作を足した |
| 最も古い `timestamp` | `MIN(timestamp)` が使える | 予定どおり（`COUNT()` と一緒に読み、0件なら開始日なし） |

本番の SQL API の実際の応答（数が文字列で返るか、`MIN(timestamp)` の書式）は、デプロイの後の確認（ロールアウト計画の6・7）で確かめる。読む側は数の文字列と数値の両方、`timestamp` は UTC の `YYYY-MM-DD hh:mm:ss` を受ける。

### 細部の変更

- C2: FDD は `EMPTY_SITE_CHROME` で送らないとしていたが、子のルートの失敗の C2 は `$lang` のレイアウトの中に描かれ、読めた `SiteChromeView` のまま出る。送信の部品がルーターの状態（失敗したマッチ）を見て、C2 のあいだは何も送らないようにした（SDD 5.11・5.14）。
- 日ごとの値の isolate の中のキャッシュは5分で読み直す。いつまでも持つと、その日の最初の数十秒に拠点ごとに別の値ができたとき、伝わり終えた後も負けた値を使い続ける（「伝わり終えた後はどの拠点も同じ値を使う」を満たすため）。
- 推移のグラフの訪問者数は「点」ではなく棒の上の横線にした。SVG を幅いっぱいに伸ばす（`preserveAspectRatio="none"`）と円がつぶれるので、線の太さだけを画面の太さに保つ（`vector-effect="non-scaling-stroke"`）横線にした。
- デザイントークンを2つ足した: `size.chart`（推移のグラフの高さ）、`size.meter`（到達率の横の棒の太さ）。既存のセマンティックトークンに当てはまる大きさが無かった。色は既存のトークン（`text.muted`・`text.default`・`bg.muted`）。
- グラフのツールチップは、棒の上に区切りごとのボタンを重ね、Tab で1つに入り ← → Home End で移る（ボタンの読み上げ名に同じ値を入れる）。`Tooltip` に `openDelay` を足し、すぐに出す。
- 前の期間との差が0は `±0%`。`otherActions.paging` は5つのセクションを0件も含めて返す。到達率のプロフィールの名前は「Profile」。
- UTM の値に `|` があれば受け口は 400（記録の区切りに使うため）。ブラウザは `|` を含む値と100字を超える値を送らず、2,048字を超える参照元は origin にして送る（1件ごと捨てられないように）。
- User-Agent の無い送信はボットとして扱う。
- 集計する日の起点（計測の開始日）は、`analytics_rollup` に行があってもその最も古い日だけにせず、Analytics Engine の最も古いイベントの日との早い方にした。FDD の「`analytics_rollup` に行があれば、その最も古い日を開始日とする」では、最初の日の集計が2回失敗して翌日が先に確定すると、最初の日が起点の外に落ちて埋まらず、Goal 4（取りこぼしは次の実行で埋まる）を満たさない。A10 の計測の開始日（`all`・前の期間・`missingDays`）は `analytics_rollup` の最も古い日のまま。
- 流入元のホスト名は、ホスト名の形のものだけを記録し、ほかは空にする（閲覧は数える。末尾の点は除く）。`http://(other)/` は URL としては正しく、ホスト名が集計の予約のキー `(other)` になり、上位と `(other)` が2行になってその日の書き込みが主キーで落ちる。あわせて、上位100件と `(other)` へのまとめで、`(other)` と同じキーの行は残りに入れる。`path` は `//` で始まるもの・`\` を含むものを受け付けない（A10 のリンクが別のホストを指す）。
- 送信の部品の状態（前回の `path`、参照元を送ったか）は文書ごとに1つ持つ。`$lang` 自身の C1 と画面を行き来すると公開側のレイアウトが作り直され、参照元を二度送るため。
- 本文の最後とセクションの見出しの観測は、表示し終えたページ（ルーターの `resolvedLocation`）が変わったときに置き直す。ルーターの `location` は移動の始まり（前のページを描いたまま）で変わり、前後のナビを押した直後に前のページの印を次のページの読了として送ってしまう。
- 受け口がその日の値を KV に書けなくても（同じキーへの書き込みは1秒に1回まで）、作った値でその送信を数え、WARN のログを出す。SQL API の応答の数・キーが読めないときは0件にせず例外にし（その日を確定させない）、A10 が今日の分を読めなかった原因は WARN のログに出す。
- A10 の一覧・到達率・属性は、日ごとの行を D1 で次元とキーごとに合計して読む（`GROUP BY`）。日ごとの行で読むのは合計と推移の次元だけにし、期間が長くなっても読む行を増やさない。
- 1年の週の区切りの最初は、期間の最初の日から始める（「すべて」の最初の月と同じ扱い）。
- 送るときの表（詳細設計の「イベント」）は画面に見える振る舞いではないので、design-spec ではなく SDD 5.14 に置いた。5章の新しい節は、プライバシーが 5.12 を取ったので 5.13（A10）・5.14（受け口）。
- E2E: Playwright の `Desktop Chrome` の User-Agent は `HeadlessChrome` を含まず、ボットの判定に当たらない（どちらにしてもローカルはバインディングが無いので書かない）。`sendBeacon` の要求は Playwright から本文が読めない（ping の `postData` が null）ので、テストは初期化のスクリプトで `sendBeacon` を包んで本文を受け取り、要求そのものは送って受け口の 204 を確かめる。
- E2E のローカルの D1 は、テストの終わりにフィクスチャ（別のプロセス）がセッションを消すのと、プレビューがまだ読んでいる A10 の要求が重なると、miniflare が `internal error` を返す（SQLite のロック。`playwright.config.ts` の注記と同じ原因で、本番の D1 では起きない）。A10 を開くテストは、読み込みを終えて（推移のグラフが出て）からテストを終える。
