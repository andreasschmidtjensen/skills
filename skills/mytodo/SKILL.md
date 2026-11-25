---
name: mytodo
description: Keep the project's to-do list with the `mytodo` command, the same list the user sees in Herdr's To-do panel. Use it to add what the user asks for, tick it when done and checked, and note follow-up work left undone, pending decisions and anything the user must do next.
compatibility: Requires sh and git; python3 for item numbering and TODO.md sync. The My To-do panel is optional (herdr-app/install-todo.sh).
---

One list per project (the git repo's main checkout, so worktrees share it), stored in `~/.local/share/my-todos/todos/`. People and agents edit the same files; the panel shows them live.

## The command

`mytodo` is `scripts/todo.sh` in this skill. If it is not on PATH, link it (the script finds its helpers through the link): `ln -s <skill-dir>/scripts/todo.sh ~/.local/bin/mytodo`.

- `mytodo` lists this project's items, numbered (`1`, `1.2`, `1.2.1`); `mytodo all` lists every project's.
- `mytodo add [--under <n>] <text>` adds; `mytodo done <n>` ticks (its open sub-to-dos too); `mytodo undo <n>` unticks; `mytodo edit <n> <new text>` rewords; `mytodo rm <n>` deletes with its sub-to-dos.
- `-p <folder>` first picks another project than the repo you are in.
- `mytodo log [on|off]` says or sets whether agents add what the user asks for; `mytodo help` shows the rest.

## When to add

- While `mytodo log` says `on`: each thing the user asks for in the project (a change, a fix, a feature), as soon as you read it, even mid-task. Tick it once it is done and checked; leave it open if only partly done, and say so.
- Always: when the user asks you to note something for later, and when you leave follow-up work undone (a deferred review finding, a failing check you did not fix, a question the user has not answered, a step only they can do such as pushing a branch).
- When a request changes, narrows or is dropped, correct its item (`edit`, `rm`) instead of adding another.

## How

- Items are one short line each. Never put customer data, credentials or message content in one.
- Run `mytodo` first and look for a main item the new one belongs to (for example "HAProxy"); if there is one, `mytodo add --under <n> <text>` (3 levels at most). Otherwise a plain `mytodo add`.
- There is no move command: `mytodo rm` the item and re-add it with `--under` (`mytodo done` it again if it was ticked).
