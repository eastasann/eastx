#!/usr/bin/env bash
# 昇格 PR 用のブランチを作り、deploy/{ENV}/version を書き換えてコミットする（docs/03_dev-setup.md 9章）。
# push と PR の作成はしない（PR の本文に staging での確認結果などを書くのは人の作業）。
#
# 使い方: scripts/promote.sh ENV [SHA]（make promote ENV=staging ／ make promote ENV=production SHA=...）
#   SHA を省くと、staging は origin/main の先頭、production は origin/main の deploy/staging/version の値
set -euo pipefail

env="${1:-}"
sha="${2:-}"
case "$env" in
  staging | production) ;;
  *)
    echo 'promote: ENV に staging か production を渡す（make promote ENV=staging）' >&2
    exit 2
    ;;
esac

if [ -n "$(git status --porcelain)" ]; then
  echo 'promote: 作業ツリーに変更がある。コミットか退避をしてから実行する' >&2
  exit 1
fi

git fetch origin main

if [ -z "$sha" ]; then
  if [ "$env" = staging ]; then
    sha=$(git rev-parse origin/main)
  else
    sha=$(git show origin/main:deploy/staging/version | tr -d '[:space:]')
    if [ -z "$sha" ]; then
      echo 'promote: まだ staging に出していない（origin/main の deploy/staging/version が空）' >&2
      exit 1
    fi
  fi
else
  # 短い SHA や参照も受け、宣言ファイルには40桁で書く
  sha=$(git rev-parse --verify --quiet "${sha}^{commit}") || {
    echo "promote: ${2} がコミットとして解決できない" >&2
    exit 1
  }
fi

current=$(git show "origin/main:deploy/${env}/version" | tr -d '[:space:]')
if [ "$sha" = "$current" ]; then
  echo "promote: ${env} はすでに ${sha}" >&2
  exit 1
fi

short=$(git rev-parse --short "$sha")
branch="promote/${env}-${short}"
git switch --no-track -c "$branch" origin/main
echo "$sha" >"deploy/${env}/version"

# CI と同じ判定を先に通し、通らない昇格 PR を作らない
if ! scripts/promotion-check.sh "$env" --main origin/main; then
  git restore "deploy/${env}/version"
  git switch -
  git branch -D "$branch"
  exit 1
fi

git add "deploy/${env}/version"
git commit -m "Promote ${short} to ${env}"
echo "promote: ${branch} を作った。git push -u origin ${branch} のあと、PR を作る（本文は .github/PULL_REQUEST_TEMPLATE.md の昇格 PR の項目）"
