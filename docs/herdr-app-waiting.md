# Waiting: jump to the plain terminals that wait on you

Waiting is a Herdr app mod. It lists every plain terminal (not an agent, not a hidden worker) that waits on you, across spaces, and jumps to one fast. Herdr's own Agents list covers agents.

## What counts as waiting

- **Finished.** A command ran for 10 seconds or more and the shell is back in front. It stays until you focus the terminal.
- **Exited.** The terminal's process exited. It stays until you focus the terminal.
- **Needs input.** A program that is not a shell has had the same screen for 5 seconds, uses about no CPU (under 1%), and its last non-empty line looks like a prompt: it ends in `?`, `:` or `>`, ends in `[y/N]` or `(yes/no)`, or contains `password`, `passphrase` or `continue`. This is a heuristic: it can miss a prompt and it can flag a line that only looks like one.
- **Quiet.** A program that is not a shell has had the same screen for 60 seconds or more and no prompt-looking last line. It is listed greyed under **Quiet** and is not counted.
- **REPL and pager guard.** The screen a program shows when Waiting first sees it, and the screen you leave behind when you focus it, never count as needs-input or quiet. A REPL or pager you left open stays out of the list until its screen changes.
- **Focusing clears.** Focusing a terminal clears its mark. The terminal you are in is never listed.

## Keys

`install.sh` binds these under `global` in `keys.json`, each only if the key is free in every section and the action is not already bound:

- `cmd-shift-j` opens the picker (`mod.open:waiting`), as a popup. Terminals are grouped by space, the current space first, oldest first within a space, Quiet last. Enter focuses the selected one; Esc closes it.
- `cmd-j` focuses the next waiting terminal (`waiting.next`), the first in that same order.

If a key is taken, install prints the line to add.

## Badge

A one-row block `Waiting · n` sits under Herdr's Spaces list in `harbormaster-main`. `n` counts finished, exited and needs-input terminals, not Quiet. Click it to open the picker. It is `{ "mod": "waiting", "props": { "role": "badge" } }`, 28 px high; to use it in a layout of your own, add such a block.

## Install

`herdr-app/install.sh` (see [docs/herdr-app-harbormaster.md](herdr-app-harbormaster.md#install)) also:
- copies `herdr-app/mods/waiting` into the app's home. It refuses to replace a `mods/waiting` whose `mod.json` title is not `Waiting`.
- adds the badge block to the column of `harbormaster-main` that holds the Crew block, once. A layout that already has a Waiting block is left alone.
- adds the two keys as above.

## Known limits

- `waiting.next` and the counting need the badge shown: the badge copy is what polls and what receives `cmd-j`. With a collapsed sidebar, or a layout without the badge block, `cmd-j` does nothing. `cmd-shift-j` still works.
- Needs input is a guess from the screen, the CPU and the last line. Remote terminals are read through the terminal's own machine (its CPU, via `hc`), so they follow what that machine answers.
- Marks live in the mod's memory. Reloading the mod resets them.

## Files

`herdr-app/mods/waiting/`: `rules.js` (pure rules, no Herdr imports), `view.js` (pure view helpers), `main.js` (badge, picker, polling, focus), `mod.json`. Tests: `tests/herdr-app-waiting/`.

## Remove

Delete `mods/waiting` from the app's home, the `waiting` block from `harbormaster-main`, and the `cmd-shift-j` and `cmd-j` entries from `keys.json`.
