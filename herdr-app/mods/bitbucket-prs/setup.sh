#!/bin/sh
# bitbucket-prs setup outside Herdr. macOS (Keychain); other systems use BITBUCKET_PRS_TOKEN.
#   setup.sh token    asks for workspace, Atlassian email, an optional project key and API
#                     token (silent); previous values are offered in [brackets], Enter keeps
#                     them, `-` clears the project key (= whole workspace). Writes
#                     the config file (mode 600, no token in it), stores the token in the Keychain
#   setup.sh status   shows what is configured, never the token
# Config: ${XDG_CONFIG_HOME:-~/.config}/bitbucket-prs/config (workspace=, email=, project=, and
# repos=a,b written by the panel's Repos chooser; `token` keeps an existing repos= line unless the project changes).
# Keychain: service bitbucket-prs, account = the email.
# For tests: BB_SETUP_WORKSPACE, BB_SETUP_EMAIL, BB_SETUP_PROJECT, BB_SETUP_TOKEN skip the prompts;
# BB_KEYCHAIN=none skips the real Keychain.
set -u
cfgdir="${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs"
cfg="$cfgdir/config"
svc=bitbucket-prs

# Value of key $1 from the config file.
get() { sed -n "s/^$1=//p" "$cfg" 2>/dev/null | head -n 1; }

# Prompt for $2 (label) into variable named $1; $3 = secret turns echo off; $4 is the
# previous value, shown in [brackets] and kept when you just press Enter.
ask() {
  printf '%s%s: ' "$2" "${4:+ [$4]}" >&2
  if [ "${3:-}" = secret ] && [ -t 0 ]; then
    stty -echo 2>/dev/null; trap 'stty echo 2>/dev/null' EXIT INT TERM
    IFS= read -r v; stty echo 2>/dev/null; trap - EXIT INT TERM; echo >&2
  else
    IFS= read -r v
  fi
  [ -n "$v" ] || v=${4:-}
  eval "$1=\$v"
}

has_token_in_keychain() {
  [ "${BB_KEYCHAIN:-}" != none ] && command -v security >/dev/null 2>&1 \
    && security find-generic-password -s "$svc" -a "$1" >/dev/null 2>&1
}

case "${1:-}" in
  token)
    ws=${BB_SETUP_WORKSPACE:-}; email=${BB_SETUP_EMAIL:-}; tok=${BB_SETUP_TOKEN:-}; proj=${BB_SETUP_PROJECT:-}
    [ -n "$ws" ] || ask ws "Bitbucket workspace (the slug in bitbucket.org/<workspace>)" "" "$(get workspace)"
    [ -n "$email" ] || ask email "Atlassian account email" "" "$(get email)"
    [ -n "${BB_SETUP_PROJECT+x}" ] || ask proj "Bitbucket project key (optional; - = whole workspace)" "" "$(get project)"; [ "$proj" != "-" ] || proj=""
    [ -n "$tok" ] || ask tok "Bitbucket API token (not shown)" secret
    case "$ws" in ''|*[!A-Za-z0-9._-]*) echo "workspace must be a slug: letters, digits, . _ -" >&2; exit 2 ;; esac
    case "$email" in ''|*[!A-Za-z0-9._+@-]*|*@*@*|@*|*@) echo "that doesn't look like an email address" >&2; exit 2 ;; esac
    case "$email" in *@*) ;; *) echo "that doesn't look like an email address" >&2; exit 2 ;; esac
    case "$proj" in *[!A-Za-z0-9_]*) echo "project key: letters, digits, _ only (or empty)" >&2; exit 2 ;; esac
    [ -n "$tok" ] || { echo "no token given" >&2; exit 2; }
    # security -i reads quoted words, so keep quote, backslash and line breaks out.
    case "$tok" in *\"*|*\\*|*"
"*) echo "the token has a character (quote, backslash, line break) this script can't pass on; paste it as is from Bitbucket" >&2; exit 2 ;; esac
    old=$(get email)
    old_proj=$(get project)
    repos_line=$(sed -n '/^repos=/p' "$cfg" 2>/dev/null | head -n 1)
    mkdir -p "$cfgdir" && chmod 700 "$cfgdir" 2>/dev/null
    tmp=$(mktemp "$cfgdir/.config.XXXXXX") || exit 1
    chmod 600 "$tmp"
    { printf 'workspace=%s\nemail=%s\n' "$ws" "$email"; [ -z "$proj" ] || printf 'project=%s\n' "$proj"; [ -z "$repos_line" ] || [ "$old_proj" != "$proj" ] || printf '%s\n' "$repos_line"; } > "$tmp" && mv "$tmp" "$cfg" || { rm -f "$tmp"; exit 1; }
    chmod 600 "$cfg"
    if [ "${BB_KEYCHAIN:-}" = none ]; then
      echo "config written; Keychain skipped (BB_KEYCHAIN=none)"
    elif command -v security >/dev/null 2>&1; then
      # `security add-generic-password -w <token>` would put the token on argv (visible in
      # ps). `security -i` reads its commands from stdin, so the token never is on argv.
      # A changed email: drop the old account's item (no secret in that command).
      if [ -n "$old" ] && [ "$old" != "$email" ]; then
        security delete-generic-password -s "$svc" -a "$old" >/dev/null 2>&1 || true
      fi
      printf 'add-generic-password -U -s "%s" -a "%s" -w "%s"\n' "$svc" "$email" "$tok" | security -i >/dev/null \
        || { echo "Keychain refused the token" >&2; exit 1; }
      echo "config written; token stored in the Keychain (service $svc)"
    else
      echo "config written; no Keychain here: set BITBUCKET_PRS_TOKEN in the environment Herdr runs in"
    fi
    ;;
  status)
    if [ ! -f "$cfg" ]; then echo "config: none ($cfg)"; exit 0; fi
    ws=$(get workspace); email=$(get email); proj=$(get project)
    echo "config: $cfg"
    echo "workspace: ${ws:-missing}"
    echo "email: ${email:-missing}"
    echo "project: ${proj:-none (whole workspace)}"
    if grep -q '^repos=' "$cfg"; then echo "repos: $(get repos | tr ',' '\n' | grep -c .) chosen"; else echo "repos: all"; fi
    if [ "${BB_KEYCHAIN:-}" = none ]; then echo "keychain: skipped (BB_KEYCHAIN=none)"
    elif [ -n "$email" ] && has_token_in_keychain "$email"; then echo "token: in the Keychain"
    else echo "token: not in the Keychain"; fi
    [ -z "${BITBUCKET_PRS_TOKEN:-}" ] || echo "env: BITBUCKET_PRS_TOKEN is set"
    ;;
  *) sed -n '2,9s/^# \{0,1\}//p' "$0"; exit 2 ;;
esac
