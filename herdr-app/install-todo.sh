#!/usr/bin/env bash
# Installs the My To-do panel into the Herdr app on this computer: the `my-todos` mod
# plus the `mytodo` command's scripts (skills/mytodo/scripts), copied next to it, since
# the panel, its hook and setup.sh find them there. It does not touch CLAUDE.md, the
# `mytodo` wrapper or hooks: the panel's "Set up" button does that. An earlier install
# that is a symlink (to a checkout) becomes a real folder; the checkout is left alone.
# Safe to run again. It refuses to replace a mod of that name that isn't ours.
#
# Usage: herdr-app/install-todo.sh
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
scripts="$here/../skills/mytodo/scripts"
home=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
dest="$home/mods/my-todos"
[ $# -eq 0 ] || { echo "usage: install-todo.sh" >&2; exit 2; }

[ -f "$scripts/todo.sh" ] || { echo "install-todo.sh: no $scripts/todo.sh" >&2; exit 1; }
if [ -e "$dest/main.js" ] && ! grep -q 'my-todos/todos' "$dest/main.js"; then
  echo "install-todo.sh: mods/my-todos exists and isn't the My To-do panel; move it aside first" >&2; exit 1
fi
[ ! -L "$dest" ] || rm "$dest"
mkdir -p "$dest"
cp "$here"/mods/my-todos/*.js "$here"/mods/my-todos/*.svg "$here"/mods/my-todos/mod.json \
  "$here"/mods/my-todos/setup.sh "$here"/mods/my-todos/todo-hook.sh "$dest/"
cp "$scripts"/todo.sh "$scripts"/todo-items.py "$scripts"/todo-cross.py "$dest/"
chmod +x "$dest"/todo.sh "$dest"/todo-cross.py "$dest"/todo-hook.sh
echo "installed mods/my-todos (panel and mytodo scripts)"
