# Feature Design Doc — ヘッダーを控えめにし、プロフィールの上に一言を置く

> 原則: 1ユーザーストーリー = 1 Feature Design Doc
> 変更規模: 中（新しい画面はないが、`profile` テーブルにカラムを足すスキーマの変更があり、CMS API の形と A3 の入力欄も変わる）

## 背景と目的

刷新した公開サイトのヘッダーは、サイト名「eastasian」を見出しの太い文字（`heading-3`）で出している。P1 で最初に目に入るのがサイト名になり、持ち主本人（プロフィール）より目立つ。ヘッダーの下には、セクションどうしの間と同じ広い余白（`section`）があり、プロフィールまでの間が空きすぎている。

持ち主は、ヘッダーをアドレスバーのように控えめにし、空いた場所で訪問者に最初に読ませる一言を出したいと考えた。肩書き（「ソフトウェアエンジニア」など）は職種を表す欄で、名前の下に小さく出す役割はそのまま残したい。そこで、肩書きとは別に「一言」（日英）をプロフィールに足し、プロフィールの上に大きく出す。

持ち主が決めたこと（2026-10-08）:

- ヘッダーの左は、サイト名の代わりにドメイン名 `x.eastasian.dev` を小さなグレーの文字で出す。どの環境でも同じ文字にする。
- 名前を変えるのはヘッダーの表示だけ。`<title>`・OGP・フッターの「© eastasian」・管理画面の「eastasian 管理画面」は今の「eastasian」のまま。
- 一言は肩書きとは別の新しい欄にする。設定していないときは出さず、その場所を詰める。
- ヘッダーから最初の中身（一言、なければプロフィール）までの余白は、一言の有無に関わらず狭くする。

## Goal / Non-Goal

### Goal

1. 公開側のヘッダー（全画面で共通）の左を、`x.eastasian.dev` の小さなグレーの文字にする。押したときの動き（トップならページの先頭へ、詳細ページならトップを開く）は今どおり。
2. プロフィールに「一言」（日英）を足す。管理画面の A3 で入力でき、CMS API で読み書きできる。
3. P1 のプロフィールの上に一言を大きな文字で出す。表示中の言語で空ならもう片方の言語の値を出し（項目単位の代替表示。design-spec 1.4）、どちらも空なら出さずに詰める。
4. P1 のヘッダーから最初の中身（一言、なければプロフィール、プロフィールもなければ `messages.siteName` の見出し）までの余白を `section` から `stack` にする。一言とプロフィールの間も `stack`。

### Non-Goal

- サイト名「eastasian」そのものの変更（`<title>`・`og:site_name` 相当の文字・フッターのコピーライト・管理画面の題・プロフィールがないときの P1 の見出し `messages.siteName`）。
- ヘッダーのドメイン名を環境ごとに変えること（staging・ローカルでも `x.eastasian.dev`）。
- 一言を `<title>`・説明（description・og:description）・OGP 画像に使うこと。P1 の説明は今どおり肩書き、なければ自己紹介の抜粋（ADR-019）。
- 肩書き・名前・写真・自己紹介の見せ方の変更。
- 詳細ページ（P2〜P5）・C1・C2 の余白の変更。ヘッダーの変更は全画面に効くが、余白を変えるのは P1 だけ。
- 一言の Markdown・改行。1行の文字列で、長ければ折り返す。改行の扱いは肩書きと同じで、API は改行を含む値も受け付け、表示では HTML の空白の扱いで空白として折り返す（新しい入力の規則は作らない）。

## 影響範囲

| 影響箇所 | 変更内容 |
|----------|----------|
| フロントエンド（公開側） | `src/site/site-header.tsx`（ドメイン名と文字の見た目）、辞書（`src/i18n/messages/ja.ts`・`en.ts` に `siteDomain`）、`src/site/profile-section.tsx`（一言と余白）、`src/routes/$lang/index.tsx`・`src/site/layouts.tsx`（P1 の一番上の余白） |
| 公開側のサーバー関数 | `src/content/top-page.ts`・`src/content/types.ts`（`ProfileView` に `tagline` を足し、`getTopPage` で読む） |
| フロントエンド（管理画面） | `src/admin/profile.tsx`（言語ごとの欄「一言」を肩書きの下に足す）。フォームの値・退避の読み直し・誤りの欄の順 `FIELD_ORDER` は、ユニットテストのため `src/admin/profile-form.ts` に分ける。退避の読み取り（`src/admin/backup.ts`・`editor.tsx`）は、形を確かめるだけの型ガード（`isValues`）から、今のフォームの形に読み直す関数（`parseValues`。形が合わなければ `null`）に変える。型ガードでは一言のキーが無い退避を空の一言として返せないため。ほかの編集ビュー（A4〜A9）も同じ関数の形にそろえる（Zod の `safeParse` の結果を返す） |
| バックエンドAPI | `src/api/contract/profile.ts`・`src/api/router/` のプロフィールの手続き（`ja`・`en` に `tagline`） |
| DBスキーマ | `src/db/schema.ts` の `profile` に `tagline_ja`・`tagline_en`（`text`、NULL 可）。`drizzle/migrations/` にマイグレーションを足す |
| シード・データ移行 | `scripts/seed/data.ts`（デモのプロフィールに日英の一言）。`scripts/migrate-legacy/transform.ts`（肩書きと同じく `taglineJa: null`・`taglineEn: null` を明示して入れる。今のサイトに無い項目であることをコードに残すため）。移行の SQL を流す先の D1 には、このマイグレーションまで当たっていることが前提になる |
| デザイントークン | `docs/06_design-tokens.json` の `$description` だけを直す（`typography.display` に「P1 の一言」、`typography.heading-3` から「公開側のサイト名」を外し、`typography.meta` に「公開側のヘッダーのドメイン名」を足す）。値は変えない |
| 認証・認可 | 変更なし（5.1 のミドルウェアがそのままかかる） |
| インフラ | 変更なし |

ソースドキュメントの変更（/draft:feature-implement が所有権マップに従って直す）。CMS API の形はコントラクトが正なので、SDD 5.0・5.5・5.11 とコントラクト（`src/api/contract/profile.ts`）は実装の最初に直し、ほかの行は実装の完了後に直す:

| ドキュメント | 節 | 変え方 |
|---|---|---|
| PRD | 1章 | 「サイト名は今のものを引き継ぎ（design-spec 6.1.2）」に、ヘッダーにはドメイン名を出すことを足す |
| PRD | 4章 | M-3 のプロフィールの項目に「一言」を足す |
| design-spec | 1.4 | 「項目単位の代替表示」の項目の例に一言を足す |
| design-spec | 6.1.1 | 図のヘッダーを `x.eastasian.dev` にし、プロフィールの上に一言を描く |
| design-spec | 6.1.2 | ヘッダーの表の「サイト名」の行を「ドメイン名」の行（`x.eastasian.dev`。どの環境でも同じ。小さなグレーの等幅の文字）に置き換える。サイト名「eastasian」の定義は表の下の文として 6.1.2 に残し、`<title>`・フッター・管理画面で使い続けることを書く（ADR-019 と SDD 5.11 の `SiteChromeView` が「6.1.2 のサイト名」を参照しているため、参照先を消さない） |
| design-spec | 6.4 | 編集ビューの一時保存の表に「一時保存した値に、あとから足した欄が無いときは、その欄を空として復元する」を足す |
| design-spec | 4.4 | タイポグラフィの方向性に「ヘッダーのドメイン名は小さなグレーの等幅、P1 の一言は最も大きい見出しの文字」を足す |
| design-spec | 6.1.4 | プロフィールの行に「一言（任意。写真・名前の上に大きく）」を足す |
| design-spec | 6.1.5 | 「一言がない」状態（出さずに詰める）を足す |
| design-spec | 6.7.2 | A3 の言語ごとの項目に「一言」を足す（名前、肩書き、一言、自己紹介の順） |
| design-spec | 8 | profile の内容に「一言（日英）あり」を足す |
| design-spec | 9章 | データ移行の「プロフィールの肩書きは今のサイトに無いので空で入れる」に一言を足す |
| System Design Doc | 5.0 | 文字数の上限の「タイトル・名前・…・表示名 200字」に一言を足す |
| System Design Doc | 5.5 | `GET`・`PUT /api/admin/profile` の例の `ja`・`en` に `tagline` を足す |
| System Design Doc | 5.11 | `TopPageView.profile` に `tagline: LocalizedText \| null` を足す |
| System Design Doc | 6.4・6.5 | `profile` のスキーマに `taglineJa`・`taglineEn`。6.5 の Profile の行の「肩書きを追加」に一言を足す |
| System Design Doc | 9章 | メッセージカタログの例に `siteDomain` を足す |
| System Design Doc | 10章 | アクセシビリティの対象に A3 を足す。E2E の対象に「ヘッダーのドメイン名」「一言の表示と、ないときに詰めること」「A3 で一言を保存すると P1 に出る」を足す |

## 実装アプローチ

- 一言は肩書きと同じ形で持つ。日英の `_ja`／`_en` のカラム、API の `ja`・`en` の中の `tagline`、上限は `LIMITS.shortText`（200字）、空文字は `null`。公開側の代替は `pickText`（今の肩書きと同じ関数）で行う。新しい決まりを作らず、肩書きの経路をそのままなぞる。
- 一言はプロフィールの中の項目にする（`ProfileView.tagline`）。プロフィールがないときは一言も出ない。
- 見た目: 一言は `textStyle: 'display'`（既存の最も大きい見出しの文字）、色は `text.default`。どの画面幅でも同じ大きさで、幅に収まらなければ折り返すだけにする。HTML は `<p>`（ページの見出し `h1` は今どおり名前）。ヘッダーのドメイン名は `textStyle: 'meta'`（等幅・小）、色は `text.muted`、ホバーで `text.default`。新しいトークンは足さない。
- ドメイン名の文字は、言語に依らない `siteName` と同じく辞書（ADR-013）の `siteDomain` に日英で同じ値を持つ。公開側の固定文言は辞書に持つ決まり（SDD 9章）に例外を作らない。
- P1 の一番上の余白: 今は `SingleColumnLayout` の上下の余白（`py: 'section'`）。P1 だけ上を `stack` にする（下と詳細ページ・C1・C2 は今どおり）。
- 一言とプロフィールの並び: プロフィールのセクション（`#profile`）の中の先頭に一言を置き、その下に写真と名前、の順にする。間は `stack`（今のプロフィールの中の間 `stack-dense` より広く、一言をひとまとまりに見せる）。
- 採らなかった案:
  - ドメイン名を `src/site/site-header.tsx` の定数に持つ: 言語に依らないが、公開側の固定文言を辞書に持つ決まりの例外になる。
  - 肩書きを一言として使い、見せ方を強める: 肩書きは職種の欄として名前の下に残したい（持ち主の決定）。
  - サイトの名前そのものをドメイン名にする: 共有のカードや検索結果の名前まで変わる。持ち主はヘッダーの表示だけを選んだ。
  - `SITE_URL` のホストを出す: 環境ごとに見た目が変わる。持ち主は固定の文字を選んだ。

## 詳細設計

### API変更

`GET /api/admin/profile` の `ja`・`en` に `tagline` を足す（`string | null`）。

```json
// 200
{
  "id": "6b1f…",
  "ja": { "name": "東 太郎", "headline": "フロントエンドエンジニア", "tagline": "日英で届ける、使いやすい Web を作る。", "bio": "## こんにちは\n…" },
  "en": { "name": "Taro Higashi", "headline": "Frontend Engineer", "tagline": "Building usable web apps in two languages.", "bio": "## Hi\n…" },
  "avatarUrl": "/media/uploads/2026/09/2a4c….webp",
  "socialLinks": [],
  "languages": { "ja": true, "en": true },
  "updatedAt": "2026-09-30T03:12:45.000Z"
}
```

`PUT /api/admin/profile` の本文の `ja`・`en` にも `tagline` を足す。5.0 の決まりどおり、前後の空白を除き、空文字とキーの省略は `null`、200字を超えたら `INPUT_VALIDATION_FAILED`（`fieldErrors` のキーは `ja.tagline`・`en.tagline`）。「言語あり」の判定（プロフィールは名前）は変えない。

公開側のサーバー関数（5.11）: `TopPageView.profile` に `tagline: LocalizedText | null` を足す。`getTopPage` の1回の `batch` の中で、プロフィールの読み取りに2つのカラムを足す。

### UI変更

#### ヘッダー（公開側の全画面）

```
x.eastasian.dev                 JA ｜ EN  ◐
```

| 要素 | 表示 | 操作 | 結果 |
|---|---|---|---|
| ドメイン名 | `x.eastasian.dev`（どの環境でも同じ）。小さなグレーの等幅の文字。ホバーで濃い文字。リンクの読み上げ名は見えている文字と同じ（`aria-label` を付けない） | 押す | 今どおり。トップならページの先頭へ、詳細ページならトップを開く |

言語切り替え・テーマ切り替え・ヘッダーの高さ（`size.header`）は今どおり。

#### P1 の上部

```
一言あり
┌──────────────────────────────────────┐
│ x.eastasian.dev          JA ｜ EN  ◐ │
│                                      │ ← stack
│ 日英で届ける、                         │ ← 一言（display。長ければ折り返す）
│ 使いやすい Web を作る。                 │
│                                      │ ← stack
│ (写真) 東 太郎                         │
│        ソフトウェアエンジニア            │ ← 肩書き（今どおり）
│ 自己紹介…                              │
```

```
一言なし（どちらの言語も空）
┌──────────────────────────────────────┐
│ x.eastasian.dev          JA ｜ EN  ◐ │
│                                      │ ← stack
│ (写真) 東 太郎                         │
```

| 状態 | 表示 |
|---|---|
| 一言が表示中の言語にある | その言語で出す |
| 表示中の言語で空、もう片方にある | もう片方の言語の値を出し、その部分に `lang` を付ける（注記・ラベルは出さない。プロフィールの代替と同じ） |
| どちらも空 | 一言の場所を空けずに詰める |
| プロフィールがない | 一言もプロフィールも出さない（今どおり） |

#### A3 プロフィール編集

言語ごとの欄に「一言」を足す。並びは名前、肩書き、一言、自己紹介。1行の入力欄（`TextField`）で、上限 200字（文字数の表示は design-spec 6.7.3 のとおり上限の8割を超えたら出す）。必須ではない。L6 の「片方｜日英」の表示、自動退避（design-spec 6.4）、Cmd/Ctrl+S、誤りの欄への移動はほかの欄と同じに扱う。誤りの欄の順（`FIELD_ORDER`）は `ja.name`・`ja.headline`・`ja.tagline`・`ja.bio`・`en.…`（同じ並び）・`avatarUrl`・`socialLinks`。

自動退避は、この変更より前に退避した値（`tagline` のキーが無い）を復元するとき、`tagline` を空として扱う（design-spec 6.4 に足す規則）。

### データマイグレーション

スキーマ差分（`src/db/schema.ts` の `profile`）:

```ts
taglineJa: text('tagline_ja'),
taglineEn: text('tagline_en'),
```

1. `make db-generate` でマイグレーションを作る。ファイル名は drizzle-kit が付ける名前のまま（`0000` と同じ扱い）。SQL と `drizzle/migrations/meta/` の `_journal.json`・`0001_snapshot.json` をいっしょにコミットする。生成される SQL が次の2文（`--> statement-breakpoint` の区切りを除く）だけで、テーブルの作り直し（`DROP`・`RENAME`）を含まないことを読んで確かめる（`docs/03_dev-setup.md` 4章）。

   ```sql
   ALTER TABLE `profile` ADD `tagline_ja` text;
   ALTER TABLE `profile` ADD `tagline_en` text;
   ```

2. 既存データ: 足したカラムは NULL（一言なし）で入る。値を入れる移行はしない。持ち主が A3 で入れる。
3. 古いコードとの両立: 古いコードは2つのカラムを読まず、プロフィールの insert・update でも触らないので、マイグレーションを当てたあとも今のまま動く。デプロイの手順（`docs/04_deployment-procedure.md`）はマイグレーションをビルドとデプロイの前に当てるので、この順で問題がない。
4. デプロイの後も古い管理画面のタブから `PUT /api/admin/profile` を送ると、本文に `tagline` が無いので `null` として保存される（5.0 の「キーの省略は `null`」をそのまま適用し、例外は作らない）。一言を入れる前なら失うものはない。一言を入れた後に古いタブから保存すると一言が消えるので、ロールアウトでは一言を入れる前に、開いている A3 のタブを読み込み直す。
5. 戻すとき: マイグレーションは前進のみ（ADR-007）。コードを前の SHA に戻してもカラムは残り、前のコードはそれを読まず、プロフィールを保存しても触らないので動く。カラムを消すマイグレーションは足さない。入れた一言の値もカラムに残るので、もう一度昇格すると残っている一言がそのまま出る（出したくなければ、昇格した後に A3 で空にする）。スキーマはカラムの追加だけなので、D1 の Time Travel は使わない。
6. 確かめ方（この順で行う）: ① 変更前の `main` でシードしたローカル D1 に、新しいマイグレーションだけを `make db-migrate` で当て、プロフィールの行・値・`updated_at` が変わらず、一言が NULL であることを見る。② そのあと `make db-reset`（手で入れたデータがあれば先に確認する）→ `make db-migrate` → `make db-seed` で、P1 に一言が出ることを見る。

## テスト方針

| テスト種別 | 対象 |
|-----------|------|
| Unit | プロフィールの表示用の形への変換で、一言が日英の項目単位の代替（ja だけ・en だけ・どちらも空）になる（今の肩書きのテストと同じ形）。自動退避の復元で、`tagline` の無い退避の値が空の一言になる。A3 の誤りの欄の順が、名前・肩書き・一言・自己紹介（日本語 → 英語）・写真・SNS リンクになる |
| Integration | `PUT /api/admin/profile` で一言を保存し、`GET` で同じ値が返る。空文字・キーの省略が `null` になる。201字で `INPUT_VALIDATION_FAILED`（`fieldErrors["ja.tagline"]`）。`getTopPage` が一言を `LocalizedText` で返し、どちらも空なら `null`。未認証 401・管理者でないセッション 403 は今の照合のテストのまま通る |
| E2E | 公開側のヘッダーに、読み上げ名が `x.eastasian.dev` に完全一致（`exact: true`）するリンクがあり、押すとトップへ移る（詳細ページから）。P1 で一言がプロフィールの上に出る（/ja と /en）。ローカルの D1 で一言を空にすると、一言の要素が DOM に無く、ヘッダーの下端から最初の中身の上端までの距離が一言のあるときと同じ（`stack`）。プロフィールが無いときも、ヘッダーの下端から見出しまでが同じ距離。幅 360px で 200字の一言を入れても、ページに横スクロールが出ず、ヘッダーが1行に収まる。A3 で一言を入力して保存すると、P1 に出る。今の E2E がヘッダーを「eastasian」の部分一致で探している所は、完全一致のドメイン名に直す |
| アクセシビリティ | 今の axe の検査（P1〜P5・A1・A2、A4・A5・A8 の編集ビュー。ライト・ダーク）に A3 を足し、重大な違反が0件。ヘッダーのドメイン名（`text.muted` の小さな文字）のコントラストもここで確かめる |
| Lighthouse | 一言の入ったシードで、今の P1 の目標を満たす（一言が LCP の要素になりうるので、Performance を見る） |

## ロールアウト計画

1. 実装を PR で `main` に入れる。生成したマイグレーションの SQL を PR で読み、`make lint`・`make typecheck`・`make test`・`make e2e` が通ること。
2. `make promote ENV=staging` で staging に出す。パイプラインが staging の D1 にマイグレーションを当ててからデプロイする。staging の管理画面の A3 で一言を入れて保存し、/ja と /en の P1 で一言・代替・ヘッダーを確かめる。一言を空に戻して詰まることも見る。
3. 同じ SHA を `make promote ENV=production` で本番に出す（SHA を省くと staging に出した SHA を使う）。開いている A3 のタブを読み込み直してから、本番の A3 で一言を入れる。入れるまでは一言が出ず、P1 は余白とヘッダーだけが変わった状態になる。
4. 戻すとき: staging で問題が出たら本番へは昇格しない。本番で問題が出たら本番の昇格 PR を revert する（`deploy/production/version` を前の SHA に戻す）。カラムは残るが前のコードは読まないので動く。どちらの場合も、次の昇格の前に `main` で実装の PR を revert するか、直す PR を入れる。
