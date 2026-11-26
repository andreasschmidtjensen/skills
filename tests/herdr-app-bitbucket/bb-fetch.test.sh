#!/bin/sh
# Tests for bb-fetch.sh with a stub curl on PATH. Usage: sh tests/herdr-app-bitbucket/bb-fetch.test.sh
HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/../../herdr-app/mods/bitbucket-prs/bb-fetch.sh"
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT
mkdir "$T/bin" "$T/home"
# Stub curl: records argv and stdin, answers from $STUB_CODE/$STUB_BODY/$STUB_HDR.
cat > "$T/bin/curl" <<'STUB'
#!/bin/sh
echo "$@" > "$T_REC/argv"; cat > "$T_REC/stdin"
while [ $# -gt 0 ]; do case "$1" in -o) printf '%s' "$STUB_BODY" > "$2"; shift;; -D) printf '%s' "$STUB_HDR" > "$2"; shift;; esac; shift; done
[ -n "$STUB_FAIL" ] && exit 7
printf '%s' "$STUB_CODE"
STUB
chmod +x "$T/bin/curl"
export T_REC="$T" PATH="$T/bin:$PATH" HOME="$T/home" XDG_CONFIG_HOME="$T/home/.config" BITBUCKET_PRS_TOKEN="tok-SECRET"
FAILS=0
check() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1: got [$2] want [$3]"; FAILS=$((FAILS+1)); fi; }

out=$(sh "$SCRIPT" /user); check "missing config exit" "$?" 3
check "missing config json" "$out" '{"error":{"kind":"config","status":0,"missing":["workspace","email"]}}'

mkdir -p "$XDG_CONFIG_HOME/bitbucket-prs"
printf 'workspace=acme\nemail=kim@example.com\nproject=ACME\n' > "$XDG_CONFIG_HOME/bitbucket-prs/config"
check "config-status ok (no secret)" "$(sh "$SCRIPT" --config-status)" '{"configured":true,"workspace":"acme","project":"ACME","missing":[]}'

out=$(STUB_CODE=200 STUB_BODY='{"uuid":"{x}"}' sh "$SCRIPT" /user); check "success exit" "$?" 0
check "success body" "$out" '{"uuid":"{x}"}'
check "secret not in argv" "$(grep -c SECRET "$T/argv")" 0
check "secret on stdin" "$(grep -c 'user = "kim@example.com:tok-SECRET"' "$T/stdin")" 1
check "url on stdin" "$(grep -c 'url = "https://api.bitbucket.org/2.0/user"' "$T/stdin")" 1

BB_API_BASE=http://127.0.0.1:9 STUB_CODE=200 STUB_BODY='{}' sh "$SCRIPT" /x >/dev/null
check "BB_API_BASE honoured" "$(grep -c 'url = "http://127.0.0.1:9/x"' "$T/stdin")" 1

out=$(STUB_CODE=429 STUB_HDR='HTTP/2 429
Retry-After: 42
' sh "$SCRIPT" /user); check "429 exit" "$?" 2
check "429 json" "$out" '{"error":{"kind":"http","status":429,"retryAfter":42}}'

out=$(STUB_CODE=401 STUB_HDR='HTTP/2 401
' sh "$SCRIPT" /user)
check "401 json" "$out" '{"error":{"kind":"http","status":401,"retryAfter":null}}'

out=$(STUB_FAIL=1 sh "$SCRIPT" /user); check "network exit" "$?" 5
check "network json" "$out" '{"error":{"kind":"network","status":0}}'

unset BITBUCKET_PRS_TOKEN
out=$(sh "$SCRIPT" /user); check "missing token exit" "$?" 4
check "missing token status" "$(sh "$SCRIPT" --config-status)" '{"configured":false,"workspace":"acme","project":"ACME","missing":["token"]}'
[ $FAILS -eq 0 ] && echo "all passed" || { echo "$FAILS failed"; exit 1; }
