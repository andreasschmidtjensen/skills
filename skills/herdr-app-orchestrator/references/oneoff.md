# One-off runs: a simple task, tracked but not orchestrated

Read this only for a `oneoff` run ([start.md](start.md#one-off-runs)). There is no plan, no brief, no sub-agent, no merge and no integration branch: you make the change yourself and the run is tracked in Harbormaster.

## 1. Set up

1. Branch: `oneoff-<slug>`, a short slug of the description. Run `init-run.sh <branch>` as usual; the prefix is `one-<slug>`.
2. Publish the facts: `set-status.sh <run-directory> --type <feat|fix|expl> --topic "<1-3 words>" --oneoff <checkout|worktree>`.
3. `plan.md` (below the Status line) holds `Prefix`, `Proof: T1`, the `where` and, for a checkout, `Original branch: <name>`, and one `## Claims` line per thing the user asked for. No tasks. `spec.md` is the description, short.
4. For `where=checkout`, run `git status --porcelain` first. Then ask one question only, in one `question.md`, if something is ambiguous or the checkout has changes, together with "Review before finishing? (default no)": write it and set `waiting for user: …` ([run-files.md](run-files.md#questionmd)). A dirty checkout adds the options "go on (work on top of the changes) / I'll clean up first / use a worktree". If the description is clear and the checkout is clean (or `where=worktree`), ask nothing: review is `no`.
5. Where the work happens:
   - `where=checkout` (default): the one exception to the rule that the checkout belongs to the user. If `git status --porcelain` showed changes, the answer to the question in step 4 decides (go on, wait for the user to clean up, or switch to a worktree). On go on, list the changed files in `plan.md` as `User changes: <paths>`. On a worktree, rerun `set-status.sh <run-directory> --oneoff worktree`, set `where` to `worktree` in `plan.md` and follow the worktree line below instead. Record the current branch in `plan.md`, then `git switch -c <branch>` from it and work there.
   - `where=worktree`: `git fetch origin`, then `git worktree add ~/.herdr/worktrees/<repo>/<branch> -b <branch> origin/<default-branch>`. Install its dependencies (not symlinks). No space is opened: it stays hidden, and is kept until Close.

## 2. Do the work

Make the change and commit it on the branch, staging only your own files by path (never `git add -A` or `git commit -a`: in a checkout, the user's changes stay uncommitted), and run the tests for what you changed. Save the test output as the run's proof ([run-files.md](run-files.md), `proof.md`, tier T1). Keep `--progress` current. If the user asked for a review, start one reviewer as in SKILL.md section 4 against the branch, and fix real findings once.

## 3. Finish

1. Never push, and open no PR, unless the user explicitly asked for it in their own words (a `pr=yes` argument or a message). Skipping this step is the default: the branch stays local, and the user pushes it.
2. Only when the user asked for a push or PR: push the branch with `git push -u origin <branch>`. The remote is GitHub when `git remote get-url origin` contains `github.com`, or `gh repo view` works.
   - GitHub, PR asked for: `gh pr create` with a body as [finish.md](finish.md) step 2, shortened (what changed, how it was checked). Then `set-status.sh <run-directory> --pr <owner/repo> <url>`.
   - Otherwise (not GitHub, or no PR asked for): open no PR; after a push run `set-status.sh <run-directory> --pushed <branch>`.
3. `where=checkout`: switch back to the original branch with `git switch <original>`, only if the checkout is clean apart from the `User changes:` in `plan.md` (`git switch` carries them along). If anything else changed (the user edited files meanwhile), or the switch fails, stay on the branch.
4. Set the status `finished`. The finished message says what was done and, with no push, "branch is local, not pushed" with the branch name (with a push and no PR, "branch pushed, open the PR yourself"). If you stayed on the one-off branch, it also says "still on <branch>; switch back with `git switch <original>`".

Questions, the inbox, autonomy and recovery work as in other runs.
