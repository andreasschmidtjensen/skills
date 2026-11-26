# Bitbucket PRs

A panel in the Herdr app that lists your open Bitbucket Cloud pull requests, docked
on the right below My To-do. Read-only: a click opens the PR in the browser.

## What you see

The panel shares the right column with the My To-do block, half the height each; the
column keeps the to-do block's 368px width.

- **Tabs**: **Mine** (open PRs you wrote) and **To review** (open PRs where you are a
  reviewer), each with its count.
- **Rows**: title, repository, source branch, build state, approvals, comment count
  and age. Clicking a row opens the PR in the browser.
- **Refresh button**, for a poll on demand.
- **Setup message** instead of the list while the workspace, email or token is missing
  or rejected. It says what to do and never shows a secret.
- **Backoff notice** when Bitbucket answers 429 (too many requests); polling pauses
  until it passes.

## How it behaves

- Polls every 60 seconds while the window is visible, and on the refresh button.
  No toasts.
- **Mine** refreshes every 60 s. **To review** refreshes every 5 min (60 s with a project of ≤5 repos).
- PRs you already approved drop off **To review**.
- Open PRs only, one workspace. With a **project key** in the config, both tabs only
  cover that Bitbucket project's repositories, which also lowers the request cost.
  Without one, the whole workspace.
- Stays far below Bitbucket's 1000 requests an hour: responses are cached, and a PR's
  build state is fetched again only when its `updated_on` changed.
- **Setup**: `sh ~/.config/herdr-app/mods/bitbucket-prs/setup.sh token` asks for the
  workspace slug, your Atlassian email, an optional project key (empty = whole
  workspace) and an API token (typed silently).
  - The workspace and email go in `~/.config/bitbucket-prs/config` (or under
    `$XDG_CONFIG_HOME`), mode 600, as `workspace=`, `email=` and, if given, `project=`. The token is not in it.
  - The token goes in the macOS Keychain (service `bitbucket-prs`, account = your
    email). It is passed to `security -i` on stdin, so it never is on a command line.
  - Without a Keychain, set `BITBUCKET_PRS_TOKEN` in the environment Herdr runs in.
  - `setup.sh status` shows what is configured, without the token.
- **Install**: `herdr-app/install-bitbucket.sh` copies the mod and docks it.
  - It finds the layout with a `my-todos` block and wraps that block in a column
    (`bitbucket-prs-column`): to-do on top, this panel below, weight 1 each.
  - Several layouts have one: it lists them and exits 2; pick with `--layout <name>`.
  - Run again: nothing changes. Each change first saves `<layout>.json.bak-<time>`
    next to the layout; the layout is replaced atomically.
  - `--uninstall` puts the to-do block back on its own at its old width and removes the
    mod folder. The Harbormaster mod and `install.sh` are not touched.
  - It refuses a `mods/bitbucket-prs` folder that isn't ours (ours has the marker file
    `.installed-by-install-bitbucket`, or a `main.js` that mentions `bitbucket-prs`).

## Built from

- **`herdr-app/mods/bitbucket-prs/`**, with `mod.json` set to `{"place": "right", "size": 368}`:
  - `main.js`: the panel.
  - `bb.js`, `bb-fetch.sh`: the Bitbucket requests and their cache.
  - `rows.js`: the row layout.
  - `setup.sh`: the token setup.
  - the icons (`.svg`).
- **`herdr-app/install-bitbucket.sh`**: the installer and dock.
- **Bitbucket Cloud REST API 2.0**, with HTTP basic auth (email and API token).
- **Programs:** `sh`, `curl`; `jq` for the installer; `security` for the Keychain (macOS).
- **Tests:**
  - `node --test tests/herdr-app-bitbucket/bb.test.mjs tests/herdr-app-bitbucket/panel.test.mjs`
  - `sh tests/herdr-app-bitbucket/bb-fetch.test.sh`
  - `sh tests/herdr-app-bitbucket/install.sh` (a throwaway app home, fixture layouts).

## Watch out

- **Rate limit:** 1000 requests an hour for the token. The panel's volume is kept well
  under it; a 429 shows a notice and pauses polling. The panel caps itself at 500
  requests an hour per Herdr window running it; one window is assumed.
- **Token scopes:** create the API token with read access to pull requests and
  repositories (and to your account: both tabs need it). A token that is too
  narrow shows as a rejected-token message in the panel.
- **To review:** Bitbucket Cloud has no single call for "PRs where I am a reviewer"
  across a workspace, so that tab is found another way and may lag Mine slightly.
- The workspace name, email and token are configuration on your computer; none of them
  is committed anywhere.
- The installer rewrites the layout JSON through `jq`, so its whitespace may change
  (the backup keeps the original).

## Done when

- `install-bitbucket.sh` docks the panel below My To-do, and running it again changes nothing.
- With a project key set, both tabs show only that project's repositories.
- With the workspace and token set up, Mine lists your open PRs with the fields above.
- To review lists the open PRs you are asked to review.
- A click on a row opens the PR in the browser.
- Without a config or token, the panel shows the setup message; no secret appears.
- A 429 shows the backoff notice and pauses polling.
- `install-bitbucket.sh --uninstall` leaves the To-do block as it was.
