# Waiting: jump to the plain terminals that wait on you

Waiting is a Herdr app mod. It lists every plain terminal (not an agent, not a hidden worker) in a sidebar block above Spaces, marks the ones that wait on you, across spaces, and jumps to one fast. Herdr's own Agents list covers agents.

## What counts as waiting

- **Finished.** A command ran for 10 seconds or more and the shell is back in front. It stays until you focus the terminal.
- **Exited.** Only for a terminal Herdr still lists after its process exited (one kept by `hc run --keep` or started outside a pane). Herdr closes the pane and tab of a terminal whose program exits, so an ordinary exited shell leaves nothing to jump to and is not listed.
- **Needs input.** A program that is not a shell has had the same screen for 5 seconds, uses about no CPU (under 1%), and its last non-empty line looks like a prompt: it ends in `?`, `:` or `>`, ends in `[y/N]` or `(yes/no)`, or contains `password`, `passphrase` or `continue`. This is a heuristic: it can miss a prompt and it can flag a line that only looks like one.
- **Quiet.** A program that is not a shell has had the same screen for 60 seconds or more and no prompt-looking last line. It is listed greyed under **Quiet** and is not counted.
- **REPL and pager guard.** The screen a program shows when Waiting first sees it, and the screen you leave behind when you focus it, never count as needs-input or quiet. A REPL or pager you left open stays out of the list until its screen changes.
- **Focusing clears.** Focusing a terminal clears its mark. The terminal you are in is never listed.

## Keys

`install.sh` binds these under `global` in `keys.json`, each only if the key is free in every section and the action is not already bound:

- `cmd-shift-j` opens the picker (`mod.open:waiting`), as a popup. Terminals are grouped by space, the current space first, oldest first within a space, Quiet last. Enter focuses the selected one; Esc closes it.
- `cmd-j` focuses the next waiting terminal (`waiting.next`), the first in that same order.

If a key is taken, install prints the line to add.

## Terminals list

A block above Herdr's Spaces list in `harbormaster-main`. Its header reads `Terminals · n waiting` (dim at 0; `n` counts finished, exited and needs-input terminals, not Quiet) and a click on it opens the picker. Below it is every live plain terminal, grouped by space (the current space first, then the order of the Spaces list; scrolls). A row shows a mark, the foreground program (or shell), the tab name and the last folder of its working directory:
- `!` (red) needs input, `✓` finished, `✕` exited, a dim `·` quiet; no mark for a running or idle terminal.
- The terminal you are in is highlighted. A click on a row focuses it, which clears its mark.

It is `{ "mod": "waiting", "props": { "role": "list" } }` with weight 0.5; to use it in a layout of your own, add such a block. The older one-row badge (`"role": "badge"`, `Waiting · n`, 28 px) still works in a layout that has it.

## Install

`herdr-app/install.sh` (see [docs/herdr-app-harbormaster.md](herdr-app-harbormaster.md#install)) also:
- copies `herdr-app/mods/waiting` into the app's home. It refuses to replace a `mods/waiting` whose `mod.json` title is not `Waiting`.
- adds the list block just above Spaces, in the column of `harbormaster-main` that holds the Crew block, only on the run that first installs `mods/waiting`. Re-running install does not bring back a block you removed. A layout that already has a Waiting block is left alone, except that a badge block of an earlier install becomes the list block and moves above Spaces (on any run).
- adds the two keys as above.

## Known limits

- `waiting.next` and the counting need the list (or badge) block shown: that copy is what polls and what receives `cmd-j`. With a collapsed sidebar, or a layout without the block, `cmd-j` does nothing. `cmd-shift-j` still works: the picker copy polls too (the shared lock lets one copy poll at a time), so its list is current without the block.
- Cost: one `ps` per machine per poll (2 s) for the foreground pids of non-shell terminals. A terminal's screen is read (`hc read`) only while its CPU is under 1 %; once its screen has been unchanged for 5 s and classified, it is read every 10 s instead of every 2 s.
- Needs input is a guess from the screen, the CPU and the last line. Remote terminals are read through the terminal's own machine (its CPU, via `hc`), so they follow what that machine answers.
- Marks live in the mod's memory. Reloading the mod resets them.

## Files

`herdr-app/mods/waiting/`: `rules.js` (pure rules, no Herdr imports), `view.js` (pure view helpers), `main.js` (list, badge, picker, polling, focus), `mod.json`. Tests: `tests/herdr-app-waiting/`.

## Remove

Delete `mods/waiting` from the app's home, the `waiting` block from `harbormaster-main`, and the `cmd-shift-j` and `cmd-j` entries from `keys.json`.
