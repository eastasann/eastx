#!/bin/bash
# クラウドセッションで DRAFT プラグイン (draft@draft-marketplace) を使えるようにする。
# クラウドセッションは .claude/settings.json の enabledPlugins を自動インストールしないため、ここで入れる。
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# CLI の進捗表示がセッションのコンテキストに入らないよう、出力は stderr に送る
{
  # add と install は導入済みなら何もしない。キャッシュされたコンテナでも最新版に揃えるため update も呼ぶ
  claude plugin marketplace add dwnfrc/DWNFRC-DRAFT
  claude plugin marketplace update draft-marketplace
  claude plugin install draft@draft-marketplace
  claude plugin update draft@draft-marketplace
} >&2

# SessionStart フックは Claude Code の起動後に走るので、このセッションでは /draft:* が読み込まれていないことがある。
# その場合に SKILL.md を直接読めるよう、場所をコンテキストに渡す（stdout はセッションのコンテキストに入る）
install_path=$(claude plugin list --json | jq -r '.[] | select(.id == "draft@draft-marketplace") | .installPath')
cat <<EOF
DRAFT プラグイン (draft@draft-marketplace) をこのコンテナにインストールした: ${install_path}
/draft:* のスキルが利用可能なスキル一覧に無い場合は、ユーザーに /reload-plugins を案内するか、
${install_path}/skills/<スキル名>/SKILL.md を直接読んでその手順に従う（例: /draft:guide → skills/guide/SKILL.md）。
EOF
