# My To-do

Agentic to-do lists, one per project, that your agents keep for you. Ask for
something and it's on the list; when the agent finishes, it's ticked. Each list
stays in sync with the project's own TODO.md, and any to-do goes to the current
conversation or a new agent in one click, alone or several at once.

![My To-do](herdr-app-todo.png)

## What you see

The panel docks on the right, 368px wide, on `background` with a 1px `border` and
a 10px radius. Colours are theme names.

- **Header**, 42px, with a 1px `border` below:
  - "To-do" in semibold, then an outlined "N open" badge (10px, `muted`).
  - **Log** and **Sync** tags for the project you're in. Each is 10.5px with a
    10px icon (`log.svg`, `sync.svg`): on `raised` with `accent` text when on,
    plain `dim` when off.
- **Tabs**, 20px, 11.5px, the picked one on `raised`: the project you're in
  (its name in its colour, with its open count), then **All**.
- **Add box**, 30px high with an 8px radius on `raised`, reading "Add a to-do
  (#project @when)". Typing `#` or `@` lists matches under it.
- **"Let agents keep these lists · Set up"**, a hint on an accent tint. It shows
  only while the to-do rule isn't in `~/.claude/CLAUDE.md`.
- **Rows**, 30px each:
  - A 14px circle in the project's colour, filled with a tick when done.
  - The text on one line, 13px, struck through and `dim` when done.
  - On the right, in 11px: the due time (`ansi1` when overdue) or the done
    time, and in All the project's name in its colour, flush right.
  - On hover: the row keeps its height and shows a bot button and a ×; the
    full text is in a tooltip. Clicking the text shows it whole (click again to
    fold it); double-click edits.
- **Done**: a foldable section (chevron, "Done", count, and Clear on the right),
  then the latest five done to-dos and "Show 10 more".
- **Sub-to-dos**: a row's + adds a child under it (3 levels at most). A parent
  has a fold chevron and a done/total count.
- **From TODO.md**: lines in the project's TODO.md that aren't on the list, each
  with a + to add it and a × that deletes it from the file.

## How it behaves

- Lists live in `~/.local/share/my-todos/todos/<slug>.md`, one per project, where
  the slug is the folder with non-alphanumerics turned into `-`. The panel
  watches that folder, so the `mytodo` command's changes show at once.
- **Ticking:**
  - Click a circle to tick or untick. Ticking a parent ticks every open
    to-do below it; unticking a parent leaves its children as they are.
  - × on a parent (click twice) removes it with its sub-to-dos.
  - Double-click the text to edit it, with `@when` kept.
- **The bot button** opens a card under the row. Under **Current
  conversation**, it lists up to four agents running in that project, by name,
  with their status dot. Under **New conversation**, "Start a new one" starts
  the agent shown in the picker in that project's space, with a brief telling
  it to tick the to-do when done.
- **Picking several** (the project tab only): Ctrl or Cmd-click picks one,
  Shift-click a range. A bar shows "N selected" and Cancel, above Mark done,
  Send to agent and Delete (click twice).
- **Log and Sync** are saved per project, in the list file as
  `<!-- log|sync: on|off -->`.
  - **Log:** agents add what you ask for.
  - **Sync:** add, edit, rm and tick change the project's TODO.md too.
  - A project that hasn't set either follows the defaults in
    `~/.local/share/my-todos/todo-defaults`.
- **Set up** runs `setup.sh todo on`. That writes the rule into CLAUDE.md and
  AGENTS.md, puts a `mytodo` wrapper in `~/.local/bin`, and adds a
  UserPromptSubmit hook that reminds agents while Log is on.
- **The All tab** covers every list file in the data dir
  (`~/.local/share/my-todos/todos`, or `$XDG_DATA_HOME/my-todos/todos`) plus the
  project you're in.
- **`mytodo`** is the command-line side of the same files: `mytodo add --under <n>`
  adds a sub-to-do, `done` ticks a parent's open children too, `rm` removes a
  subtree, `clear` removes fully done subtrees.
- **Data dir:** `my-todos/` under `$XDG_DATA_HOME` (default `~/.local/share`).
  Sub-to-dos are lines indented two spaces per level. Flat lists stay as they are.

## Built from

- **`herdr-app/mods/my-todos/`**, with `mod.json` set to `{"place": "right", "size": 368}`:
  - `main.js`, `tree.js`: the panel.
  - `agent-name.js`: the agent names the sidebar uses.
  - `todo-hook.sh`: the hook.
  - `setup.sh`: the agents' setup.
  - `bot.svg`, `log.svg`, `sync.svg`.
- **`skills/mytodo/`**, the `mytodo` command and the skill that teaches agents to use it:
  - `scripts/todo.sh`: the command.
  - `scripts/todo-items.py`: the item logic.
  - `scripts/todo-cross.py`: the TODO.md edits.
- **`herdr-app/install-todo.sh`** copies both into the app's `mods/my-todos/` (the panel, hook and `setup.sh` find the scripts next to them there).
- **herdr:**
  - Reading: `focused`, `spaces`, `panes`, `agents`, `knownAgents`.
  - Files: `watchFolder`, `readTextFile`, `writeTextFile`.
  - `exec` runs `sh` and Python, and `git` to find the project's main checkout.
  - `hc send` types a to-do into a running agent.
  - `run` with `tab.new` and `space.new` starts a new one.
  - Also `notify` and `shared` / `setShared`.
- **Programs:** `sh` and `git`; Python 3 for TODO.md edits; `jq` for the hook.

## Watch out

- Python is found as `python3`, else `python` (Windows).
- On Windows, the scripts need Git for Windows' `sh`.
- The project is the git repo's main checkout, so worktrees share one list.
- Agents learn the `mytodo` command from the rule. `~/.local/bin` must be on PATH.
- TODO.md suggestions are re-read after the list changes, so an agent's edit
  doesn't flash up as a suggestion.

## Done when

- The panel docks on the right and shows the project you're in.
- `mytodo add "x"` in that project shows "x" within a second.
- Ticking "x" in the panel shows it done in `mytodo`.
- The bot button on "x" lists a running agent there. Clicking it types the
  to-do into that agent.
- With Sync on, adding a to-do adds it to the project's TODO.md.
- With the rule missing, the hint shows. "Set up" makes `mytodo` work in a new
  agent's shell and hides the hint.
