# Deployment Procedure — eastx

構成は `docs/02-01_system-design-doc.md`（以下 SDD）、ブランチ戦略とリリースフローの方針は `docs/03_dev-setup.md` 9章。このドキュメントは、デプロイの仕組み・初回の準備・リリースとロールバックの手順を持つ。

## 1. 環境一覧

| 環境 | URL | サービス | DB | デプロイ方法 |
|------|-----|----------|-----|-------------|
| ローカル | http://localhost:3000 | `make dev`（Vite ＋ Cloudflare プラグイン、workerd） | ローカルの D1（`.wrangler/state/`）、ローカルの R2 | なし |
| staging | https://x-staging.eastasian.dev | Worker `eastx-staging`（`wrangler.jsonc` の `env.staging`） | D1 `eastx-db-staging`、R2 `eastx-media-staging` | 昇格 PR（`deploy/staging/version`）のマージ |
| 本番 | https://x.eastasian.dev | Worker `eastx`（`env.production`） | D1 `eastx-db`、R2 `eastx-media` | 昇格 PR（`deploy/production/version`）のマージ |

- staging のデータは、本番と同じ移行の手順で入れたもの（本番の移行の予行を兼ねる。3章 Step 7）と、確認のために管理画面で入れたもの。デモデータ（design-spec 8章）はローカルと E2E だけで使う。本番は今のサイトから移したデータで動かす（design-spec 9章）。
- staging は検索エンジンに載せない（SDD ADR-019）。

## 2. CI/CD パイプライン

リリースは、環境ごとのバージョン宣言ファイル `deploy/{環境}/version`（中身は `main` のコミット SHA）の更新をきっかけにする。**`main` へのマージではデプロイしない。**

```
[feature/fix の PR]
    └── ci.yml（lint → 型 → テスト → ビルド → E2E）

[main へ squash マージ]
    └── ci.yml（同上。デプロイはしない）

[昇格 PR（deploy/staging/version を更新）]
    ├── ci.yml の promotion-check（SHA が main の祖先か）
    └── マージ → deploy.yml → staging にデプロイ

[昇格 PR（deploy/production/version を更新）]
    ├── ci.yml の promotion-check（SHA が main の祖先で、staging に出したことがあるか）
    └── マージ → deploy.yml → 本番にデプロイ
        （ロールバック ＝ 昇格 PR の revert）
```

### CI/CD ワークフロー

**ci.yml**（全 PR と `main` への push）:

```
bun install（--frozen-lockfile）→ make lint → make typecheck → make test → make build → make e2e
```

E2E の前に `.dev.vars.example` から `.dev.vars` を作り、`ADMIN_GITHUB_USER_ID` に固定の ID を入れる（管理者のセッションのフィクスチャが使う。GitHub には行かないので実在しない ID でよい。`docs/03_dev-setup.md` 7章）。

`deploy/*/version` を変えた PR では、promotion-check（`scripts/promotion-check.sh`）を走らせる。判定には PR の側ではなく `main` のスクリプトを使う（PR がスクリプトを書き換えて自分の確認を通せないように）。`deploy/*/version` だけを変えた PR では、上のコードの検査を省く。

- 書かれた値が40桁の SHA で、`main` の祖先であること
- 本番のときは、その SHA が `main` の `deploy/staging/version` の過去の値（第1親の履歴。`git log --first-parent -p deploy/staging/version`）にあること。同じ PR で staging と本番を同時に書き換えても、本番は通らない。昇格 PR をマージコミットで入れても、PR ブランチの途中のコミットの値は数えない

**deploy.yml**（`main` への push で、`deploy/*/version` が変わったとき。手動実行では、選んだ環境をもう一度デプロイする）:

```
変わった環境ごとに:
  1. その時点の main の deploy/{環境}/version から SHA を読み、その SHA をチェックアウト
  2. bun install（--frozen-lockfile）
  3. D1 のマイグレーションを適用（wrangler d1 migrations apply DB --env {環境} --remote）
  4. CLOUDFLARE_ENV={環境} でビルド（make build）
  5. wrangler deploy（メッセージに SHA を入れる）
  6. 疎通確認（その環境の SITE_URL で /ja・/en が 200、/api/auth/get-session が 200）
```

- マイグレーションはビルドの前に当てる。ビルド後は Cloudflare プラグインが書き出したデプロイ用の設定が優先され、`--env` が効かなくなるため。
- マイグレーションが失敗したら、その時点で止まる（デプロイしない）。
- 同じ環境のデプロイが重ならないよう、`concurrency: deploy-{環境}` を付ける。待っているデプロイは最新の1つだけが残り、走る順は push の順と限らないので、SHA は起動したコミットではなくその時点の `main` から読む。
- push の前の `main` が取れない（`main` の作成、force push）ときは、変わった環境が決まらないので止まる。Actions の手動実行で環境を選んでデプロイする。
- デプロイのジョブは GitHub の Environment（`staging` ／ `production`）で走り、Cloudflare のシークレットはそこから読む（3章 Step 6）。シークレットを渡すのはマイグレーションとデプロイのステップだけにする。

## 3. 初回クラウドセットアップ

IaC ツールは使わず、wrangler CLI とダッシュボードで準備し、結果を `wrangler.jsonc` に書く（SDD ADR-017）。手元で `bunx wrangler login` してから行う。

### Step 1: Cloudflare アカウントとドメイン

1. Cloudflare のアカウントで Workers Paid プランに入る（SDD ADR-002）。
2. `eastasian.dev` をゾーンとして追加し、レジストラーでネームサーバーを Cloudflare のものに変える（すでに Cloudflare なら不要）。
3. `x` と `x-staging` の DNS レコードが既にあれば消しておく（Custom Domain を作るときにぶつかるため）。

### Step 2: D1・R2・KV を作る

```bash
# D1（場所のヒントはアジア太平洋）
bunx wrangler d1 create eastx-db-staging --location apac
bunx wrangler d1 create eastx-db --location apac

# R2（場所のヒントはアジア太平洋）
bunx wrangler r2 bucket create eastx-media-staging --location apac
bunx wrangler r2 bucket create eastx-media --location apac

# KV（本番だけ。解析の訪問者のハッシュに混ぜる日ごとの値。SDD ADR-023）
bunx wrangler kv namespace create eastx-analytics-salts
```

出てきた D1 の `database_id` を、`wrangler.jsonc` の `env.staging` と `env.production` に書く（`docs/03_dev-setup.md` 5章）。R2 は公開アクセスを有効にしない（Worker の `/media/*` から配信する。SDD ADR-010）。KV の `id` は `env.production` の `kv_namespaces` に、Cloudflare のアカウント ID（ダッシュボードの Workers & Pages の右側、または `bunx wrangler whoami`）は `env.production` の `vars.CF_ACCOUNT_ID` に書く。Analytics Engine のデータセット（`eastx_analytics`）は作らなくてよい（最初の書き込みで作られる）。

### Step 3: GitHub の OAuth App（staging 用・本番用）

`docs/03_dev-setup.md` 6章と同じ手順で、2つ作る。

| OAuth App | Homepage URL | Authorization callback URL |
|---|---|---|
| `eastx (staging)` | `https://x-staging.eastasian.dev` | `https://x-staging.eastasian.dev/api/auth/callback/github` |
| `eastx` | `https://x.eastasian.dev` | `https://x.eastasian.dev/api/auth/callback/github` |

Client ID は `wrangler.jsonc` の各環境の `vars.GITHUB_CLIENT_ID` に、自分の GitHub の数値 ID は `vars.ADMIN_GITHUB_USER_ID` に書く。

### Step 4: シークレットを登録する

```bash
# staging
bunx wrangler secret put BETTER_AUTH_SECRET --env staging     # openssl rand -base64 32 の出力
bunx wrangler secret put GITHUB_CLIENT_SECRET --env staging

# 本番（staging とは別の値にする）
bunx wrangler secret put BETTER_AUTH_SECRET --env production
bunx wrangler secret put GITHUB_CLIENT_SECRET --env production
# 解析の SQL API のトークン（本番だけ。staging には登録しない）
bunx wrangler secret put ANALYTICS_API_TOKEN --env production
```

Worker がまだないときは、`secret put` が Worker を作るか聞いてくるので、作ってよい。

`ANALYTICS_API_TOKEN` は、Cloudflare のダッシュボードの My Profile → API Tokens → Create Token → Custom token で作る。権限は Account → Account Analytics → Read だけ、Account Resources はこのアカウントだけにする（A10 の今日の分と Cron の集計が Analytics Engine の SQL API を読むのに使う。SDD ADR-023）。期限を付けたときは、切れる前に作り直して登録し直す（`docs/05_operation-runbook.md` 6章）。

### Step 5: Sentry

1. Sentry にプロジェクト（プラットフォームは Cloudflare Workers）を作り、DSN を `wrangler.jsonc` の各環境の `vars.SENTRY_DSN` に書く。
2. SDD 11章の設定で Uptime Monitoring を作る（アラートの条件は `docs/05_operation-runbook.md` 2章）。
3. アラートの通知先を自分のメールにする。

### Step 6: GitHub の Environment・シークレット・ルールセット

リポジトリの Settings → Environments で `staging` と `production` を作り、それぞれの Deployment branches and tags を `main` だけにする。シークレットはリポジトリではなく、両方の Environment に登録する（リポジトリのシークレットは、push できる人がほかのブランチのワークフローから読めるため）。リポジトリのシークレットに同じ名前のものがあれば消す。

| Secret 名 | 内容 |
|----------|------|
| `CLOUDFLARE_API_TOKEN` | Cloudflare の API トークン。テンプレート「Edit Cloudflare Workers」に、D1 の Edit を足したもの（Workers Scripts・Workers Routes・Workers R2 Storage・Workers KV Storage・D1・Account Settings の読み取り。KV のバインディングと Cron のトリガーもデプロイで設定する） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウント ID |

Settings → Rules → Rulesets で `main` のルールセットを作り、PR を必須にし、ステータスチェック `ci` と `promotion-check`（ワークフロー ci.yml のジョブ）を必須にする。バイパスは誰にも許さない。promotion-check を通らない昇格 PR はこれでマージできなくなる（deploy.yml は確認をやり直さない）。`if:` で飛ばされたジョブは成功として扱われるので、昇格でない PR も止まらない。

### Step 7: 最初のデプロイとデータの移行

1. Step 2〜5 の値を書いた `wrangler.jsonc` を、通常の PR で `main` に入れる。
2. `make promote ENV=staging` で昇格 PR を作ってマージする。最初の昇格 PR なので、ci の promotion-check と、マージ後の deploy.yml が通ることをここで確かめる。Custom Domain（DNS レコードと証明書）はこのデプロイで作られる。
3. https://x-staging.eastasian.dev/admin から GitHub でログインする（初回のログインで管理者が登録される。SDD ADR-009）。この時点では中身が空で、トップには何も出ない。
4. staging にデータを移す（本番の予行）。リポジトリのルートで、変換スクリプト（`scripts/migrate-legacy/`）で今のサイトから取り出して変換し、ローカルで確かめてから、出力した画像と SQL を入れる。

   ```bash
   # 取り出しと変換。scripts/migrate-legacy/out/ に legacy.sql・images/・images.tsv・counts.json を書き出す
   bun scripts/migrate-legacy/migrate.ts
   # ローカルでの確認。マイグレーションだけを当てた一時の D1・R2 に入れ、件数の一致と管理画面の日英の中身を見る
   bun scripts/migrate-legacy/verify.ts
   # 画像を先に置く（images.tsv の1行が R2 のキー・ローカルのファイル・形式）。SQL を先に流すと、
   # 入れた時点で公開サイトに出るプロフィール・使用技術の画像が、置き終わるまで 404 になる
   while IFS=$'\t' read -r key file type; do
     bunx wrangler r2 object put "eastx-media-staging/$key" --remote --file "$file" --content-type "$type" < /dev/null
   done < scripts/migrate-legacy/out/images.tsv
   # データ（経歴・作品・プロジェクトは下書きで入る。プロフィール・SNSリンク・使用技術はすぐ公開サイトに出る。design-spec 9章）
   bunx wrangler d1 execute DB --env staging --remote --file scripts/migrate-legacy/out/legacy.sql
   ```

   - `verify.ts` には、`.dev.vars` の `ADMIN_GITHUB_USER_ID` と Playwright の Chromium（`make setup` が入れる）が要る。ポート 3000 を空けておく。ローカルの設定でビルドし直すので `dist/` を上書きする。
   - SQL は消す文を含まず、中身が空の D1 に入れる前提で作る。A3 でプロフィールを先に保存していると、プロフィールの一意制約で失敗する。
   - `d1 execute` が途中で失敗し、一部のテーブルだけ入ったときは、入った中身を消してから流し直す（作品・プロジェクト・使用技術を消すと紐づけも消える）。

     ```bash
     bunx wrangler d1 execute DB --env staging --remote --command "delete from work; delete from project; delete from stack; delete from career; delete from social_link; delete from profile;"
     ```

5. staging の管理画面で中身を確かめて公開し、6章のデプロイ後確認をする。あわせて SDD ADR-022 の「staging でしか見られないもの」（Custom Domain の上での動作、実際にデプロイしたバンドル）をここで確かめる。
6. `make promote ENV=production` で本番に出し、3〜5 と同じ手順（`--env production`、R2 は `eastx-media`）でログイン・データの移行・確認・公開をする。

## 4. リリース前チェックリスト

昇格 PR を作る前に確かめる。

- [ ] 対象の SHA で CI が緑（`main` の該当コミットのチェック）
- [ ] マイグレーションがある場合、生成した SQL を読み、古いコードのままでも壊れない形になっている（`docs/03_dev-setup.md` 4章）
- [ ] 新しい環境変数・シークレットがある場合、`wrangler.jsonc` の `vars` に書いた、または `wrangler secret put` で登録した（対象の環境すべて）
- [ ] `wrangler.jsonc` の変更がある場合、差分（バインディング・ルート・Cron のトリガー）を確かめた。解析の Analytics Engine・KV・Cron は本番にだけ書き、`<...>` の値が残っていない
- [ ] 本番の場合: 同じ SHA を staging に出し、変更した画面とコアフローを確かめた
- [ ] 昇格 PR に、`docs/03_dev-setup.md` 9章の「PR ルール」の記載事項を書いた
- [ ] PR のセルフレビューが済んだ

## 5. ロールバック手順

### 通常のロールバック（環境プロモーション）

`deploy/{環境}/version` を前の SHA に戻す PR（昇格 PR の revert）をマージする。デプロイと同じパイプラインが走るので、これが基本の手段。D1 のマイグレーションは戻らないので、前の SHA のコードが今のスキーマで動くこと（4章のチェック）が前提になる。

その環境の最初の昇格は、戻す先の SHA が無い（revert すると宣言が空になり、promotion-check とデプロイが止まる）。下の緊急ロールバックか、直した SHA の新しい昇格で対処する。

### アプリケーションの緊急ロールバック

PR を待てないときは、Worker の前のバージョンに直接戻す。

```bash
# デプロイの履歴を見る（本番。staging は --name eastx-staging）
bunx wrangler deployments list --name eastx

# 直前のバージョンに戻す（バージョン ID を指定すれば、そのバージョンに戻す）
bunx wrangler rollback --name eastx --message "rollback: <理由>"
```

戻したあと、`deploy/production/version` を実際に動いている SHA に合わせる PR を必ず出す（宣言と実体をずらしたままにしない）。解析を入れる前のバージョンへ戻したときは、下の「インフラのロールバック」の Cron の確認もする（`wrangler rollback` も Cron のトリガーを外さない）。

### インフラのロールバック

`wrangler.jsonc` の変更は、それを含む昇格 PR の revert で戻る。D1・R2・KV そのものの作成・削除は手作業なので、消す操作は行わない。

例外は Cron のトリガー（`triggers`）で、wrangler は `triggers` を書かない設定をデプロイしても既存の Cron を外さない（SDD ADR-022）。解析を入れる前の SHA へ戻したとき（`scheduled` を持たない版が動く）は、残った Cron が毎日失敗を記録するので、デプロイの後に手で外す。

1. ダッシュボードの Workers & Pages → `eastx` → Settings → Triggers の Cron Triggers に `15 15 * * *` が残っているかを見る。
2. 残っていれば削除する。

解析を入れる前の SHA へ戻したときは、計測が止まった後に、A11 でプライバシーのページの解析の記述を戻す（告知を消すのは計測を止めた後）。

解析のテーブル（`analytics_daily`・`analytics_rollup`）は残る（消すときはテーブルを消すマイグレーションを足す）。Analytics Engine のデータは書かれなくなるだけで3か月で消え、KV の日ごとの値は期限で消える。

### DB のロールバック

マイグレーションに戻す仕組みはない。データやスキーマを戻す必要があるときは、D1 の Time Travel（Paid で30日分）で、問題の前の時点に戻す。

```bash
# 今のブックマーク（戻すときの基準）を見る
bunx wrangler d1 time-travel info DB --env production

# 指定した時点に戻す（UNIX 時刻か RFC 3339）
bunx wrangler d1 time-travel restore DB --env production --timestamp=2026-10-01T09:00:00+09:00
```

その時点より後に管理画面で保存した内容は失われるので、戻す前に `bunx wrangler d1 export DB --env production --remote --output backup.sql` で今のデータを書き出しておく。

## 6. デプロイ後確認

deploy.yml の疎通確認（2章）に加えて、手で確かめる。

- [ ] `/ja` と `/en` のトップが出て、各セクションの中身が正しい
- [ ] 詳細ページ（作品・プロジェクト・ブログ・コーディング記録）を1つずつ開ける
- [ ] 存在しない URL で C1（404）が出る
- [ ] 管理画面に GitHub でログインでき、ダッシュボードが出る
- [ ] 今回変えた画面・機能が動く（staging で確かめ済みなら、本番では主要な画面だけでよい）
- [ ] 本番: A10 に「今日の分を読めませんでした」が出ていない（SQL API のトークンとアカウント ID が効いている）。管理者のセッションの無いブラウザ（プライベートウィンドウ）で P1 を開くと、数分後に A10 の今日の閲覧が増える（管理者のセッションのあるブラウザでは増えない）
- [ ] 本番で Cron のトリガーを足した・変えたとき: 次の 00:15 JST の後に、A10 に「集計していない日があります」が出ていない（昨日が集計された）。Sentry に Cron（`scheduled`）の失敗が出ていない
- [ ] Sentry に新しいエラーが出ていない。`bunx wrangler tail eastx --status error`（staging は `eastx-staging`）でエラーが流れていない

## 7. 緊急時連絡先

| 役割 | 担当 | 連絡手段 |
|------|------|----------|
| 開発者・運用（自分） | 持ち主 | Sentry のアラートのメール |
| Cloudflare の障害 | — | https://www.cloudflarestatus.com |
| GitHub（Actions・OAuth）の障害 | — | https://www.githubstatus.com |
| Sentry の障害 | — | https://status.sentry.io |

※ 1人開発のため、Sentry のアラート（エラー・稼働監視）をメールで受けて対応する（`docs/05_operation-runbook.md` 5章）。
