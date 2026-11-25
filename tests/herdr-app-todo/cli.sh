#!/bin/sh
# Tests for skills/mytodo/scripts/todo.sh (sub-to-dos). Run: sh tests/herdr-app-todo/cli.sh
cd "$(dirname "$0")/../.." || exit 1
exec </dev/null   # nothing in the test may wait on stdin
export GIT_EDITOR=true GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false
TODO=$(pwd)/skills/mytodo/scripts/todo.sh
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
export XDG_DATA_HOME="$T/xdg"; mkdir -p "$T/proj" "$T/xdg"
git -C "$T/proj" init -q
P=$(cd "$T/proj" && pwd -P)
slug=$(printf %s "$P" | sed 's/[^A-Za-z0-9][^A-Za-z0-9]*/-/g; s/^-//; s/-$//')
F="$XDG_DATA_HOME/my-todos/todos/$slug.md"
fail=0
t() { "$TODO" -p "$P" "$@"; }
# Done stamps hold the current minute, so compare them with the time replaced.
norm() { sed -E 's/\(done [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}\)/(done STAMP)/'; }
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
eq() { [ "$2" = "$3" ] && ok "$1" || { bad "$1"; printf '  want:\n%s\n  got:\n%s\n' "$2" "$3"; }; }
mkdir -p "$(dirname "$F")"

# Legacy flat file round-trips byte-identical after list
printf '<!-- folder: %s -->\n- [ ] one <!-- due: 2030-01-01 -->\n- [x] two <!-- done: 2026-01-01 10:00 -->\n- [ ] three\n' "$P" > "$F"
cp "$F" "$T/legacy"
out=$(t list)
cmp -s "$F" "$T/legacy" && ok "flat legacy unchanged after list" || bad "flat legacy unchanged after list"
eq "flat numbering" "1. [ ] one  (due 2030-01-01)
2. [x] two  (done 2026-01-01 10:00)
3. [ ] three" "$out"

# Odd indent (shared fixture with tests/tree.test.mjs): depth = spaces/2 rounded down
cp tests/herdr-app-todo/fixtures/odd-indent.md "$F"
eq "odd indent numbering" "1. [ ] a
  1.1. [ ] b odd three
2. [ ] c odd one
  2.1. [ ] d five
    2.1.1. [x] e six  (done 2026-01-01 10:00)
    2.1.2. [ ] f eight" "$(t list)"
cmp -s "$F" tests/herdr-app-todo/fixtures/odd-indent.md && ok "odd indent untouched after list" || bad "odd indent untouched after list"

# Top-level add: file without trailing newline, and with trailing blank lines
printf -- '- [ ] x' > "$F"; t add y >/dev/null
[ "$(cat "$F")" = "- [ ] x
- [ ] y" ] && [ "$(tail -c1 "$F" | od -An -c | tr -d ' ')" = '\n' ] && ok "no trailing newline: items not glued, newline added" || bad "no trailing newline: items not glued, newline added"
printf -- '- [ ] x\n\n\n' > "$F"; t add y >/dev/null
[ "$(cat "$F"; echo .)" = "$(printf -- '- [ ] x\n- [ ] y\n\n\n.')" ] && ok "trailing blank lines kept below the new item" || bad "trailing blank lines kept below the new item"
printf -- '- [ ] x' > "$F"; t add --under 1 k >/dev/null
[ "$(cat "$F"; echo .)" = "$(printf -- '- [ ] x\n  - [ ] k\n.')" ] && ok "add --under without trailing newline" || bad "add --under without trailing newline"
t add --due 2030-01-01 z >/dev/null
grep -qx -- '- \[ \] z <!-- due: 2030-01-01 -->' "$F" && ok "top-level add keeps due" || bad "top-level add keeps due"
rm -f "$F"

# add / --under / numbering
rm -f "$F"
t add A >/dev/null; t add B >/dev/null
t add --under 1 A1 >/dev/null
t add --under 1 --due 2030-02-02 A2 >/dev/null
t add --under 1.2 A2a >/dev/null
t add --under 1 A3 >/dev/null
t add C >/dev/null
eq "add --under numbering" "1. [ ] A
  1.1. [ ] A1
  1.2. [ ] A2  (due 2030-02-02)
    1.2.1. [ ] A2a
  1.3. [ ] A3
2. [ ] B
3. [ ] C" "$(t list)"
grep -q '^    - \[ \] A2a$' "$F" && ok "indent 2 spaces per level" || bad "indent 2 spaces per level"
t add --under 1.2.1 deep >/dev/null 2>&1; [ $? -ne 0 ] && ok "depth limit errors" || bad "depth limit errors"
t add --under 1.2.1 deep 2>&1 | grep -q . && ok "depth limit message" || bad "depth limit message"
t add --under 9 x >/dev/null 2>&1; [ $? -eq 1 ] && ok "add --under bad path exit 1" || bad "add --under bad path exit 1"
eq "bad path message" "No item 1.9" "$(t done 1.9 2>&1)"
t done 1.9 >/dev/null 2>&1; [ $? -eq 1 ] && ok "bad path exit 1" || bad "bad path exit 1"
t rm 7 >/dev/null 2>&1; [ $? -eq 1 ] && ok "rm bad path exit 1" || bad "rm bad path exit 1"
t edit 3.1 x >/dev/null 2>&1; [ $? -eq 1 ] && ok "edit bad path exit 1" || bad "edit bad path exit 1"

# done cascades (each descendant stamped); undo single
t done 1.2 >/dev/null
eq "done cascades to descendants" "1. [ ] A
  1.1. [ ] A1
  1.2. [x] A2  (due 2030-02-02)  (done STAMP)
    1.2.1. [x] A2a  (done STAMP)
  1.3. [ ] A3
2. [ ] B
3. [ ] C" "$(t list | norm)"
[ "$(grep -c 'done:' "$F")" = 2 ] && ok "each ticked item has its own stamp" || bad "each ticked item has its own stamp"
t undo 1.2 >/dev/null
eq "undo only the item" "1. [ ] A
  1.1. [ ] A1
  1.2. [ ] A2  (due 2030-02-02)
    1.2.1. [x] A2a  (done STAMP)
  1.3. [ ] A3
2. [ ] B
3. [ ] C" "$(t list | norm)"
t done A2 >/dev/null
t list | grep -q '1.2. \[x\] A2' && ok "done by exact text" || bad "done by exact text"
t undo 1.2.1 >/dev/null; t undo 1.2 >/dev/null

# edit keeps indent, due, tick
t done 1.2.1 >/dev/null
t edit 1.2.1 "A2a renamed" >/dev/null
t edit 1.2 "A2 renamed" >/dev/null
grep -q '^  - \[ \] A2 renamed <!-- due: 2030-02-02 -->$' "$F" && ok "edit keeps indent and due" || bad "edit keeps indent and due"
grep -q '^    - \[x\] A2a renamed <!-- done: ' "$F" && ok "edit keeps indent and tick" || bad "edit keeps indent and tick"

# rm subtree
t rm 1.2 >/dev/null
eq "rm removes subtree" "1. [ ] A
  1.1. [ ] A1
  1.2. [ ] A3
2. [ ] B
3. [ ] C" "$(t list)"

# done/undo keep the original indent of a hand-written line
printf '<!-- folder: %s -->\n- [ ] H\n      - [ ] deep\n' "$P" > "$F"
t done 1.1 >/dev/null; grep -q '^      - \[x\] deep ' "$F" && ok "done keeps original indent" || bad "done keeps original indent"
t undo 1.1 >/dev/null; grep -q '^      - \[ \] deep$' "$F" && ok "undo keeps original indent" || bad "undo keeps original indent"

# clear rules
rm -f "$F"
t add P1 >/dev/null; t add --under 1 c1 >/dev/null; t add --under 1 c2 >/dev/null
t add P2 >/dev/null; t add --under 2 d1 >/dev/null
t add P3 >/dev/null; t add --under 3 e1 >/dev/null; t add --under 3.1 e1a >/dev/null; t add --under 3 e2 >/dev/null
t done 2 >/dev/null          # P2 + d1 fully done, top-level
t done 1.1 >/dev/null        # done child under open parent
t done 3.1 >/dev/null        # e1 + e1a done under open P3; e2 open
t done P1 >/dev/null && t undo P1 >/dev/null   # P1 open, c1 and c2 done
t undo 1.2 >/dev/null        # c2 open again
t clear
eq "clear removes fully-done subtrees" "1. [ ] P1
  1.1. [ ] c2
2. [ ] P3
  2.1. [ ] e2" "$(t list)"
# done top-level parent with open child is not cleared; done parent with all-done kids is
rm -f "$F"; t add Q >/dev/null; t add --under 1 k >/dev/null; t done 1.1 >/dev/null; t done 1 >/dev/null; t undo 1.1 >/dev/null; t clear
eq "done parent with open child survives clear" "1. [x] Q  (done STAMP)
  1.1. [ ] k" "$(t list | norm)"

# all
t add --under 1 z >/dev/null
t all | grep -q '^  1.2. \[ \] z' && ok "all prints hierarchy" || bad "all prints hierarchy"

# Sync into TODO.md
rm -f "$F"; printf '# To-do\n\n- [ ] S1\n- [ ] S2\n' > "$T/proj/TODO.md"
t sync on >/dev/null; t add S1 >/dev/null; t add S2 >/dev/null
t add --under 1 kid >/dev/null
eq "sync add --under indents under parent" "# To-do

- [ ] S1
  - [ ] kid
- [ ] S2" "$(cat "$T/proj/TODO.md")"
t add --under 1 kid2 >/dev/null
t done 1 >/dev/null
eq "sync done cascades" "# To-do

- [x] S1
  - [x] kid
  - [x] kid2
- [ ] S2" "$(cat "$T/proj/TODO.md")"
t rm 1 >/dev/null
eq "sync rm removes subtree" "# To-do

- [ ] S2" "$(cat "$T/proj/TODO.md")"

# python3 missing: list says so instead of "No to-dos"
mkdir -p "$T/nopy"; for c in sh sed git readlink dirname mkdir cd pwd tr head cat grep awk; do p=$(command -v $c) && ln -sf "$p" "$T/nopy/$c"; done
msg=$(PATH="$T/nopy" "$TODO" -p "$P" list 2>&1); eq "list without python3" "python3 is required" "$msg"

[ $fail -eq 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }
