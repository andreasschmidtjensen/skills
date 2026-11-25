#!/bin/sh
# my-todos setup outside Herdr. Linux, macOS, and Windows through Git Bash.
#   setup.sh todo on|off <mods>       the to-do rule (CLAUDE.md, AGENTS.md), the `mytodo`
#                                     command (~/.local/bin) and its hook (UserPromptSubmit)
#   setup.sh default log|sync on|off  Log / Sync for projects that haven't set their own
# <mods>: Herdr's mods folder (forward slashes on Windows). Claude Code's settings
# are ~/.claude/settings.json; this mod's own hook entry is found by a marker in
# its command, so an older one is replaced and no one else's is touched.
set -u
cmd=${1:-} on=${2:-} mods=${3:-}
settings="$HOME/.claude/settings.json"

need_jq() { command -v jq >/dev/null 2>&1 || { echo "my-todos needs jq for this (https://jqlang.org/download/)" >&2; exit 4; }; }

# Claude Code's settings through jq: edit '<filter>' [jq args...].
edit() {
  need_jq
  mkdir -p "$HOME/.claude"; [ -s "$settings" ] || echo '{}' > "$settings"
  filter=$1; shift
  tmp=$(mktemp) || exit 1
  if jq "$@" "$filter" "$settings" > "$tmp" && [ -s "$tmp" ]; then cat "$tmp" > "$settings"; fi
  rm -f "$tmp"
}

# One of this mod's hooks on or off: hook <on|off> <event> <marker> <command>.
hook() {
  edit '
    .hooks[$ev] = ((.hooks[$ev] // []) | map(.hooks |= map(select((.command // "") | contains($m) | not))) | map(select(.hooks | length > 0)))
    | if $on == "on" then .hooks[$ev] += [{hooks: [{type: "command", command: $c}]}] else . end
    | if .hooks[$ev] == [] then del(.hooks[$ev]) else . end
    | if .hooks == {} then del(.hooks) else . end' \
    --arg on "$1" --arg ev "$2" --arg m "$3" --arg c "$4"
}

case "$cmd" in
  todo)
    t="$mods/my-todos/todo.sh"
    [ -f "$t" ] || { echo "No $t" >&2; exit 2; }
    sh "$t" --rule "$on"
    # The `mytodo` command agents run: a small wrapper (only this mod's own is ever
    # replaced or removed).
    w="$HOME/.local/bin/mytodo"
    ours() { grep -q 'my-todos wrapper' "$w" 2>/dev/null || { [ -L "$w" ] && readlink "$w" | grep -q my-todos; }; }
    if [ "$on" = on ]; then
      if [ ! -e "$w" ] || ours; then
        mkdir -p "$HOME/.local/bin" && rm -f "$w" \
          && printf '#!/bin/sh\n# my-todos wrapper (Options > To-do)\nexec sh "%s" "$@"\n' "$t" > "$w" && chmod +x "$w"
      fi
    elif ours; then rm -f "$w"; fi
    command -v jq >/dev/null 2>&1 && hook "$on" UserPromptSubmit my-todos/todo-hook.sh "sh \"$mods/my-todos/todo-hook.sh\""
    exit 0 ;;
  default)
    k=$on v=${3:-}
    case "$k:$v" in log:on|log:off|sync:on|sync:off) ;; *) echo "usage: setup.sh default log|sync on|off" >&2; exit 2 ;; esac
    d="${XDG_DATA_HOME:-$HOME/.local/share}/my-todos"; mkdir -p "$d"
    { grep -v "^$k " "$d/todo-defaults" 2>/dev/null; echo "$k $v"; } > "$d/todo-defaults.tmp" && mv "$d/todo-defaults.tmp" "$d/todo-defaults" ;;
  *) sed -n '2,8s/^# \{0,1\}//p' "$0"; exit 2 ;;
esac
