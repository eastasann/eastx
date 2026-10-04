# eastx

個人のレジュメ／ポートフォリオサイト eastasian の作り直し。日英2言語の公開サイトと自作の CMS（管理画面）を、1つの Cloudflare Worker で動かす（https://x.eastasian.dev）。

TanStack Start（React）・Elysia ＋ oRPC・Cloudflare D1 ／ R2・Better Auth（GitHub OAuth）で作る。構成と判断の理由は [docs/02-01_system-design-doc.md](docs/02-01_system-design-doc.md)。

## 始め方

Bun と Node.js 24 を入れてから（必要なツールは [docs/03_dev-setup.md](docs/03_dev-setup.md) 1章）:

```bash
make setup
make dev
```

`make setup` は依存のインストール、`.dev.vars` の作成、生成物の生成、ローカル D1 へのマイグレーションとデモデータの投入、Playwright の Chromium のインストールを行う。`make dev` で http://localhost:3000 が開き、デモデータのトップが出る。管理画面（`/admin`）へのログインには GitHub の OAuth App が要る（[docs/03_dev-setup.md](docs/03_dev-setup.md) 6章）。

テストは `make test`（ユニット・結合）と `make e2e`（E2E・アクセシビリティ・Lighthouse）。ほかの make のターゲットは [docs/03_dev-setup.md](docs/03_dev-setup.md) 8章。

## ドキュメント

[docs/README.md](docs/README.md) が入口で、読む順とどの事実をどのドキュメントが持つかをまとめている。
