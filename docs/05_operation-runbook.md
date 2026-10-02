# Operation Runbook — eastx

監視の道具と設定の決定は `docs/02-01_system-design-doc.md`（以下 SDD）11章、デプロイ・ロールバックの手順は `docs/04_deployment-procedure.md`。このドキュメントは、日々の監視・障害対応・定期メンテナンスの手順を持つ。

コマンドは本番の名前（Worker `eastx`、D1 `eastx-db`、R2 `eastx-media`）と環境（`--env production`）で書く。staging は Worker `eastx-staging`、D1 `eastx-db-staging`、R2 `eastx-media-staging` と `--env staging` に読み替える。

## 1. モニタリング・ログ設計

### ログ構成

| ソース | 出力先 | 保持期間 | 内容 |
|--------|--------|----------|------|
| Worker のリクエスト | Workers Logs | 7日 | 全リクエスト（メソッド・パス・ステータス・CPU 時間）と、アプリが出した JSON のログ行 |
| アプリのログ（`console.*`） | Workers Logs | 7日 | `{ level, msg, requestId, route, code, ... }` の JSON の1行（SDD 8章） |
| サーバーの例外・5xx | Sentry | Sentry のプランに従う（無料は30日） | スタックトレース、`request_id` タグ、環境名 |
| ブラウザの例外 | Sentry | 同上 | React のエラー境界で受けたもの |
| 稼働監視 | Sentry Uptime Monitoring | 同上 | SDD 11章の監視先の応答 |
| D1 のクエリ | D1 の Insights（ダッシュボード・`wrangler d1 insights`） | 30日 | クエリごとの回数・時間・読んだ行数 |
| デプロイの履歴 | Workers の Deployments、GitHub Actions | 無期限 | いつ・どの SHA を出したか |

### ログレベル

| レベル | 用途 | 本番で出力 |
|--------|------|-----------|
| ERROR | 想定外の例外、5xx、D1・R2 のエラー | ✅ |
| WARN | 定義済みの 4xx（バリデーション・認可・レート制限・CSRF）、ログインの拒否 | ✅ |
| INFO | ログイン・ログアウト、公開・非公開・削除の操作、アップロード | ✅ |
| DEBUG | リクエストとレスポンスの詳細 | ❌（`ENVIRONMENT=local` だけ） |

本文・Cookie・トークン・シークレットはログに出さない。

## 2. 監視ポイントとアラート

| 監視対象 | メトリクス | 閾値 | アラート先 |
|----------|-----------|------|-----------|
| 公開サイトの稼働 | Sentry Uptime（監視先と間隔は SDD 11章） | 2回続けて失敗 | メール |
| サーバー・ブラウザのエラー | Sentry の新しい Issue | 新しい Issue が出たら | メール |
| エラーの急増 | Sentry のメトリクスアラート（エラーの件数） | 1時間に10件を超える | メール |
| Worker の CPU 時間・エラー率 | Cloudflare ダッシュボード（Workers の Metrics） | エラー率 1% 超、CPU 時間の p99 が 50ms 超が続く | 週次で目視（6章） |
| Workers の利用量・請求 | Cloudflare の Billing の通知 | 月の請求が $10 を超える見込み | メール（Cloudflare の Notifications で設定） |
| D1 の容量 | Cloudflare ダッシュボード（D1） | 上限の 80% | 月次で目視（6章） |

## 3. よくある障害と対処法

### 公開サイトが 500 を返す（C2 が出る）

**症状:** トップや詳細ページで「ただいま表示できません」が出る。Sentry に 5xx の Issue が出る。

**対処:**
1. Sentry の Issue でエラーと `request_id` を見る。
2. `bunx wrangler tail eastx --status error --format pretty` で今のエラーを流して見る。
3. 直前にデプロイしていたら、まずロールバックする（`docs/04_deployment-procedure.md` 5章）。
4. D1 のエラー（`D1_ERROR`）なら、次の「D1 のエラー」へ。

### Worker の CPU 時間の超過（エラー 1102）

**症状:** 特定のページだけ `Worker exceeded CPU time limit`。長い本文やコードの多い記事で起きやすい。

**対処:**
1. どのページか Workers Logs で調べる（CPU 時間の大きいリクエスト）。
2. Markdown の描画のキャッシュ（SDD ADR-011）が効いているか確かめる（同じページの2回目以降も重いなら、キャッシュのキーか書き込みを疑う）。
3. Shiki に重い言語を足していないか確かめる（SDD ADR-012）。
4. すぐに直せないときは、`wrangler.jsonc` の `limits.cpu_ms` を上げて昇格する（Paid の上限まで）。

### D1 のエラー

**症状:** `D1_ERROR`、`Network connection lost`、`D1 DB is overloaded` など。全ページか、DB を読むページだけが 500 になる。

**対処:**
1. https://www.cloudflarestatus.com で D1 の障害が出ていないか見る。出ていれば待つ。
2. 遅いクエリがないか見る。

   ```bash
   bunx wrangler d1 insights eastx-db --sort-by time --limit 10
   ```

3. データを確かめる。

   ```bash
   bunx wrangler d1 execute DB --env production --remote \
     --command "select status, count(*) from blog_post group by status"
   ```

4. データが壊れたなら、Time Travel で戻す（`docs/04_deployment-procedure.md` 5章）。

### D1 のマイグレーションの失敗（デプロイが止まる）

**症状:** deploy.yml の「D1 のマイグレーションを適用」で失敗する。デプロイはされず、前のバージョンが動き続ける。

**対処:**
1. GitHub Actions のログで、失敗した SQL を見る。
2. 適用済みのものを確かめる。

   ```bash
   bunx wrangler d1 migrations list DB --env production --remote
   ```

3. 失敗したマイグレーションは未適用のまま残り、次のデプロイでもそこから実行し直される（後ろに新しいマイグレーションを足しても先に進めない）。どこで適用済みかで直し方を分ける。
   - **どの環境にも適用されていない**（staging でも失敗した）: 失敗したファイルそのものを直す PR を出し、もう一度昇格する。「適用済みのファイルは書き換えない」の唯一の例外。
   - **staging では適用済みで、本番だけで失敗した**: ファイルは書き換えない（staging と中身がずれるため）。本番のデータの違い（NULL・重複など）を `d1 execute` で調べ、データの方を直してから、GitHub Actions で deploy.yml を手動で再実行する。

### GitHub でログインできない

**症状:** ログイン後にエラーで A1 に戻る、または GitHub で「redirect_uri is not associated」。

**対処:**
1. A1 の表示で切り分ける（表示は design-spec 6.4、エラーコードとの対応は SDD 5.2）。
   - 「管理者でないアカウント」の表示 → `wrangler.jsonc` の `vars.ADMIN_GITHUB_USER_ID` が自分の GitHub の数値 ID か確かめる（`curl -s https://api.github.com/users/{ユーザー名}` の `id`）。
   - 「通信エラー」の表示 → 次へ。
2. OAuth App のコールバック URL が `https://x.eastasian.dev/api/auth/callback/github` か確かめる。
3. Client secret を作り直した、または期限が切れた → `bunx wrangler secret put GITHUB_CLIENT_SECRET --env production` で入れ直す。
4. `bunx wrangler secret list --env production` で `BETTER_AUTH_SECRET` と `GITHUB_CLIENT_SECRET` があるか確かめる。
5. 短い時間に何度も試すとレート制限（SDD ADR-021）にかかる。1分待つ。

### 画像が出ない・アップロードできない

**症状:** 画像が背景色だけの枠になる。管理画面で画像のアップロードに失敗する（design-spec 6.7.4）。

**対処:**
1. 画像の URL（`/media/...`）を直接開き、404 か 500 かを見る。
2. 404 なら、R2 にあるか確かめる。

   ```bash
   bunx wrangler r2 object get eastx-media/uploads/2026/10/{ファイル名} --remote --file /tmp/check
   ```

3. 失敗の理由が形式か大きさ（design-spec 6.7.3 の表示）なら、仕様どおり（上限と形式は SDD 5.10）。
4. それ以外は Sentry の Issue と `wrangler tail` で R2 のエラーを見る。

### 独自ドメインにつながらない・証明書のエラー

**症状:** `x.eastasian.dev` が開けない、証明書のエラーが出る。

**対処:**
1. Cloudflare ダッシュボードの Workers → `eastx` → Settings → Domains & Routes で、Custom Domain の状態を見る（証明書の発行待ちなら数分待つ）。
2. `x` の DNS レコードを手で作っていたらぶつかる。消してからもう一度デプロイする。
3. `eastasian.dev` のネームサーバーが Cloudflare のままか確かめる。

### 公開サイトに変更が出ない

**症状:** 管理画面で保存したのに、公開サイトが古いまま。

**対処:**
1. 管理画面で状態が「公開」になっているか見る（下書きは公開側に出ない）。
2. 公開側の HTML はキャッシュしない設計（SDD ADR-011）なので、ブラウザを再読み込みする。それでも古ければ、Cloudflare のキャッシュルールで HTML をキャッシュする設定を足していないか確かめる。
3. 本文だけ古いなら、Markdown のキャッシュのキーに `updated_at` が入っているか確かめる（実装のバグ）。

## 4. ログ確認方法

```bash
# リアルタイムのログ（本番）
bunx wrangler tail eastx --format pretty

# エラーだけ
bunx wrangler tail eastx --status error --format pretty

# 特定のリクエストID（cf-ray）や文字列を含むものだけ
bunx wrangler tail eastx --search "8c1f2a3b4c5d6e7f"

# 管理画面の API だけ（POST）
bunx wrangler tail eastx --method POST --format pretty

# D1 の遅いクエリ
bunx wrangler d1 insights eastx-db --sort-by time --limit 10

# デプロイの履歴
bunx wrangler deployments list --name eastx
```

過去のログ（7日まで）は、Cloudflare ダッシュボードの Workers → `eastx` → Observability で、`requestId` や `level` のフィールドで絞り込んで見る。エラーの詳細は Sentry の Issue から、`request_id` タグでログとつなぐ。

## 5. エスカレーションフロー

1人開発のため、Sentry のアラート → メール で自分が対応する。

1. アラートを受けたら、3章の該当する症状を探す。
2. 直前にデプロイしていて原因がすぐにわからないときは、先にロールバックしてから調べる（`docs/04_deployment-procedure.md` 5章）。
3. Cloudflare・GitHub・Sentry の障害なら、各社のステータスページ（`docs/04_deployment-procedure.md` 7章）を見て待つ。

重大障害（データの消失・壊れ）の場合:
1. 管理画面での編集をやめる（さらに上書きしないため）。
2. 今のデータを書き出す（`bunx wrangler d1 export DB --env production --remote --output backup.sql`）。
3. D1 の Time Travel で、問題の前の時点に戻す（`docs/04_deployment-procedure.md` 5章）。
4. 戻した時点より後の変更を、書き出したデータから手で入れ直す。

## 6. 定期メンテナンス

| タスク | 頻度 | 手順 |
|--------|------|------|
| Sentry の Issue の棚卸し | 週1回 | 未解決の Issue を見て、直すか無視（理由をメモ）にする。KPI の「未対応のエラー0件」を保つ |
| Workers・D1 のメトリクスの確認 | 週1回 | 2章の閾値（エラー率・CPU 時間）を Cloudflare ダッシュボードで見る |
| 依存パッケージの更新 | 月1回 | `bun update` で更新 → `make lint`・`make typecheck`・`make test`・`make e2e` → PR → staging → 本番 |
| D1 のバックアップの書き出し | 月1回 | `bunx wrangler d1 export DB --env production --remote --output eastx-YYYYMMDD.sql` を、リポジトリの外の安全な場所に保存する（Time Travel の30日より前に戻したいときのため） |
| D1 の容量の確認 | 月1回 | ダッシュボードで D1 のサイズを見る |
| 期限切れのセッションの掃除 | 月1回 | `bunx wrangler d1 execute DB --env production --remote --command "delete from admin_session where expires_at < unixepoch() * 1000"` |
| `compatibility_date` の見直し | 四半期に1回 | `wrangler.jsonc` の日付を新しくし、変更点（Cloudflare の compatibility flags の一覧）を読んで、staging で確かめてから本番へ |
| OAuth App の Client secret の更新 | 年1回 | 環境ごと（staging 用・本番用の OAuth App）に: GitHub で新しい secret を作る → `bunx wrangler secret put GITHUB_CLIENT_SECRET --env production`（staging は `--env staging`）→ 新しい secret でログインできることを確かめる → 古い secret を消す → もう一度ログインを確かめる |
| `BETTER_AUTH_SECRET` の更新 | 年1回、または漏れた疑いがあるとき | `bunx wrangler secret put BETTER_AUTH_SECRET --env production`（staging は `--env staging`。環境ごとに別の値。全セッションが切れるので、ログインし直す） |
| ドメイン（`eastasian.dev`）の更新 | 年1回 | レジストラーの更新の通知に従う。自動更新にしておく |
