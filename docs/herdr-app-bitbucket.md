# Bitbucket PRs

A panel in the Herdr app that lists your open Bitbucket Cloud pull requests, docked
on the right below My To-do. Read-only: a click opens the PR in the browser.

## What you see

The panel shares the right column with the My To-do block, half the height each; the
column keeps the to-do block's 368px width.

- **Tabs**: **Mine** (open PRs you wrote) and **Project** (all open PRs in the
  project's repositories, newest first, as on Bitbucket's project page), each with its count.
  Without a project key, Project covers the whole workspace.
- **Rows**: title, then "author · #id · repository · age" and "source → destination
  branch", plus build state, approvals and comment count. Drafts carry a **Draft** tag;
  PRs where you are a reviewer and have not approved carry a **review** marker.
  Clicking a row opens the PR in the browser.
- **Refresh button**, for a poll on demand.
- **Setup message** instead of the list while the workspace, email or token is missing
  or rejected. It says what to do and never shows a secret.
- **Backoff notice** when Bitbucket answers 429 (too many requests); polling pauses
  until it passes.

## How it behaves

- Polls every 60 seconds while the window is visible, and on the refresh button.
  No toasts.
- **Mine** refreshes every 60 s. **Project** refreshes every 5 min (60 s with a project of ≤5 repos).
- The **review** marker goes away once you approve the PR.
- Open PRs only, one workspace. With a **project key** in the config, both tabs only
  cover that Bitbucket project's repositories, which also lowers the request cost.
  Without one, the whole workspace.
- Stays far below Bitbucket's 1000 requests an hour: responses are cached, and a PR's
  build state is fetched again only when its `updated_on` changed.
- **Setup**: `sh ~/.config/herdr-app/mods/bitbucket-prs/setup.sh token` asks for the
  workspace slug, your Atlassian email, an optional project key and an API token
  (typed silently).
  - Each prompt shows the previous value in [brackets]; Enter keeps it. For the project
    key, `-` clears it (whole workspace). The token is never remembered or shown.
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
- **Token scopes:** create the API token with exactly these scopes: `read:pullrequest:bitbucket`, `read:repository:bitbucket` and `read:user:bitbucket` (both tabs need the user scope). Atlassian tokens cannot be edited, so a token with missing scopes means a new token and `setup.sh token` again. A token that is too narrow shows as a rejected-token message in the panel.
- **Limits:** the Project tab shows at most 50 open PRs per repository (one page per repo). Build state on Project rows is looked up for the PRs you are asked to review plus up to 10 others per scan, so other rows may show no build dot for a few minutes.
- **Project:** Bitbucket Cloud has no single call for all open PRs of a project, so the
  panel scans the repositories one by one; that tab may lag Mine slightly.
- The workspace name, email and token are configuration on your computer; none of them
  is committed anywhere.
- The installer rewrites the layout JSON through `jq`, so its whitespace may change
  (the backup keeps the original).

## Done when

- `install-bitbucket.sh` docks the panel below My To-do, and running it again changes nothing.
- With a project key set, both tabs show only that project's repositories.
- With the workspace and token set up, Mine lists your open PRs with the fields above.
- Project lists all open PRs (drafts included) with author and branches, and marks those you are asked to review.
- A click on a row opens the PR in the browser.
- Without a config or token, the panel shows the setup message; no secret appears.
- A 429 shows the backoff notice and pauses polling.
- `install-bitbucket.sh --uninstall` leaves the To-do block as it was.
