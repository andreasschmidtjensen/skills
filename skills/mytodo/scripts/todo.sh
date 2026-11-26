#!/bin/sh
# Per-project to-do lists, shared by people and agents (the my-todos panel,
# mods/my-todos, shows and edits the same files).
#   mytodo                     this project's list, numbered
#   mytodo all                 every project's
#   mytodo add [--under <n>] [--due "YYYY-MM-DD[ HH:MM]"] <text…>
#                              add to this project's (--under: as a sub-to-do of n, 3 levels max)
#   mytodo done|undo <n|text>  tick or untick item n (done ticks its open sub-to-dos too);
#                              n is a path (1, 1.2, 1.2.1) or an exact text
#   mytodo edit <n|text> <new…> reword item n (its due and tick stay)
#   mytodo rm <n>              delete item n and its sub-to-dos
#   mytodo clear               delete the fully ticked ones (item and all its sub-to-dos)
#   mytodo log [on|off]        this project: agents add what you ask for (default: Options › To-do)
#   mytodo sync [on|off]       this project: its TODO.md follows add/edit/rm (default: Options › To-do)
#   mytodo --rule on|off       add or remove the agents' to-do rule (CLAUDE.md, AGENTS.md)
# -p <folder> (first) picks the project; otherwise it's the git repo this runs in
# (its main checkout for a worktree), else this folder.
# Each list is ~/.local/share/my-todos/todos/<slug>.md (DIR): a "<!-- folder: … -->"
# line, then "- [ ] text" / "- [x] text" lines (fine to edit by hand).
# Installed by `setup.sh todo on` (or install.sh) as ~/.local/bin/mytodo, a
# small wrapper that runs this file (todo-cross.py is found next to it).
set -e
# The agents' rule (Options › To-do turns it on and off), between markers so it
# can be taken out again exactly: in CLAUDE.md, Codex's, Pi's and Kimi Code's
# AGENTS.md.
if [ "${1:-}" = --rule ]; then
  for f in "$HOME/.claude/CLAUDE.md" "$HOME/.codex/AGENTS.md" "$HOME/.pi/agent/AGENTS.md" "${KIMI_CODE_HOME:-$HOME/.kimi-code}/AGENTS.md"; do
    [ -d "$(dirname "$f")" ] || continue
    if [ -f "$f" ]; then
      tmp="$f.my-todos.$$"
      sed '/<!-- my-todos:todo -->/,/<!-- \/my-todos:todo -->/d' "$f" | awk 'NF { for (; n > 0; n--) print ""; print; next } { n++ }' > "$tmp" && mv "$tmp" "$f"
    fi
    [ "${2:-}" = on ] && { [ -s "$f" ] && printf '\n'; cat <<'EOF'
<!-- my-todos:todo -->
## Project to-do lists (Herdr)

Each project has a to-do list the user sees in Herdr's To-do panel and edits there
too. Use the `mytodo` command (it picks the project from the git repo you run it in):
`mytodo` lists it, `mytodo add <text>` adds, `mytodo done <n>` ticks, `mytodo rm <n>` deletes,
`mytodo all` shows every project's. While request logging is on
for that project
(`mytodo log` says; in Claude Code a note on each message says so), add each thing
the user asks for in a project (a change, a fix, a feature), even mid-task, as soon
as you read it, and tick it once it's done and checked; leave it open if it's only
partly done, and say so. When they change, narrow or drop a request, correct its
item instead of adding another: `mytodo edit <n> <new text>` rewords it, `mytodo rm <n>`
removes it. When they say to stop or start logging, run `mytodo log off` / `mytodo log on` (that project only). Also add an item when the user asks you to note something for later, or
when you leave follow-up work undone. Keep items short, one line each.

### Sub-to-dos

- Before adding, run `mytodo` and look for a main item the new one belongs to (e.g.
  "HAProxy"). If there is one, add it as a sub-to-do: `mytodo add --under <n> <text>`
  (n is a path like `1` or `1.2`, 3 levels max). Plain `mytodo add` makes a top-level item.
- When a request has more than one subtask, never add just the separate tasks: first add
  one main to-do for the request as a whole, then one sub-to-do under it
  (`mytodo add --under <n> <text>`) for each task. A request with a single task stays a
  single item.
- There is no move command: to move an item, `mytodo rm` it and re-add it with `--under`
  (keep its ticked state with `mytodo done`).
- Run `mytodo help` when unsure of the syntax instead of guessing.
<!-- /my-todos:todo -->
EOF
    } >> "$f"
  done
  exit 0
fi
# Where the lists live (the panel, main.js, uses the same folder).
DIR="${XDG_DATA_HOME:-$HOME/.local/share}/my-todos/todos"
# This script's own folder, through a symlink (todo-cross.py lives there).
SELF=$(readlink -f "$0" 2>/dev/null || printf %s "$0")
HERE=$(dirname "$SELF")
# Python 3 for todo-cross.py: python3, else python (as on Windows); none: no TODO.md sync.
PY=$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)
dir=$DIR
mkdir -p "$dir"
folder=""
if [ "$1" = "-p" ]; then folder=$(cd "$2" && pwd); shift 2; fi
if [ -z "$folder" ]; then
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)
  case "$common" in */.git) folder=${common%/.git} ;; *) folder=$(git rev-parse --show-toplevel 2>/dev/null || pwd) ;; esac
fi
folder=${folder%/}
# A project's Log or Sync: its own "<!-- log|sync: on|off -->" line, else the
# default `setup.sh default` writes to todo-defaults ("log on", "sync off").
DEFAULTS="${XDG_DATA_HOME:-$HOME/.local/share}/my-todos/todo-defaults"
opt() {
  v=$(sed -n "s/^<!-- $1: \([a-z]*\) -->\$/\1/p" "$file" 2>/dev/null | head -n 1)
  [ -n "$v" ] || v=$(sed -n "s/^$1 \([a-z]*\)\$/\1/p" "$DEFAULTS" 2>/dev/null | head -n 1)
  [ -n "$v" ] || { [ "$1" = log ] && v=on || v=off; }
  [ "$v" = on ]
}
# Sync on (`mytodo sync on`): the project's TODO.md follows add, edit and rm.
md() { [ -n "$PY" ] && opt sync && "$PY" -I "$HERE/todo-cross.py" "$folder" "$@" 2>/dev/null || true; }
slug=$(printf %s "$folder" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/-/g; s/^-//; s/-$//')
file="$dir/$slug.md"

# Item logic lives in todo-items.py (hierarchical numbers: 1, 1.2, 1.2.1).
need_py() { [ -n "$PY" ] || { echo "python3 is required" >&2; exit 1; }; }
itf() { need_py; f=$1; shift; "$PY" -I "$HERE/todo-items.py" "$f" "$@"; }
it() { itf "$file" "$@"; }
items() { [ -f "$1" ] && itf "$1" has; }
show() { itf "$1" show; }
# Item-level change for each text it printed (TODO.md sync, best-effort).
cross() { way=$1; while IFS= read -r t; do [ -n "$t" ] && [ -n "$PY" ] && "$PY" -I "$HERE/todo-cross.py" "$folder" "$way" "$t" 2>/dev/null || true; done; }

cmd=${1:-list}; [ $# -gt 0 ] && shift
case "$cmd" in
  list|ls) items "$file" && show "$file" || echo "No to-dos for $folder" ;;
  all)
    for f in "$dir"/*.md; do
      items "$f" || continue
      printf '%s\n' "$(sed -n 's/^<!-- folder: \(.*\) -->$/\1/p' "$f" | head -n 1 | sed "s#^$HOME#~#")"; show "$f"
    done ;;
  add)
    due=""; under=""
    while :; do
      case "${1:-}" in
        --due) due=$2; shift 2 ;;
        --under) under=${2:?parent item number}; shift 2 ;;
        *) break ;;
      esac
    done
    text=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$text" ] || { echo "usage: mytodo add [--under <n>] [--due <when>] <text>" >&2; exit 2; }
    [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
    if [ -n "$under" ]; then
      it add "$under" "${due:--}" "$text"
      ptext=$(it resolve "$under" 2>/dev/null || true)
      md add "$text" "$ptext"
    else
      it add - "${due:--}" "$text"
      md add "$text"
    fi
    echo "Added to $(printf %s "$folder" | sed "s#^$HOME#~#"): $text" ;;
  # Also crossed out (or back in) in the project's own TODO.md, if it lists it.
  # done ticks the item and its open sub-to-dos; undo only the item.
  done|check|undo|uncheck)
    case "$cmd" in done|check) way=done ;; *) way=undo ;; esac
    out=$(it "$way" "${1:?item number or text}")
    [ -n "$out" ] && printf '%s\n' "$out" | cross "$way" || true ;;
  edit|reword)
    n=${1:?item number or text}; shift
    new=$(printf '%s' "$*" | tr '\n' ' ' | sed 's/  *$//')
    [ -n "$new" ] || { echo "usage: mytodo edit <n|text> <new text>" >&2; exit 2; }
    old=$(it edit "$n" "$new")
    md rename "$old" "$new"
    echo "Now: $new" ;;
  # A project switch: "<!-- log|sync: on|off -->" under the folder line.
  log|sync)
    case "${1:-}" in on|off) want="<!-- $cmd: $1 -->" ;; "") want=keep ;; *) echo "usage: mytodo $cmd [on|off]" >&2; exit 2 ;; esac
    if [ "$want" != keep ]; then
      [ -f "$file" ] || printf '<!-- folder: %s -->\n' "$folder" > "$file"
      grep -v "^<!-- $cmd: [a-z]* -->\$" "$file" | awk -v w="$want" '{ print } NR == 1 && w != "" { print w }' > "$file.tmp" && mv "$file.tmp" "$file"
    fi
    if [ "$cmd" = log ]; then opt log && echo "Request logging: on" || echo "Request logging: off"
    else opt sync && echo "TODO.md sync: on" || echo "TODO.md sync: off"; fi ;;
  rm|delete)
    out=$(it rm "${1:?item number}")
    top=$(printf '%s\n' "$out" | head -n 1)
    [ -n "$top" ] && md rm "$top" || true ;;
  clear) [ -f "$file" ] && it clear || true ;;
  *) sed -n '2,15s/^# \{0,1\}//p' "$SELF"; exit 2 ;;
esac
