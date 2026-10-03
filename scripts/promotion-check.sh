#!/usr/bin/env bash
# 昇格 PR の確認（docs/04_deployment-procedure.md 2章）。ci.yml が deploy/*/version を変えた PR で呼ぶ。
#
# 使い方: scripts/promotion-check.sh ENV... [--main REF]
#   ENV: staging ／ production。作業ツリーの deploy/{ENV}/version を確かめる
#   --main: main の参照（既定: origin/main）。祖先の判定と staging の履歴をここから読む
#
# staging の履歴を PR の HEAD ではなく main から読むのは、同じ PR で staging と本番を
# 同時に書き換えたとき、まだ staging に出ていない SHA を本番に通さないため。
set -euo pipefail

main_ref=origin/main
envs=()
while [ $# -gt 0 ]; do
  case "$1" in
    --main)
      main_ref="${2:?--main に参照を渡す}"
      shift 2
      ;;
    staging | production)
      envs+=("$1")
      shift
      ;;
    *)
      echo "promotion-check: 知らない引数: $1（staging ／ production ／ --main REF）" >&2
      exit 2
      ;;
  esac
done
if [ ${#envs[@]} -eq 0 ]; then
  echo 'promotion-check: 環境（staging ／ production）を1つ以上渡す' >&2
  exit 2
fi
if ! git rev-parse --verify --quiet "${main_ref}^{commit}" >/dev/null; then
  echo "promotion-check: main の参照 ${main_ref} が無い（CI では fetch-depth: 0 でチェックアウトする）" >&2
  exit 2
fi

fail=0
for env in "${envs[@]}"; do
  file="deploy/${env}/version"
  if [ ! -f "$file" ]; then
    echo "promotion-check: ${file} が無い" >&2
    fail=1
    continue
  fi
  sha=$(tr -d '[:space:]' <"$file")

  if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    echo "promotion-check: ${file} の値が40桁の SHA でない: '${sha}'" >&2
    fail=1
    continue
  fi
  if ! git cat-file -e "${sha}^{commit}" 2>/dev/null; then
    echo "promotion-check: ${file} の ${sha} はリポジトリに無い" >&2
    fail=1
    continue
  fi
  if ! git merge-base --is-ancestor "$sha" "$main_ref"; then
    echo "promotion-check: ${file} の ${sha} は ${main_ref} の祖先でない" >&2
    fail=1
    continue
  fi
  if [ "$env" = production ]; then
    # staging の過去の値: main の第1親の履歴で deploy/staging/version に書かれたことのある行。
    # 第1親に限るのは、マージコミットで入れた昇格の、PR ブランチの途中のコミットの値（デプロイされていない）を数えないため。
    # パイプで grep -q に直接渡すと、grep が先に終わって git log が SIGPIPE で落ち、pipefail で不一致に見える
    staging_history=$(git log --first-parent --diff-merges=first-parent -p --format= "$main_ref" -- deploy/staging/version)
    if ! grep -qx "+${sha}" <<<"$staging_history"; then
      echo "promotion-check: ${sha} は staging に出したことがない（${main_ref} の deploy/staging/version の履歴に無い）" >&2
      fail=1
      continue
    fi
  fi
  echo "promotion-check: ${env} ← ${sha} を通す"
done
exit "$fail"
