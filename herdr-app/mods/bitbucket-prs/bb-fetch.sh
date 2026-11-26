#!/bin/sh
# bb-fetch.sh <path-and-query>: GET https://api.bitbucket.org/2.0<path> and print the body.
# Credentials: workspace/email from ${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs/config,
# token from macOS Keychain (service bitbucket-prs, account = email) else $BITBUCKET_PRS_TOKEN.
# The secret goes to curl through `-K -` on stdin, never argv.
# $BB_API_BASE overrides the API base (tests).
#
# Output / exit codes:
#   0  body on stdout
#   2  HTTP error: {"error":{"kind":"http","status":N,"retryAfter":S|null}}
#   3  config missing: {"error":{"kind":"config","status":0,"missing":["workspace","email"]}}
#   4  token missing:  {"error":{"kind":"token","status":0}}
#   5  network/curl failure: {"error":{"kind":"network","status":0}}
#   6  usage error
# --config-status prints {"configured":bool,"workspace":"..","project":"..","missing":[..]} (no secrets), exit 0.

CONF="${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs/config"
BASE="${BB_API_BASE:-https://api.bitbucket.org/2.0}"

cfg() { [ -f "$CONF" ] && sed -n "s/^$1=//p" "$CONF" | head -n 1 | tr -d '\r'; }
WS=$(cfg workspace)
EMAIL=$(cfg email)
PROJ=$(cfg project)

token() {
  TOKEN=""
  if [ -n "$EMAIL" ] && command -v security >/dev/null 2>&1; then
    TOKEN=$(security find-generic-password -s bitbucket-prs -a "$EMAIL" -w 2>/dev/null)
  fi
  [ -n "$TOKEN" ] || TOKEN="${BITBUCKET_PRS_TOKEN:-}"
  [ -n "$TOKEN" ]
}

missing_list() {
  m=""
  [ -n "$WS" ] || m="\"workspace\""
  [ -n "$EMAIL" ] || m="${m:+$m,}\"email\""
  if [ -n "$EMAIL" ] && ! token; then m="${m:+$m,}\"token\""; fi
  printf '%s' "$m"
}

if [ "$1" = "--config-status" ]; then
  m=$(missing_list)
  if [ -z "$m" ]; then ok=true; else ok=false; fi
  printf '{"configured":%s,"workspace":"%s","project":"%s","missing":[%s]}\n' "$ok" "$(printf '%s' "$WS" | tr -d '"\\')" "$(printf '%s' "$PROJ" | tr -d '"\\')" "$m"
  exit 0
fi

[ -n "$1" ] || { printf '{"error":{"kind":"usage","status":0}}\n'; exit 6; }
case "$1" in /*) P="$1" ;; *) P="/$1" ;; esac

m=""
[ -n "$WS" ] || m="\"workspace\""
[ -n "$EMAIL" ] || m="${m:+$m,}\"email\""
if [ -n "$m" ]; then printf '{"error":{"kind":"config","status":0,"missing":[%s]}}\n' "$m"; exit 3; fi
token || { printf '{"error":{"kind":"token","status":0}}\n'; exit 4; }

esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }

T=$(mktemp -d "${TMPDIR:-/tmp}/bbfetch.XXXXXX") || exit 5
trap 'rm -rf "$T"' EXIT HUP INT TERM

CODE=$(printf 'user = "%s:%s"\nurl = "%s"\n' "$(esc "$EMAIL")" "$(esc "$TOKEN")" "$(esc "$BASE$P")" |
  curl -sS -K - -H 'Accept: application/json' -o "$T/body" -D "$T/hdr" -w '%{http_code}' 2>/dev/null)
RC=$?
if [ $RC -ne 0 ]; then printf '{"error":{"kind":"network","status":0}}\n'; exit 5; fi
# file:// URLs (tests) report 000 on success
[ "$CODE" = "000" ] && CODE=200

case "$CODE" in
  2??) cat "$T/body"; exit 0 ;;
esac
RA=$(sed -n 's/^[Rr]etry-[Aa]fter: *\([0-9][0-9]*\).*/\1/p' "$T/hdr" 2>/dev/null | head -n 1)
printf '{"error":{"kind":"http","status":%s,"retryAfter":%s}}\n' "$CODE" "${RA:-null}"
exit 2
