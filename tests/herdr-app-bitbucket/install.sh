#!/bin/sh
# Tests for herdr-app/install-bitbucket.sh and the mod's setup.sh. Run: sh tests/herdr-app-bitbucket/install.sh
cd "$(dirname "$0")/../.." || exit 1
exec </dev/null
R=$(pwd)
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
H="$T/home"; export HERDR_APP_HOME="$H"
INST="$R/herdr-app/install-bitbucket.sh"
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
check() { if (eval "$2"); then ok "$1"; else bad "$1"; fi; }

mkdir -p "$H/layouts" "$H/mods/harbormaster"
echo "harbor" > "$H/mods/harbormaster/main.js"
cat > "$H/layouts/team-main.json" <<'J'
{"id":"root","type":"row","children":[
 {"id":"sidebar","type":"block","content":{"mod":"spaces"},"size":{"px":268}},
 {"id":"work","type":"block","content":{"mod":"tabs"}},
 {"id":"todo1","type":"block","content":{"mod":"my-todos"},"size":{"px":368}}]}
J
cat > "$H/layouts/plain.json" <<'J'
{"id":"root","type":"row","children":[{"id":"w","type":"block","content":{"mod":"tabs"}}]}
J
cp "$H/layouts/team-main.json" "$T/orig.json"
cp "$H/layouts/plain.json" "$T/plain.orig"
HARBOR=$(cd "$H/mods" && find harbormaster -type f | sort | xargs cat | cksum)
L="$H/layouts/team-main.json"
dockq='.children[2]'

bash "$INST" >"$T/out" 2>&1
check "install succeeds" '[ -f "$H/mods/bitbucket-prs/setup.sh" ] && [ -f "$H/mods/bitbucket-prs/.installed-by-install-bitbucket" ]'
check "column holds to-do on top, panel below" '[ "$(jq -c "$dockq | [.id, .type, (.children | map(.content.mod)), (.children | map(.size.weight)), .size]" "$L")" = "[\"bitbucket-prs-column\",\"column\",[\"my-todos\",\"bitbucket-prs\"],[1,1],{\"px\":368}]" ]'
check "other blocks untouched" '[ "$(jq -c ".children[0:2]" "$L")" = "$(jq -c ".children[0:2]" "$T/orig.json")" ]'
check "backup created, equals the original" 'set -- "$H"/layouts/team-main.json.bak-*; [ -f "$1" ] && cmp -s "$1" "$T/orig.json"'
check "layout without my-todos untouched" 'cmp -s "$H/layouts/plain.json" "$T/plain.orig"'

cp "$L" "$T/after1.json"
bash "$INST" >/dev/null 2>&1
check "second run changes nothing" 'cmp -s "$L" "$T/after1.json"'
check "second run takes no second backup" '[ "$(ls "$H"/layouts/team-main.json.bak-* | wc -l | tr -d " ")" = 1 ]'

# several candidates: list and exit 2, change nothing
cp "$T/orig.json" "$H/layouts/other.json"
bash "$INST" >"$T/out" 2>&1; rc=$?
check "several candidates: exit 2" '[ $rc = 2 ]'
check "several candidates: both listed" 'grep -q team-main "$T/out" && grep -q other "$T/out"'
check "several candidates: --layout picks one" 'bash "$INST" --layout other >/dev/null 2>&1 && jq -e "[.. | objects | select(.id? == \"bitbucket-prs-column\")] | length == 1" "$H/layouts/other.json" >/dev/null'
rm -f "$H/layouts/other.json"*

# --layout with a missing layout: nothing is installed
rm -rf "$H/mods/bitbucket-prs"
bash "$INST" --layout typo >/dev/null 2>&1; rc=$?
check "missing --layout: exit 1, nothing installed" '[ $rc = 1 ] && [ ! -e "$H/mods/bitbucket-prs" ]'
bash "$INST" --layout plain >/dev/null 2>&1; rc=$?
check "--layout without my-todos: exit 1, nothing installed" '[ $rc = 1 ] && [ ! -e "$H/mods/bitbucket-prs" ]'
bash "$INST" >/dev/null 2>&1

# a stale file in the installed mod goes on re-install
touch "$H/mods/bitbucket-prs/stale.js"
bash "$INST" >/dev/null 2>&1
check "re-install drops files not in the source" '[ ! -e "$H/mods/bitbucket-prs/stale.js" ] && [ -f "$H/mods/bitbucket-prs/setup.sh" ]'

# two my-todos blocks: only the first is wrapped
jq '.children += [{"id":"todo2","type":"block","content":{"mod":"my-todos"},"size":{"px":300}}]' "$T/orig.json" > "$H/layouts/dup.json"
bash "$INST" --layout dup >/dev/null 2>&1
check "two my-todos blocks: one column, ids unique" '[ "$(jq "[.. | objects | select(.id? == \"bitbucket-prs-column\")] | length" "$H/layouts/dup.json")" = 1 ] && [ "$(jq "[.. | objects | select(.id? == \"todo2\")] | length" "$H/layouts/dup.json")" = 1 ] && [ "$(jq -c ".children[3] | [.id, .size]" "$H/layouts/dup.json")" = "[\"todo2\",{\"px\":300}]" ]'
rm -f "$H/layouts/dup.json"*

# uninstall round trip
bash "$INST" --uninstall >/dev/null 2>&1
check "uninstall restores the layout" '[ "$(jq -S . "$L")" = "$(jq -S . "$T/orig.json")" ]'
check "uninstall removes the mod folder" '[ ! -e "$H/mods/bitbucket-prs" ]'
bash "$INST" --uninstall >/dev/null 2>&1; rc=$?
check "uninstall twice is fine" '[ $rc = 0 ]'

# foreign folder
mkdir -p "$H/mods/bitbucket-prs"; echo "someone else" > "$H/mods/bitbucket-prs/main.js"
cp "$L" "$T/before-foreign.json"
bash "$INST" >"$T/out" 2>&1; rc=$?
check "foreign mod folder: refused" '[ $rc = 1 ] && [ "$(cat "$H/mods/bitbucket-prs/main.js")" = "someone else" ]'
check "foreign mod folder: layout untouched" 'cmp -s "$L" "$T/before-foreign.json"'
bash "$INST" --uninstall >/dev/null 2>&1
check "foreign mod folder: uninstall leaves it" '[ -f "$H/mods/bitbucket-prs/main.js" ]'
rm -rf "$H/mods/bitbucket-prs"

check "harbormaster files untouched" '[ "$(cd "$H/mods" && find harbormaster -type f | sort | xargs cat | cksum)" = "$HARBOR" ]'

# setup.sh
S="$R/herdr-app/mods/bitbucket-prs/setup.sh"
export XDG_CONFIG_HOME="$T/xdg" BB_KEYCHAIN=none
BB_SETUP_WORKSPACE=acme BB_SETUP_EMAIL=kim@example.com BB_SETUP_TOKEN=sekret-token-123 sh "$S" token >"$T/out" 2>&1
C="$T/xdg/bitbucket-prs/config"
check "setup: config content" '[ "$(cat "$C")" = "workspace=acme
email=kim@example.com" ]'
check "setup: no project line when empty" '! grep -q project "$C"'
check "setup: config mode 600" '[ "$(ls -l "$C" | cut -c1-10)" = "-rw-------" ]'
check "setup: token not in config or output" '! grep -rq sekret-token-123 "$T/xdg" "$T/out"'
sh "$S" status >"$T/out" 2>&1
check "status: shows workspace and email" 'grep -q "workspace: acme" "$T/out" && grep -q "email: kim@example.com" "$T/out"'
check "status: no project" 'grep -q "project: none" "$T/out"'
check "status: no secrets" '! grep -q sekret "$T/out"'
BB_SETUP_WORKSPACE=acme BB_SETUP_EMAIL=kim@example.com BB_SETUP_PROJECT=WEB BB_SETUP_TOKEN=sekret-token-123 sh "$S" token >"$T/out" 2>&1
check "setup: project line written" '[ "$(cat "$C")" = "workspace=acme
email=kim@example.com
project=WEB" ]'
sh "$S" status >"$T/out" 2>&1
check "status: shows project" 'grep -q "project: WEB" "$T/out"'
BB_SETUP_WORKSPACE=acme BB_SETUP_EMAIL=kim@example.com BB_SETUP_PROJECT='a b' BB_SETUP_TOKEN=x sh "$S" token >/dev/null 2>&1; rc=$?
check "setup: bad project key rejected" '[ $rc = 2 ]'
BB_SETUP_WORKSPACE='bad name' BB_SETUP_EMAIL=kim@example.com BB_SETUP_TOKEN=x sh "$S" token >/dev/null 2>&1; rc=$?
check "setup: bad workspace rejected" '[ $rc = 2 ]'
BB_SETUP_WORKSPACE=acme BB_SETUP_EMAIL=kim@example.com BB_SETUP_TOKEN='a"b' sh "$S" token >/dev/null 2>&1; rc=$?
check "setup: token with a quote rejected" '[ $rc = 2 ]'
rm -rf "$T/xdg"; sh "$S" status >"$T/out" 2>&1
check "status without config" 'grep -q "config: none" "$T/out"'

[ $fail = 0 ] && echo "all passed" || { echo "FAILED"; exit 1; }
