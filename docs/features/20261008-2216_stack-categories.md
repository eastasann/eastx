# Feature Design Doc — 使用技術をカテゴリに分け、Core を先頭に出す

> 原則: 1ユーザーストーリー = 1 Feature Design Doc
> 変更規模: 中（新しい画面はないが、`stack` テーブルにカラムを足すスキーマの変更があり、CMS API の形と A7 の入力欄、P1 の Tech Stack の見せ方が変わる）

## 背景と目的

本番の P1 の Tech Stack には、29個の技術が区切りなく1つの塊で並んでいる（2026-10-08 時点）。TypeScript・React と、jQuery・Atomic Design・XD・Jira・Spreadsheet が同じ重みで出るので、採用担当が「何ができる人か」を短い時間でつかめない（PRD 3章、V-1・V-5）。アイコンも、今のサイトから移した SVG の縦横比と内側の余白がまちまち（Spreadsheet は 74×100、Vue は 2500×2165、TypeScript は正方形の地つき）で、正方形の枠に `contain` で収めると絵の大きさと色の主張がばらついて見える。

持ち主が決めたこと（2026-10-08）:

- 技術ごとにカテゴリを持たせる。カテゴリは固定の4つ（Languages・Frameworks・Infrastructure・Tools）で、全部の技術で必須。
- 技術ごとに「Core」（主要な技術）の印を持たせる。「主要な技術を目立たせる」と「Core が分かる」は同じ概念として扱う。
- Tech Stack の先頭に Core の群を置き、その下にカテゴリごとの群を置く。Core の技術は Core の群にだけ出す。Core の群とカテゴリの群の見た目に差は付けない（群と見出しで主要であることを示す）。
- Core の技術は必ずトップに表示する。
- アイコンのばらつきは、Tech Stack の中だけ、地つきの正方形の枠とグレースケールの表示でそろえる。グレースケールにする値は ADR-014 に例外として足す。
- 既存の技術のカテゴリはマイグレーションで入れ、Core は全部オフで入れてデプロイの後に A7 で選ぶ。
- A7 の一覧は今の平らな表とドラッグの並べ替えのまま、「カテゴリ」「Core」の列を足す。

## Goal / Non-Goal

### Goal

1. `stack` にカテゴリ（`languages`・`frameworks`・`infrastructure`・`tools`）と Core の印を持たせ、A7 で入力でき、CMS API で読み書きできる。
2. P1 の Tech Stack を、上から「Core → Languages → Frameworks → Infrastructure → Tools」の群に分けて出す。Core の技術は Core の群にだけ出す。各群の中は A7 の表示順。技術の無い群は見出しごと出さない。
3. Tech Stack のアイコンを、地つきの正方形の枠に収めてグレースケール（`filter: grayscale(100%)`。濃淡は残し、1色で塗りつぶさない）で出す。アイコンが無い・読み込めない技術は、同じ枠の中に頭文字を出す。
4. 新しいコードの API と A7 では、Core でトップに出さない技術を作れない（A7 で Core をオンにすると「トップに表示する」もオンにして固定し、API もこの組み合わせを受け付けない）。古いコードが作ったこの組み合わせ（ロールバック中に起きうる）は、公開側では表示しない技術として扱い、A7 で開いたときの扱いは詳細設計の A7 の表のとおり。
5. 本番・staging の既存の技術に、識別名ごとのカテゴリをマイグレーションで入れる。

### Non-Goal

- カテゴリを管理画面で増やす・名前や並びを変えること（固定の4つ。増やすときはマイグレーションと仕様の変更）。
- 使用技術での絞り込み・検索（PRD 6章・design-spec 9章のスコープ外のまま。群に分けて見せるだけ）。
- Core の群とカテゴリの群で、大きさ・太さ・色の差を付けること。
- 作品・プロジェクトの行のアイコン列・広げた中の使用技術・P2/P3 のチップ・自己紹介の太字の前のアイコンの見た目の変更（枠とグレースケールは Tech Stack だけ。同じ技術のアイコンが、Tech Stack ではグレースケール、行では元の色になる）。
- アイコン画像と表示名のデータの手直し（大文字小文字のばらつき `javaScript`・`graphql` などや、縦横比の違う画像の差し替え）。仕様は変わらず、持ち主が A7 で直す。
- ダークモードで黒いロゴをグレースケールにしたときの見えにくさの対処。アイコンは装飾（`alt=""`）で、隣の表示名が情報を持つ。
- A5・A6 の「+ 追加」の候補の並びや見た目の変更（候補はカテゴリで分けない）。
- A7 の一覧のカテゴリでの絞り込み・カテゴリごとの区切り。

## 影響範囲

| 影響箇所 | 変更内容 |
|----------|----------|
| フロントエンド（公開側） | `src/site/content-parts.tsx`（Tech Stack の群の描画と、枠・グレースケールのアイコン。今の `StackChipList` は P2/P3 でも使うので、Tech Stack 用の部品を分ける）、`src/routes/$lang/index.tsx`（群を渡す）、`src/i18n/section-names.ts`（群の名前 Core・Languages・Frameworks・Infrastructure・Tools を日英共通で持つ） |
| 公開側のサーバー関数 | `src/content/top-page.ts`・`src/content/types.ts`（`TopPageView.stacks` を群の配列 `stackGroups` に変える）。群に分ける純粋関数は `src/domain/` に新しく置く |
| フロントエンド（管理画面） | `src/admin/stacks.tsx`（一覧に「カテゴリ」「Core」の列、編集ビューに「カテゴリ」のセレクトと「Core」のスイッチ。Core をオンにすると「トップに表示するか」をオンにして押せなくする）、`src/admin/long-form.tsx`（A5・A6 の「新しい技術として追加」は今どおり表示名と `showOnTop: false` だけを送り、カテゴリは既定の Tools になる） |
| バックエンドAPI | `src/api/contract/stacks.ts`・`src/api/router/stacks.ts`（`category`・`isCore` の読み書きと、Core でトップに出さない組み合わせの拒否） |
| DBスキーマ | `src/db/enums.ts` に `STACK_CATEGORIES`。`src/db/schema.ts` の `stack` に `category`（`text`、NOT NULL、既定 `tools`、CHECK で4つの値）と `is_core`（`integer` の真偽、NOT NULL、既定 false）。`drizzle/migrations/` にマイグレーションを足す |
| シード・データ移行 | `scripts/seed/data.ts`（デモの技術にカテゴリと Core。後述）。`scripts/migrate-legacy/transform.ts`（マイグレーションと同じ識別名ごとのカテゴリを入れ、`isCore: false` を明示する） |
| デザイントークン | `docs/06_design-tokens.json` の `$description` だけを直す（`color.bg.subtle` と `radius.control` に「Tech Stack のアイコンの地」を足す）。値とトークンは足さない |
| 認証・認可 | 変更なし（5.1 のミドルウェアがそのままかかる） |
| インフラ | 変更なし |

ソースドキュメントの変更（/draft:feature-implement が所有権マップに従って直す）。CMS API の形はコントラクトが正なので、SDD 5.8・5.11 とコントラクト（`src/api/contract/stacks.ts`）は実装の最初に直し、ほかの行は実装の完了後に直す:

| ドキュメント | 節 | 変え方 |
|---|---|---|
| PRD | 4章 | M-6 を「使用技術を登録して、カテゴリと主要な技術（Core）、トップに出すものと順番を決めたい」にする |
| design-spec | 1.4 | 「セクションの名前」の行に、Tech Stack の群の名前（Core・Languages・Frameworks・Infrastructure・Tools）を日英共通の英語で持つこと、P1 の群の見出しと A7 のカテゴリの選択肢・列の値に使うことを足す |
| design-spec | 4.4 | 画像の方針に「Tech Stack のアイコンは地つきの正方形の枠に収め、グレースケールで出す。ほかの場所のアイコンは元の色」を足す |
| design-spec | 6.1.1 | 図の Tech Stack を、Core とカテゴリの群に分けた形に描き直す |
| design-spec | 6.1.4 | 使用技術の行を、群の並び・Core の扱い・空の群・アイコンの枠とグレースケール・頭文字の出し方に書き直す |
| design-spec | 6.4 | 一時保存の表の「一時保存した値に、あとから足した欄が無い」の行に、空にできない欄は読み込んだ値（新規作成は初期値）で復元することを足す |
| design-spec | 6.6 | A7 の列に「カテゴリ」「Core」を足す（アイコン、表示名、カテゴリ、Core、トップに表示するか、使っている Projects・Lab の数）。モバイルで残す列は今どおり |
| design-spec | 6.7.1 | 「新しい技術として追加」で作る技術は、カテゴリを Tools、Core をオフで作ることを足す |
| design-spec | 6.7.2 | A7 の共通の項目に「カテゴリ（初期値は Tools）」「Core（初期値はオフ。オンにするとトップに表示するもオンにして固定）」を足す |
| design-spec | 6.7.3 | 使用技術の保存に「カテゴリが4つのどれかであること」「Core の技術はトップに表示すること（誤りの文言「Core の技術はトップに表示します」）」を足す |
| design-spec | 8 | stack の行を、16件（アイコンあり14・なし2、トップに出さない2、4カテゴリ、Core 4）に直す |
| design-spec | 9章 | データ移行の使用技術に、識別名ごとのカテゴリの入れ方（後述の表）と、Core はオフで入れることを足す |
| System Design Doc | ADR-007 | トレードオフの対処に「列を足すだけで CHECK を伴う変更は、生成された作り直しの SQL を `ADD COLUMN`（名前つきの列の CHECK）に置き換え、スナップショットとの一致を `make db-generate` で確かめてよい」を足す |
| System Design Doc | ADR-014 | 決定の「トークンを通さない値は、ライブラリが実行時に渡す値を受ける CSS 変数だけにする」を、「ライブラリが実行時に渡す値を受ける CSS 変数と、画像の処理の種類を示す値（Tech Stack のアイコンのグレースケール `grayscale: '100%'`）だけにする」に書き換える。後者は色・余白のようなデザインの値ではなく、DTCG にも Panda にも filter のトークンの型が無いため |
| System Design Doc | 5.0 | 「省けない」項目に、使用技術の更新の `category`・`isCore` を足す |
| System Design Doc | 8章 | `INPUT_VALIDATION_FAILED` の場面に「項目どうしの組み合わせの誤り（Core でトップに表示しない技術）」を足す |
| System Design Doc | 5.8 | `GET`・`POST`・`PUT /api/admin/stacks` に `category`・`isCore` を足し、省いたときの値と、Core でトップに出さない組み合わせのエラーを書く |
| System Design Doc | 5.11 | `TopPageView.stacks` を `stackGroups` に変える |
| System Design Doc | 6.3・6.4・6.5 | `stack` の注記とスキーマにカテゴリと Core、`src/db/enums.ts` の `STACK_CATEGORIES`。6.5 の Stack の行に「カテゴリは識別名から決める（design-spec 9章）、Core はオフ」を足す |
| System Design Doc | 10章 | ユニットの対象に、群に分ける関数（`src/domain/`）・移行のカテゴリの表とマイグレーションの SQL の一致・A7 の Core の規則を足す。E2E とアクセシビリティの対象に、Tech Stack の群と A7 のカテゴリ・Core・A7 の編集ビューの axe を足す |
| dev-setup | 4章 | テーブルを作り直す SQL の対処に、ADR-007 に足す3つ目の方法（`ADD COLUMN` への置き換えとスナップショットの一致の確認）を足す |

## 実装アプローチ

- カテゴリは経歴の `kind` と同じ持ち方にする。値は小文字の英語（`languages`・`frameworks`・`infrastructure`・`tools`）の文字列で、`src/db/enums.ts` に `STACK_CATEGORIES`（`as const` の配列）を足し、DB の CHECK（`inList(STACK_CATEGORIES)`）・コントラクトの Zod の enum・公開側の群の並びはすべてここから読む（公開側は `src/api/` を import しない。ADR-001・005）。並び（Languages → Frameworks → Infrastructure → Tools）はこの配列の順で決める。
- 見せる名前（Core・Languages・…）はセクションの名前と同じく日英共通の英語にし、`src/i18n/section-names.ts` に持つ。/ja でも見出しに `lang="en"` を付ける（design-spec 1.4 のセクションの名前と同じ扱い）。管理画面のカテゴリのセレクトと列も同じ名前を出す。
- Core と「トップに表示する」の関係は、DB の CHECK ではなく API の入力チェックで守る。理由: CHECK にすると、ロールバックした古いコードが Core の技術の「トップに表示する」をオフにして保存したときに制約違反になり、マイグレーションが古いコードで動く形（`docs/03_dev-setup.md` 4章）にならない。公開側のクエリは今どおり `show_on_top` だけで出す技術を決め、その中で `is_core` によって群を分ける。古いコードが Core の技術を非表示にしても、表示されないだけで矛盾は表に出ない。
- 群に分ける処理は純粋関数として `src/domain/` に置く（SDD 10章のユニットのカバレッジの範囲に入れるため）。`getTopPage` は今どおり `show_on_top` の技術を `sort_order` の順で読み、`category`・`isCore` を足して返す。表示用の形への変換で、Core の群（`isCore` の技術）と、4つのカテゴリの群（`isCore` でない技術）に分け、技術の無い群を除く。全部の群が空なら今どおりセクションごと出さない。
- アイコンの枠とグレースケール（Tech Stack だけ）: アイコンを包む要素に地の色 `bg.subtle`・角丸 `radius.control`・内側の余白 `inset-dense` を付け、中の画像は今と同じ大きさ（`icon`）で `object-fit: contain`、グレースケール。グレースケールは Panda のユーティリティ `filter: 'auto'` と `grayscale: '100%'`（固定した版の `styled-system/types/system.d.ts` で `GrayscaleValue` が文字列を受け付けることを確かめた）で書き、`css()` に渡す静的な値にする。アイコンが無い・読み込めない技術は、今の頭文字の丸の代わりに、同じ枠の中に頭文字（`label` の文字、`text.muted`）を出し、枠の大きさをアイコンと同じにする。新しいトークンは足さない。チップの表示名の色・文字は今どおり。
- 「読み込めない」の検知は今の `FallbackImage`（`src/ui/image.tsx`）をそのまま使う。SSR の HTML でハイドレーションの前に失敗した画像も、描画の後に `decode()` で確かめて代わりの表示に切り替える。頭文字は今の `InitialBadge` と同じ決め方（表示名の前後の空白を除いた最初の1文字（コードポイント）を大文字にする）にし、関数を共有する（`javaScript` は `J`）。
- 太字と使用技術の照合（ADR-012）と Markdown のキャッシュのキーの使用技術の版（ADR-011）は、識別名・表示名・アイコンだけで作るので、カテゴリと Core を変えても変わらない。そのまま触らない。
- 採らなかった案:
  - カテゴリの中で Core を先頭・濃い文字にする: カテゴリと Core を独立した軸のまま見せられるが、持ち主は Core を一目で分かる群にすることを選んだ。
  - Core の群のアイコンを大きくする: 持ち主が、群と見出しで足りるので見た目の差は要らないと判断した。新しい size トークンも要らなくなる。
  - カテゴリを管理画面で編集できるテーブルにする: テーブル・API・画面が増え、個人サイトには重い。
  - カテゴリを空にできる（未分類）: 移行直後の扱いは楽になるが、公開側に「Other」の群が要る。マイグレーションで全件にカテゴリを入れられるので必須にした。
  - 「トップに表示する」をやめて、Core・経験あり・出さないの1つの値にする: 組み合わせの矛盾は無くなるが、既存のカラムと API の `showOnTop` を変える変更になり、古いコードと両立しない。
  - 単色を画像の側で行う（単色の SVG を登録する決まり）: ADR-014 は変えずに済むが、行のアイコン列まで単色になり、画像ごとにダークモードの見え方を確かめる手間が要る。

## 詳細設計

### API変更

`GET /api/admin/stacks`・`GET /api/admin/stacks/{id}` の項目に `category`・`isCore` を足す。

```json
// 200（GET /api/admin/stacks）
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

`POST /api/admin/stacks`・`PUT /api/admin/stacks/{id}` の本文:

```json
// リクエスト（A7 の新規作成・更新）
{ "key": "react", "displayName": "React", "iconUrl": null, "linkUrl": "https://react.dev", "category": "frameworks", "isCore": true, "showOnTop": true }
// リクエスト（A5・A6 の「新しい技術として追加」。今どおり）
{ "displayName": "Hono", "showOnTop": false }
```

- `category` は `"languages"` ／ `"frameworks"` ／ `"infrastructure"` ／ `"tools"`。`isCore` は真偽。
- POST: `category` を省くと `"tools"`、`isCore` を省くと `false`。
- PUT: `category`・`isCore` は省けない（5.0 の「`key`・`displayName`・`showOnTop` は省けない」に足す。省いた PUT で値が書き換わらないように）。
- `isCore: true` で `showOnTop: false` は `INPUT_VALIDATION_FAILED`（`fieldErrors.showOnTop` に「Core の技術はトップに表示します」）。POST で `showOnTop` を省いたときの既定は今どおり `true` なので、`isCore: true` だけを送っても通る。
- 4つ以外の `category` は `INPUT_VALIDATION_FAILED`（`fieldErrors.category`）。
- 並べ替え（`POST /api/admin/stacks/reorder`）・削除は変えない。

公開側のサーバー関数（5.11）: `TopPageView.stacks: StackChip[]` を次に変える。`StackChip` の形（行・詳細ページで使う）は変えない。

```ts
type StackGroupKey = 'core' | StackCategory   // StackCategory = 'languages' | 'frameworks' | 'infrastructure' | 'tools'
type TopPageView = {
  // …
  stackGroups: { key: StackGroupKey; stacks: StackChip[] }[]  // show_on_top のものだけ。core → languages → frameworks → infrastructure → tools の順で、空の群は含めない。各群の中は表示順
}
```

### UI変更

#### P1 の Tech Stack

```
Tech Stack
────────────────────────────────────────
Core                                      ← 群の見出し（h3、lang="en"）
[▣] TypeScript  [⚛] React  [⬢] Node.js     ← [ ] は地つきの正方形の枠、アイコンはグレースケール

Languages
[J] JavaScript  [▣] Python  [S] Sass       ← アイコンが無ければ枠の中に頭文字

Frameworks
[V] Vue  [$] jQuery  [◆] Redux …

Infrastructure
[▲] Firebase  [☁] GCP  [🐳] Docker

Tools
[◇] Git  [◇] GitHub  [◇] Jest …
```

| 要素 | 表示 |
|---|---|
| 群の並び | Core → Languages → Frameworks → Infrastructure → Tools。技術の無い群は見出しごと出さない。全部の群が空ならセクションごと出さない（今どおり） |
| 群の見出し | `h3`。見える文字は群の名前だけ。文字は `label`、色は `text.muted`。区切り線は付けない（セクションの見出しの下の線だけ） |
| 群の中 | 今のチップと同じ（枠線のない小さなチップ。アイコンと表示名を横に並べて折り返す。リンクがあれば別タブで開く）。並びは A7 の表示順 |
| Core の扱い | Core の技術は Core の群にだけ出し、そのカテゴリの群には出さない。Core の群とカテゴリの群で、チップの見た目は同じ |
| アイコン | 地つきの正方形の枠（`bg.subtle`、角丸 `radius.control`、内側の余白 `inset-dense`）に、今と同じ大きさ（`icon`）で収め、グレースケールで出す。代替テキストは空（隣に表示名がある。今どおり） |
| アイコンが無い・読み込めない | 同じ枠の中に表示名の頭文字（`label`、`text.muted`。決め方は実装アプローチ）を出す。枠の大きさはアイコンのときと同じ |
| 群と群の間・見出しとチップの間 | 群と群の間は `stack`、見出しとその群のチップの間は `stack-dense`。どの画面幅でも同じで、チップは今どおり幅に合わせて折り返す |
| Core が0件（移行直後の本番） | Core の群を出さず、Languages から始める |
| 全部の技術が Core | Core の群だけを出す |

アクセシビリティ: 各群は、見出しの `id` を `aria-labelledby` で名前にしたリスト（`ul`）にする。今の「Tech Stack」の名前を持つ1つのリストは、群のリストに置き換える。

#### A7 使用技術管理

一覧（6.6）の列: アイコン、表示名、カテゴリ（Languages などの名前）、Core（オンの技術に「Core」の文字。オフは空）、トップに表示するか、使っている Projects・Lab の数。どの列も文字だけで、一覧の上で値を切り替えることはできない（今の「トップに表示」の列と同じ）。並び・ドラッグでの並べ替え・絞り込みが無いことは今どおり。モバイルで残す列は今どおり（カテゴリと Core は隠す）。

編集ビュー（L6）の欄の並び: 表示名、識別名、アイコン、リンク、カテゴリ、Core、トップに表示するか（今の並び「表示名、識別名、アイコン、リンク、トップに表示するか」の、トップに表示するかの前にカテゴリと Core を差し込む。Core とトップに表示するかを隣にして、固定の関係を見せる）。

| 欄 | 部品 | 初期値（新規作成） | 振る舞い |
|---|---|---|---|
| カテゴリ | セレクト（Languages・Frameworks・Infrastructure・Tools） | Tools | 必須。空にはできない |
| Core | スイッチ | オフ | オンにすると「トップに表示するか」をオンにして押せなくし、欄の下に「Core の技術はトップに表示します」を出す。オフに戻すと「トップに表示するか」は押せるようになり、値はオンのまま残す |
| Core がオンでトップに表示しない値を読み込んだ・復元した | （古いコードが作った値、自動退避の復元） | — | 読み込んだ値をそのまま欄に出し、Core のスイッチはオン、「トップに表示するか」はオフで押せない状態にはせず、欄の下に「Core の技術はトップに表示します」を出す。この状態で保存すると API が `INPUT_VALIDATION_FAILED`（`fieldErrors.showOnTop`）を返し、6.7.3 の誤りの出し方になる。黙って値を直さない（持ち主が Core を外すか、トップに表示するかをオンにして決める） |

誤りの欄の順（`FIELD_ORDER`）は、表示名・識別名・アイコン・リンク・カテゴリ・Core・トップに表示するか（欄の並びに合わせる）。自動退避（design-spec 6.4）でこの変更より前に退避した値（`category`・`isCore` のキーが無い）を復元するときは、その2つの欄に、編集ビューで読み込んだ技術の値（新規作成なら初期値の Tools・オフ）を入れる。design-spec 6.4 の「一時保存した値に、あとから足した欄が無いときは空として復元する」は、カテゴリが空にできない欄なのでそのまま当てはめられない。そこで「空にできない欄は、読み込んだ値（新規作成は初期値）で復元する」を design-spec 6.4 に足す。

#### A5・A6 の「新しい技術として追加」

送る本文は今どおり（`{ displayName, showOnTop: false }`）。作った技術はカテゴリ Tools・Core オフになる。トップに出さない設定なので、公開側の Tech Stack には影響しない。

### データマイグレーション

スキーマ差分（`src/db/schema.ts` の `stack`）:

```ts
/** カテゴリ。並びは STACK_CATEGORIES の順 */
category: text('category', { enum: STACK_CATEGORIES }).notNull().default('tools'),
/** Core（主要な技術）。API は true のとき show_on_top も true であることを求める。DB では縛らないので、古いコードが作った「Core かつ非表示」の行がありうる（公開側では出ない） */
isCore: integer('is_core', { mode: 'boolean' }).notNull().default(false),
// テーブルの制約に足す
check('stack_category', sql`${t.category} in (${inList(STACK_CATEGORIES)})`),
```

1. `make db-generate`（drizzle-kit 0.31.11）でマイグレーションを作る。CHECK 制約を足すので、drizzle-kit はテーブルを作り直す SQL（`PRAGMA foreign_keys=OFF` → `__new_stack` → コピー → `DROP TABLE stack` → `RENAME`）を出す見込み。そのまま使うと、D1 では `DROP` で `work_stack`・`project_stack` の行が `ON DELETE CASCADE` で消える（ADR-007）。生成された SQL がどんな形でも、SQL の本文は次の形に手で固定する。SQLite は列の定義に付けた名前つきの CHECK を `ADD COLUMN` で受け付け、既存の行は既定値で検査される。制約の名前（`stack_category`）と式（`"stack"."category" in (…)`）は、スナップショットの `checkConstraints` に drizzle-kit が書く値（既存の `career_kind` と同じ形）にそろえる。`drizzle/migrations/meta/` のスナップショットは drizzle-kit が出したもの（CHECK を含むスキーマ）をそのまま使う。置き換えた後に `make db-generate` をもう一度走らせ、新しいマイグレーションが出ない（スナップショットとスキーマが一致している）ことを確かめる。手で書いた SQL が DB に入れた形（既定値・NOT NULL・CHECK）は、結合テストで確かめる（テスト方針）。

   この「列を足すだけの CHECK は、作り直しの SQL を `ADD COLUMN` に置き換え、スナップショットの一致を確かめる」は、`docs/03_dev-setup.md` 4章と ADR-007 の対処（`defer_foreign_keys` か、子の行の退避と復元）に無い3つ目の方法なので、ソースドキュメントの変更表に入れて決まりにする。

   ```sql
   ALTER TABLE `stack` ADD `category` text DEFAULT 'tools' NOT NULL CONSTRAINT "stack_category" CHECK("stack"."category" in ('languages', 'frameworks', 'infrastructure', 'tools'));--> statement-breakpoint
   ALTER TABLE `stack` ADD `is_core` integer DEFAULT false NOT NULL;--> statement-breakpoint
   UPDATE `stack` SET `category` = 'languages' WHERE `key` IN ('typescript', 'javascript', 'python', 'html', 'css', 'sass', 'graphql');--> statement-breakpoint
   UPDATE `stack` SET `category` = 'frameworks' WHERE `key` IN ('react', 'vue', 'svelte', 'next', 'jquery', 'redux', 'apollo', 'socketio', 'styled-components', 'emotion', 'tailwind', 'materialui', 'mantine', 'electron', 'capacitor', 'express', 'prisma');--> statement-breakpoint
   UPDATE `stack` SET `category` = 'infrastructure' WHERE `key` IN ('node', 'firebase', 'gcp', 'aws', 'docker', 'supabase', 'railway', 'vercel', 'auth0');
   ```

   `tools` は既定値で入るので UPDATE しない（git・github・storybook・atomic-design・testcafe・jest・lerna・bazel・turborepo・nx・xd・figma・photoshop・illustrator・jira・spreadsheet・excel・word・powerpoint・sharepoint・sap・teams と、この表に無い識別名）。`updated_at` は変えない（カテゴリの初期値を入れるだけで、持ち主の保存ではないため）。

2. 識別名ごとのカテゴリ（今のサイトから移した55個。`scripts/migrate-legacy/out/legacy.sql` の識別名で確かめた）:

   | カテゴリ | 識別名 |
   |---|---|
   | Languages（プログラミング言語・スタイルの言語・問い合わせの言語） | typescript、javascript、python、html、css、sass、graphql |
   | Frameworks（フレームワーク・ライブラリ） | react、vue、svelte、next、jquery、redux、apollo、socketio、styled-components、emotion、tailwind、materialui、mantine、electron、capacitor、express、prisma |
   | Infrastructure（実行環境・クラウド・ホスティング・DB・認証のサービス・コンテナ） | node、firebase、gcp、aws、docker、supabase、railway、vercel、auth0 |
   | Tools（開発・テスト・ビルド・デザインの道具と、業務のソフト。ほかに当てはまらないもの） | 上の3つ以外 |

   移行の後に持ち主が A7 で直してよい。同じ表を `scripts/migrate-legacy/transform.ts` に持たせ、移行のスクリプトを流し直しても同じ結果になるようにする（マイグレーションの SQL は書いた時点の値で固定されるので、表を共有せず2か所に書く。ずれはユニットテストで、transform の表から作った UPDATE の識別名の集合と、マイグレーションの SQL の識別名の集合が一致することで防ぐ）。

3. Core: 全部 `false` で入る。デプロイの後に持ち主が A7 で選ぶ。選ぶまでは Core の群が空なので出ず、カテゴリの群だけが出る。
4. 古いコードとの両立: 古いコードは2つのカラムを読まない。古いコードの insert（A7 の新規作成・「新しい技術として追加」）は2つのカラムを書かないので、既定値（Tools・オフ）で入る。古いコードの update も2つのカラムに触らない。Core と「トップに表示する」の関係は DB で縛らないので、古いコードが Core の技術を非表示にしても保存は通る（公開側では出なくなるだけ）。デプロイの手順はマイグレーションをデプロイの前に当てるので、この順で問題がない。
5. デプロイの後も古い管理画面のタブから `PUT /api/admin/stacks/{id}` を送ると、本文に `category`・`isCore` が無いので `INPUT_VALIDATION_FAILED` になる（PUT では省けない）。古いタブは読み込み直せば直る。値が失われることはない。
6. 戻すとき: マイグレーションは前進のみ（ADR-007）。コードを前の SHA に戻してもカラムは残り、前のコードは読まないので動く。カラムを消すマイグレーションは足さない。もう一度昇格すると、残っているカテゴリと Core がそのまま出る。テーブルを作り直さないので、D1 の Time Travel は使わない。
7. 確かめ方（この順で行う）:
   1. 変更前の `main` をチェックアウトして `make db-reset`（手で入れたデータがあれば先に確認する）でシードし、`stack`・`work_stack`・`project_stack` の件数と `stack` の `updated_at` を控える。変更後のブランチに切り替えて `make db-migrate` で新しいマイグレーションだけを当て、件数と `updated_at` が変わらないこと、Core が全件オフであること、カテゴリが「`typescript`・`python` は Languages、`react`・`jquery` は Frameworks、`docker` は Infrastructure、残り（シードの識別名 `nodejs`・`nextjs` などは移した識別名 `node`・`next` と違うので表に当たらない）は Tools」であることを見る。
   2. 変更前の `main` で、ローカルの D1 を消して（`make db-reset` の前半と同じ `.wrangler/state/v3/d1` の削除。手で入れたデータがあれば先に確認する）`make db-migrate` だけを当て、シードを入れない空のテーブルに `bunx wrangler d1 execute eastx-db-local --local --file scripts/migrate-legacy/out/legacy.sql` で移行の SQL を流す（`legacy.sql` は Git に入らない生成物なので、無ければ `scripts/migrate-legacy/migrate.ts` で作る）。件数を控え、変更後のブランチに切り替えて `make db-migrate` し、55件のカテゴリが上の表のとおりになること、`work_stack`・`project_stack` の件数が変わらないことを見る。
   3. 変更後のブランチで `make db-reset` し、P1 に Core と4つの群が出ることを見る。

#### シード（design-spec 8章）

`stack` を16件にする（今の15件に Git を足す）。

| カテゴリ | 識別名（* は Core、（非表示）はトップに出さない） |
|---|---|
| Languages | typescript*、python、go、perl（アイコンなし・非表示） |
| Frameworks | react*、tanstack-start*、nextjs、drizzle、jquery（非表示） |
| Infrastructure | cloudflare-workers*、nodejs、bun、postgresql、sqlite、docker |
| Tools | git（アイコンなし。Tech Stack の頭文字の枠を確かめる） |

アイコンあり14・なし2、トップに出さない2、Core 4。Core の技術はどれもトップに出す。

## テスト方針

| テスト種別 | 対象 |
|-----------|------|
| Unit | 群に分ける関数: Core の技術が Core の群にだけ入る、群の順が core → languages → frameworks → infrastructure → tools、各群の中が入力の順（表示順）のまま、技術の無い群が含まれない、入力が空なら空の配列、Core が0件なら Core の群が無い、全部が Core なら Core の群だけ。移行のカテゴリの表: transform の表とマイグレーションの SQL の識別名の集合が一致する、表に無い識別名が Tools になる。A7 の規則: Core をオンにすると「トップに表示するか」がオンになる、Core がオンでトップに表示しない値を読み込んだときに値を変えない、誤りの欄の順、自動退避の復元でカテゴリと Core のキーが無い値を読み込んだ値で埋める。シードの検査（`scripts/seed/data.test.ts`）: 16件、Core 4、Core はどれもトップに出す、4つのカテゴリがそろう |
| Integration | `POST /api/admin/stacks` で `category`・`isCore` を省くと Tools・`false`。`{ displayName, showOnTop: false }`（「新しい技術として追加」）が今どおり通り、Tools・`false` になる。`PUT` で `category`・`isCore` を省くと `INPUT_VALIDATION_FAILED`。`isCore: true` と `showOnTop: false` で `INPUT_VALIDATION_FAILED`（`fieldErrors.showOnTop`）。4つ以外のカテゴリで `INPUT_VALIDATION_FAILED`（`fieldErrors.category`）。`GET` で同じ値が返る。マイグレーションを当てた D1 で `category` に4つ以外を直接 insert すると CHECK で失敗する。`PRAGMA table_info(stack)` で `category` が既定値 `'tools'`・NOT NULL、`is_core` が既定値 `false`（0）・NOT NULL。2つのカラムを書かない insert（古いコードの insert）が Tools・0 で入る。`getTopPage` が `stackGroups` を返し、`show_on_top` でない技術を含まない。未認証 401・管理者でないセッション 403 は今の照合のテストのまま通る。Markdown のキャッシュのキーの使用技術の版が、カテゴリと Core を変えても変わらない |
| E2E | P1 の Tech Stack に、Core・Languages・Frameworks・Infrastructure・Tools の見出しがこの順で出る（/ja と /en。見出しに `lang="en"`）。Core の技術（TypeScript）が Core の群にだけあり、Languages の群に無い。トップに出さない技術（jQuery・Perl）がどの群にも無い。アイコンの無い技術（Git）と、ローカルの D1 で `iconUrl` を存在しない `/media/` のパスにした技術が、どちらも枠の中の頭文字で出る（SSR の後に失敗を拾うこと）。Tech Stack の `img` の computed の `filter` が `grayscale(1)` で、作品の行のアイコン列の `img` には `filter` が無い。Tech Stack のアイコンの枠の幅と高さが等しく、アイコンありと頭文字で同じ寸法。ローカルの D1 で Tools の技術を非表示にすると、Tools の見出しが DOM に無い。A7 でカテゴリを変えて保存すると P1 の群が移る。A7 で Core をオンにすると「トップに表示するか」がオンで押せなくなり、保存すると P1 の Core の群に出る。今の E2E が「Tech Stack」の名前の1つのリストを探している所は、群のリストに直す |
| アクセシビリティ | 今の axe の検査（P1 を含む。ライト・ダーク）に A7 の編集ビューを足し、重大な違反が0件。群の見出しの文字（`label`、`text.muted`）と、枠の中の頭文字（`text.muted` を `bg.subtle` の上に置く）のコントラストもここで確かめる |
| Lighthouse | 今の P1 の目標を満たす（見出しが増えるのと、アイコンへの filter で、Performance と Accessibility を見る） |

## ロールアウト計画

1. 実装を PR で `main` に入れる。マイグレーションの SQL がテーブルの作り直しを含まないことを PR で読み、`make lint`・`make typecheck`・`make test`・`make e2e` が通ること。
2. `make promote ENV=staging` で staging に出す。パイプラインが staging の D1 にマイグレーションを当ててからデプロイする。staging の P1 で、今の技術が4つのカテゴリの群に分かれて出ること（Core の群はまだ出ない）、アイコンが枠とグレースケールになることを確かめる。カテゴリが識別名の表のとおりに入ったことは、staging の A7 の一覧のカテゴリの列で、表の55個と照らし合わせて確かめる（このセッションからは staging・本番の D1 に `--remote` で触れないため、画面で見る）。同じく A7 の一覧の「使っている Projects・Lab」の列の値を昇格の前に控え、昇格の後に変わっていないことで、`work_stack`・`project_stack` の行が消えていないことを確かめる。staging の A7 で数件を Core にし、P1 の Core の群に出て、カテゴリの群から消えることを見る。開いている A7 のタブは、昇格の後に読み込み直す。
3. 同じ SHA を `make promote ENV=production` で本番に出す（SHA を省くと staging に出した SHA を使う）。デプロイの直後から本番の P1 はカテゴリの群に分かれて出る。持ち主が本番の A7 で Core を選び、必要ならカテゴリと表示名・アイコンを直す。Core を選ぶまでは Core の群が出ないだけで、表示は崩れない。
4. 戻すとき: staging で問題が出たら本番へは昇格しない。本番で問題が出たら本番の昇格 PR を revert する（`deploy/production/version` を前の SHA に戻す）。カラムは残るが前のコードは読まないので、P1 は前の1つの塊に戻る。どちらの場合も、次の昇格の前に `main` で実装の PR を revert するか、直す PR を入れる。

## 実装で決めた細部

- 群に分ける純粋関数は `src/domain/stack-groups.ts` の `toStackGroups`（`src/content/top-page.ts` に同じ名前の `groupStacks` があるため）。A7 の Core の規則（`withCore`・`showOnTopLocked`）、誤りの欄の順、退避の読み直し（`parseStackForm`）は `src/admin/stack-form.ts` に置き、`src/admin/stacks.tsx` から使う（A3 の `profile-form.ts` と同じ分け方）。
- 頭文字の決め方は `src/domain/initial.ts` の `initialOf` に置き、`InitialBadge`（`src/ui/image.tsx`）・Tech Stack の枠・自己紹介の太字の前のアイコンの代わり（`src/markdown/render.ts`）で共有する。
- マイグレーションのファイルは `drizzle/migrations/0002_dizzy_junta.sql`（drizzle-kit が付けた名前のまま、本文だけを手で固定した）。
- Core の欄の下の文と「トップに表示するか」の誤りを出すため、`SwitchField`（`src/admin/fields.tsx`）に `disabled`・説明・誤りの表示と、押せなくした理由をほかの欄の説明から読ませる指定を足し、`Switch`（`src/ui/switch.tsx`）に `invalid` と、説明を隠した checkbox に結びつける `aria-describedby` を足した。
- 実装中に見つけた不具合: `FallbackImage`（`src/ui/image.tsx`）が自分の `objectFit: 'cover'`・`bg: 'bg.muted'` と呼び出し側の className を `cx` で並べていた。Panda の別々の原子クラスはスタイルシートの順で勝ち負けが決まるので、呼び出し側の `objectFit: 'contain'` が負け、行のアイコン列・A5/A6/A7 のアイコンも切り抜かれていた（Tech Stack の枠の中のアイコンも同じになった）。`FallbackImage` に `fit`（`cover` は地の色つき、`contain` は地の色なし）を足し、収め方を className に書かないようにした。行のアイコン列の見た目は、Non-Goal の「見た目の変更」ではなく、元から指定していた `contain` に戻ったもの。E2E で Tech Stack と行のアイコンの `object-fit` が `contain` であることを確かめる。A3 の写真と A7 のアイコンの編集欄のプレビュー（`ImageField` の `contain`）も、指定どおり切り抜かずに収まり、読み込むまでの地の色が無くなる。
