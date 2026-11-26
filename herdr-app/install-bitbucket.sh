#!/usr/bin/env bash
# Installs the Bitbucket PRs panel into the Herdr app on this computer: copies the
# `bitbucket-prs` mod and docks it below the My To-do block in a layout, in one column
# (to-do on top, this below, half each; the column keeps the to-do block's width).
# Safe to run again: the dock is detected, and a timestamped backup of the layout
# (<layout>.json.bak-<time>) is taken before every change. Layout files are written
# atomically. It doesn't touch the harbormaster mod or install.sh. It refuses to replace
# a mod folder of that name that isn't ours (ours: it holds the marker file
# `.installed-by-install-bitbucket`, or its main.js mentions `bitbucket-prs`).
#
# Usage: herdr-app/install-bitbucket.sh [--layout <name>] [--uninstall]
#   --layout <name>  the layout (file layouts/<name>.json) to dock into. Without it, the one
#                    layout with a my-todos block; with several, they are listed and this exits 2.
#   --uninstall      puts the to-do block back on its own (original width) and removes the mod.
#                    Without --layout, in every layout that has our dock.
# Needs jq.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
src="$here/mods/bitbucket-prs"
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
dest="$home/mods/bitbucket-prs"
layouts="$home/layouts"
marker=".installed-by-install-bitbucket"
col=bitbucket-prs-column
layout="" uninstall=0
while [ $# -gt 0 ]; do
  case "$1" in
    --layout) [ $# -ge 2 ] || { echo "install-bitbucket.sh: --layout needs a name" >&2; exit 2; }; layout=${2%.json}; shift 2 ;;
    --uninstall) uninstall=1; shift ;;
    *) echo "usage: install-bitbucket.sh [--layout <name>] [--uninstall]" >&2; exit 2 ;;
  esac
done
case "$layout" in */*|.*) echo "install-bitbucket.sh: --layout takes a layout name, not a path" >&2; exit 2 ;; esac
command -v jq >/dev/null 2>&1 || { echo "install-bitbucket.sh: needs jq (https://jqlang.org/download/)" >&2; exit 1; }

# jq: does the layout have a block with this mod?
has_mod='[.. | objects | select(.type? == "block" and .content.mod? == $m)] | length > 0'
# Wraps only the first my-todos block, so ids stay unique.
dock='
  first(paths(type == "object" and .type? == "block" and .content.mod? == "my-todos")) as $p
  | getpath($p) as $b
  | setpath($p; {id: $col, type: "column",
      children: [($b | .size = {weight: 1}), {id: "bitbucket-prs", type: "block", content: {mod: "bitbucket-prs"}, size: {weight: 1}}],
      size: ($b.size // {})})'
# Writes the layout $1 through jq filter $2 (extra jq args after): backup, then atomic replace.
edit_layout() {
  local f=$1 filter=$2; shift 2
  local tmp; tmp=$(mktemp "$f.tmp.XXXXXX")
  if ! jq "$@" "$filter" "$f" > "$tmp" || [ ! -s "$tmp" ]; then rm -f "$tmp"; echo "install-bitbucket.sh: jq failed on $f" >&2; exit 1; fi
  cp -p "$f" "$f.bak-$(date +%Y%m%d-%H%M%S)"
  mv "$tmp" "$f"
}

# Layout files (names without .json) that have a block of mod $1.
with_mod() {
  local f
  for f in "$layouts"/*.json; do
    [ -f "$f" ] || continue
    jq -e --arg m "$1" "$has_mod" "$f" >/dev/null 2>&1 && basename "$f" .json
  done
  return 0
}

if [ "$uninstall" = 1 ]; then
  if [ -n "$layout" ]; then targets=$layout; else targets=$(with_mod bitbucket-prs); fi
  for n in $targets; do
    f="$layouts/$n.json"; [ -f "$f" ] || { echo "install-bitbucket.sh: no layout $n" >&2; exit 1; }
    if jq -e --arg col "$col" '[.. | objects | select(.id? == $col)] | length > 0' "$f" >/dev/null; then
      # the column's size goes back onto the to-do block
      edit_layout "$f" 'walk(if type == "object" and .id? == $col and .type? == "column" then
          (.size as $s | (.children[] | select(.content.mod? == "my-todos")) | .size = $s) else . end)' --arg col "$col"
      echo "undocked in layout $n"
    fi
  done
  if [ -e "$dest" ]; then
    if [ -f "$dest/$marker" ] || { [ -f "$dest/main.js" ] && grep -q 'bitbucket-prs' "$dest/main.js"; }; then
      rm -rf "$dest"; echo "removed mods/bitbucket-prs"
    else echo "install-bitbucket.sh: mods/bitbucket-prs isn't ours; left alone" >&2; exit 1; fi
  fi
  exit 0
fi

[ -d "$src" ] || { echo "install-bitbucket.sh: no $src" >&2; exit 1; }
if [ -e "$dest" ] && [ ! -f "$dest/$marker" ] && ! { [ -f "$dest/main.js" ] && grep -q 'bitbucket-prs' "$dest/main.js"; }; then
  echo "install-bitbucket.sh: mods/bitbucket-prs exists and isn't the Bitbucket PRs panel; move it aside first" >&2; exit 1
fi

# Pick the layout before copying anything, so exit 2 changes nothing.
if [ -z "$layout" ]; then
  cands=$(with_mod my-todos; with_mod bitbucket-prs) ; cands=$(printf '%s\n' "$cands" | sed '/^$/d' | sort -u)
  n=$(printf '%s' "$cands" | grep -c . || true)
  if [ "$n" -gt 1 ]; then
    echo "install-bitbucket.sh: several layouts have a my-todos block; pick one with --layout <name>:" >&2
    printf '  %s\n' $cands >&2; exit 2
  fi
  layout=$cands
fi

if [ -n "$layout" ]; then
  f="$layouts/$layout.json"; [ -f "$f" ] || { echo "install-bitbucket.sh: no layout $layout" >&2; exit 1; }
  jq -e --arg m my-todos "$has_mod" "$f" >/dev/null || jq -e --arg m bitbucket-prs "$has_mod" "$f" >/dev/null \
    || { echo "install-bitbucket.sh: layout $layout has no my-todos block" >&2; exit 1; }
fi

# Replace the folder, so files dropped from the source don't linger (it is ours, checked above).
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$src"/. "$dest"/
chmod +x "$dest"/*.sh 2>/dev/null || true
: > "$dest/$marker"
echo "installed mods/bitbucket-prs"

if [ -z "$layout" ]; then
  echo "no layout has a my-todos block, so the panel is not docked; add {\"mod\":\"bitbucket-prs\"} to a layout yourself" >&2; exit 0
fi
f="$layouts/$layout.json"
if jq -e --arg m bitbucket-prs "$has_mod" "$f" >/dev/null; then echo "already docked in layout $layout"; exit 0; fi
edit_layout "$f" "$dock" --arg col "$col"
echo "docked below My To-do in layout $layout"
