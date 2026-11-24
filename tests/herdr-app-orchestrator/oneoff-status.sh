#!/usr/bin/env bash
# Checks set-status.sh's one-off flags on a throwaway run directory: --oneoff and --pushed
# land in status.json, other fields stay, bad values are refused, "" clears them.
# hc, herdr-app and tokens.sh are not needed: the script only warns without them.
#
# Usage: bash tests/herdr-app-orchestrator/oneoff-status.sh
set -uo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
script=$repo/skills/herdr-app-orchestrator/scripts/set-status.sh
command -v jq >/dev/null || { echo "needs jq" >&2; exit 1; }

tmp=$(cd "$(mktemp -d)" && pwd -P)
trap 'rm -rf "$tmp"' EXIT
failed=0
check() { # check <description> <got> <want>
  if [ "$2" = "$3" ]; then echo "ok   $1"; else echo "FAIL $1"; echo "  got:  $(printf %q "$2")"; echo "  want: $(printf %q "$3")"; failed=1; fi
}
field() { jq -c "$1" "$tmp/run/status.json"; }

mkdir -p "$tmp/run" "$tmp/bin"
# Stubs so nothing reaches a real Herdr window or terminal, and no token count runs.
for cmd in hc herdr-app; do printf '#!/bin/sh\nexit 0\n' >"$tmp/bin/$cmd"; chmod +x "$tmp/bin/$cmd"; done
export PATH=$tmp/bin:$PATH
echo "Status: running" >"$tmp/run/plan.md"
jq -n '{terminal: "t1", tab_id: "tab1", folder: "/x/acme-app", branch: "oneoff-fix-typo"}' >"$tmp/run/orchestrator.json"

bash "$script" "$tmp/run" running --type fix --topic "Fix typo" >/dev/null 2>&1
check "no flags: oneoff absent" "$(field '.oneoff // "none"')" '"none"'
check "no flags: pushed absent" "$(field '.pushed // "none"')" '"none"'

bash "$script" "$tmp/run" --oneoff checkout >/dev/null 2>&1; check "--oneoff checkout: exit" "$?" 0
check "--oneoff checkout: field" "$(field .oneoff)" '"checkout"'
check "--oneoff keeps type" "$(field .type)" '"fix"'
check "--oneoff keeps topic" "$(field .topic)" '"Fix typo"'

bash "$script" "$tmp/run" --oneoff worktree >/dev/null 2>&1
check "--oneoff worktree: field" "$(field .oneoff)" '"worktree"'

bash "$script" "$tmp/run" --pushed oneoff-fix-typo >/dev/null 2>&1; check "--pushed: exit" "$?" 0
check "--pushed: field" "$(field .pushed)" '"oneoff-fix-typo"'
check "--pushed keeps oneoff" "$(field .oneoff)" '"worktree"'

bash "$script" "$tmp/run" finished >/dev/null 2>&1
check "later status keeps oneoff" "$(field .oneoff)" '"worktree"'
check "later status keeps pushed" "$(field .pushed)" '"oneoff-fix-typo"'
check "state finished" "$(field .state)" '"finished"'

bash "$script" "$tmp/run" --oneoff bogus >/dev/null 2>&1; check "--oneoff bogus refused (exit 2)" "$?" 2
check "refused value changed nothing" "$(field .oneoff)" '"worktree"'

bash "$script" "$tmp/run" --oneoff "" --pushed "" >/dev/null 2>&1
check "empty clears oneoff" "$(field .oneoff)" 'null'
check "empty clears pushed" "$(field .pushed)" 'null'

[ $failed -eq 0 ] && echo "all ok"
exit $failed
