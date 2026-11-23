// Pure helpers for the waiting mod's views and commands. No "herdr"/"gpui-kit" imports, no Date.now().

export const POLL_MS = 2000;
export const LOCK_MS = 6000; // a poller's claim on the shared lock lapses after this

export const ageText = (ms) => {
  const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

const KINDS = {
  finished: { icon: "✓", word: "finished", tone: "done" },
  exited: { icon: "✕", word: "exited", tone: "blocked" },
  "needs-input": { icon: "!", word: "needs input", tone: "blocked" },
  quiet: { icon: "·", word: "quiet", tone: "dim" },
};

// One picker row from a waitingList entry: icon, word (exit code for exited), what it ran, where, how old.
export const rowParts = (e, now) => {
  const k = KINDS[e.kind] ?? KINDS.quiet;
  const word = e.kind === "exited" && e.exit_code != null ? `exited ${e.exit_code}` : k.word;
  const tab = e.tabName ?? e.tab;
  const where = tab && !/^\d+$/.test(tab) ? tab : e.cwd || e.title || "";
  return { icon: k.icon, word, tone: k.tone, dim: e.kind === "quiet", name: e.command || e.title || e.address, where, age: ageText(now - e.since) };
};

// Entries grouped by space, in list order (waitingList already keeps a space's entries together).
export const groupBySpace = (list) => {
  const out = [];
  for (const e of list ?? []) {
    const last = out[out.length - 1];
    if (last && last.space === e.space) last.rows.push(e);
    else out.push({ space: e.space, name: e.spaceName ?? e.space, rows: [e] });
  }
  return out;
};

// The terminal "next" jumps to: the first counted (not quiet) entry after the focused one, wrapping.
// waitingList leaves the focused terminal out, so normally that is simply the first counted entry.
export const pickNext = (list, focused) => {
  const counted = (list ?? []).filter((e) => e.kind !== "quiet");
  if (!counted.length) return null;
  const i = counted.findIndex((e) => e.address === focused);
  return i < 0 ? counted[0] : counted.length > 1 ? counted[(i + 1) % counted.length] : null;
};

// Arrow-key move over the picker's rows; quiet rows stay selectable (Enter still goes there).
export const moveAt = (at, n, dir) => (n ? (at + dir + n) % n : 0);

// The shared lock: one copy of the mod polls. A claim holds while fresh; the holder renews it.
export const lockHeld = (lock, me, now) => !!lock && lock.id !== me && now - lock.at < LOCK_MS;

// Where a terminal is: the space and tab to show first, then the pane to focus.
// panes: panes() rows; spaces: spaces() rows. Returns null when it has no pane (parked): the caller keeps it.
export const whereIs = (address, panes, spaces) => {
  const p = (panes ?? []).find((x) => x.terminal === address);
  if (!p) return null;
  const space = (spaces ?? []).find((s) => s.tabs?.some((t) => t.id === p.tab));
  return { pane: p.pane, tab: p.tab, space: space?.id ?? null };
};

// The list block's header: "Terminals · n waiting", dim when n is 0.
export const listHeader = (n) => ({ text: `Terminals · ${n} waiting`, dim: !n });

// One list row from an allRows entry: the mark (none for running/idle), program, tab, cwd tail.
const MARKS = { "needs-input": { mark: "!", tone: "blocked" }, finished: { mark: "✓", tone: "done" }, exited: { mark: "✕", tone: "blocked" }, quiet: { mark: "·", tone: "dim" } };
export const listRow = (e) => {
  const k = MARKS[e.kind];
  return { mark: k?.mark ?? "", tone: k?.tone ?? null, dim: e.kind === "quiet", program: e.program || e.address, tab: e.tabName || "", cwd: e.cwd || "" };
};
