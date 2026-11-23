# One-off runs: a simple task, tracked but not orchestrated

Read this only for a `oneoff` run ([start.md](start.md#one-off-runs)). There is no plan, no brief, no sub-agent, no merge and no integration branch: you make the change yourself and the run is tracked in Harbormaster.

## 1. Set up

1. Branch: `oneoff-<slug>`, a short slug of the description. Run `init-run.sh <branch>` as usual; the prefix is `one-<slug>`.
2. Publish the facts: `set-status.sh <run-directory> --type <feat|fix|expl> --topic "<1-3 words>" --oneoff <checkout|worktree>`.
3. `plan.md` (below the Status line) holds `Prefix`, `Proof: T1`, the `where` and, for a checkout, `Original branch: <name>`, and one `## Claims` line per thing the user asked for. No tasks. `spec.md` is the description, short.
4. Ask one question only if something is ambiguous, together with "Review before finishing? (default no)": write it to `question.md` and set `waiting for user: …` ([run-files.md](run-files.md#questionmd)). If the description is clear and nothing is ambiguous, ask nothing: review is `no`.
5. Where the work happens:
   - `where=checkout` (default): the one exception to the rule that the checkout belongs to the user. If `git status --porcelain` shows changes, ask first (`question.md`) and wait. Record the current branch in `plan.md`, then `git switch -c <branch>` from it and work there.
   - `where=worktree`: `git fetch origin`, then `git worktree add ~/.herdr/worktrees/<repo>/<branch> -b <branch> origin/<default-branch>`. Install its dependencies (not symlinks). No space is opened: it stays hidden, and is kept until Close.

## 2. Do the work

Make the change, commit it on the branch, and run the tests for what you changed. Save the test output as the run's proof ([run-files.md](run-files.md), `proof.md`, tier T1). Keep `--progress` current. If the user asked for a review, start one reviewer as in SKILL.md section 4 against the branch, and fix real findings once.

## 3. Finish

1. Push the branch: `git push -u origin <branch>`.
2. PR, unless the argument was `pr=no`. The remote is GitHub when `git remote get-url origin` contains `github.com`, or `gh repo view` works.
   - GitHub: `gh pr create` with a body as [finish.md](finish.md) step 2, shortened (what changed, how it was checked). Then `set-status.sh <run-directory> --pr <owner/repo> <url>`.
   - Not GitHub (Bitbucket and others), or `pr=no`: open no PR. Run `set-status.sh <run-directory> --pushed <branch>`.
3. `where=checkout`: switch back to the original branch with `git switch <original>`, only if the checkout is clean. If it is not (the user changed files meanwhile), stay and say so.
4. Set the status `finished`. The finished message says what was done and, with no PR, "branch pushed, open the PR yourself" with the branch name.

Questions, the inbox, autonomy and recovery work as in other runs.
