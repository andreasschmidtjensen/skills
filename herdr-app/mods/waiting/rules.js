// Pure rules for the waiting mod: which plain terminals wait for the user. No "herdr"/"gpui-kit" imports,
// no Date.now(): time and samples are passed in. Per-terminal memory lives in a map address -> memory.
export const MIN_RUN_MS = 10000;
export const QUIET_MS = 5000;
export const QUIET_LIST_MS = 60000;
export const CPU_QUIET = 1;
export const SAMPLE_EVERY_MS = 2000; // re-read a non-shell terminal's screen at most this often
export const SETTLED_EVERY_MS = 10000; // ... and this often once its screen is unchanged and already classified
export const STALE_MS = 14000; // needs-input/quiet only count from a sample this fresh (> SETTLED_EVERY_MS + a poll)

const SHELLS = /^-?(zsh|bash|sh|fish|dash|ksh|nu|tcsh|csh)$/;

export const lastLine = (text) => {
  const lines = String(text ?? "").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i].trim();
  return "";
};

export const screenSig = (text) => {
  const s = String(text ?? "");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${s.length}:${h}`;
};

export const looksLikePrompt = (line) => {
  const l = String(line ?? "").trim();
  if (!l) return false;
  if (/[?:>]$/.test(l)) return true;
  if (/\[[yn]\/[yn]\]$/i.test(l) || /\((yes\/no|y\/n)\)$/i.test(l)) return true;
  return /password|passphrase|continue/i.test(l);
};

// Agents (status or program.agent) and hidden workers (no space label) are not plain terminals.
export const isPlain = (term) =>
  !!term && !(term.status != null) && !term.program?.agent && !!term.labels?.["herdr.space"];

export const isShell = (term) => {
  if (term.program && typeof term.program.shell === "boolean") return term.program.shell;
  const name = term.foreground?.name;
  return !name || SHELLS.test(name);
};

const machineOf = (address) => (String(address).includes("/") ? String(address).split("/")[0] : null);

// Labels hold ids local to the terminal's machine; the ids the app shows for a remote machine carry "<machine>/".
const qualify = (term, id) => (id ? (machineOf(term.address) ? `${machineOf(term.address)}/${id}` : id) : "");
const spaceOf = (term) => qualify(term, term.labels?.["herdr.space"]);
const tabOf = (term) => qualify(term, term.labels?.["herdr.tab"]);

// ps output "pid cpu" per line -> Map pid -> cpu %. Lines that don't parse are skipped.
export const parsePs = (text) => {
  const out = new Map();
  for (const line of String(text ?? "").split("\n")) {
    const m = line.trim().match(/^(\d+)\s+([\d.]+)$/);
    if (m) out.set(Number(m[1]), parseFloat(m[2]));
  }
  return out;
};

// New per-terminal memory. sample = { sig, cpu, line } (screen signature, cpu %, last non-empty line) or null.
// Contract: the mod supplies cpu with every sample (read with ps); terminals() has none. Without cpu, needs-input never fires.
export const track = (prev, term, now, sample = null) => {
  if (!isPlain(term)) return { ignored: true };
  const fresh = !prev || prev.ignored; // first time this terminal is tracked
  const m = { ...(prev && !prev.ignored ? prev : {}) };
  delete m.ignored;
  if (term.state === "finished") {
    m.fg = null; m.needs = null; m.sig = null; m.sampleAt = null; m.quietSig = null;
    const since = term.finished_ms ?? m.exitSince ?? now;
    m.exitSince = since;
    const seen = m.seenAt != null && m.seenAt >= since;
    m.mark = seen ? null : (m.mark?.kind === "exited" ? m.mark : { kind: "exited", since, exit_code: term.exit_code ?? null });
    return m;
  }
  m.exitSince = null;
  if (isShell(term)) {
    if (m.fg && now - m.fg.since >= MIN_RUN_MS) m.mark = { kind: "finished", since: now, command: m.fg.name };
    m.fg = null; m.needs = null; m.sig = null; m.sigSince = null; m.cpu = null; m.sampleAt = null; m.quietSig = null;
    return m;
  }
  const name = term.foreground?.name ?? "";
  // A program already running when tracking began (a REPL or pager left open) takes its first
  // screen as the quiet baseline; one started while tracked has none, so a prompt it shows at once counts.
  if (!m.fg) { m.fg = { name, since: now, preexisting: fresh }; m.sig = null; m.sigSince = null; m.needs = null; m.sampleAt = null; m.quietSig = null; }
  else if (name) m.fg = { ...m.fg, name };
  if (sample && sample.sig == null && sample.cpu != null) {
    // Only the CPU was read (no screen read while it is busy or the last read is recent).
    m.cpu = sample.cpu;
    if (m.cpu >= CPU_QUIET) { m.sig = null; m.sigSince = null; m.needs = null; m.sampleAt = null; m.line = ""; }
  }
  if (sample && sample.sig != null) {
    if (m.quietSig == null && m.fg.preexisting && m.sampleAt == null) m.quietSig = sample.sig;
    m.sampleAt = now;
    if (sample.sig !== m.sig) { m.sig = sample.sig; m.sigSince = now; m.needs = null; }
    m.cpu = sample.cpu ?? null;
    m.line = sample.line ?? "";
  }
  if (m.sig != null && !m.needs && m.quietSig !== m.sig && (m.cpu ?? Infinity) < CPU_QUIET
      && now - m.sigSince >= QUIET_MS && looksLikePrompt(m.line)) {
    m.needs = { since: m.sigSince, sig: m.sig };
  }
  return m;
};

// The user is looking at this terminal: clear marks raised up to now; needs-input stays cleared for this screen.
export const markSeen = (memory, address, now) => {
  const m = memory?.[address];
  if (!m || m.ignored) return memory;
  const n = { ...m, seenAt: now, needs: null };
  if (m.sig != null) n.quietSig = m.sig; // REPLs/pagers left open stay quiet until the screen changes
  if (m.mark && m.mark.since <= now) n.mark = null;
  return { ...memory, [address]: n };
};

const entryOf = (term, m, now) => {
  if (term.state === "finished") return m.mark?.kind === "exited" ? { kind: "exited", since: m.mark.since, exit_code: m.mark.exit_code } : null;
  if (!isShell(term)) {
    const fresh = m.sampleAt != null && (now == null || now - m.sampleAt <= STALE_MS);
    if (m.needs && fresh) return { kind: "needs-input", since: m.needs.since, command: m.fg?.name ?? term.foreground?.name ?? "" };
    if (m.mark) return { kind: m.mark.kind, since: m.mark.since, command: m.mark.command };
    if (fresh && m.sig !== m.quietSig && m.sig != null && m.sigSince != null && now != null && now - m.sigSince >= QUIET_LIST_MS && !looksLikePrompt(m.line))
      return { kind: "quiet", since: m.sigSince, command: m.fg?.name ?? term.foreground?.name ?? "" };
    return null;
  }
  return m.mark?.kind === "finished" ? { kind: "finished", since: m.mark.since, command: m.mark.command } : null;
};

// opts: { currentSpace (id), spaceOrder (ids), spaceNames / tabNames (id -> display name), focused (address), now }.
// Flat list, contiguous by space. Entries carry space/tab ids and spaceName/tabName for display.
export const waitingList = (memory, terms, opts = {}) => {
  const { currentSpace = null, spaceOrder = [], spaceNames = {}, tabNames = {}, focused = null, now = null } = opts;
  const out = [];
  for (const term of terms ?? []) {
    const m = memory?.[term.address];
    if (!m || m.ignored || !isPlain(term) || term.address === focused) continue;
    const e = entryOf(term, m, now);
    if (e) {
      const space = spaceOf(term), tab = tabOf(term);
      out.push({ address: term.address, space, tab, spaceName: spaceNames[space] ?? space, tabName: tabNames[tab] ?? tab, title: term.title ?? "", ...e });
    }
  }
  const rank = spaceRank(currentSpace, spaceOrder);
  return out.sort((a, b) =>
    rank(a.space) - rank(b.space) || (a.space < b.space ? -1 : a.space > b.space ? 1 : 0) ||
    (a.kind === "quiet") - (b.kind === "quiet") || a.since - b.since || (a.address < b.address ? -1 : 1));
};

// The current space first, then spaces() order, unknown spaces last.
const spaceRank = (currentSpace, spaceOrder) => (s) => {
  if (s === currentSpace) return -1;
  const i = spaceOrder.indexOf(s);
  return i < 0 ? spaceOrder.length : i;
};

const tail = (p) => {
  const parts = String(p ?? "").split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p ? "/" : "";
};

// Every live plain terminal for the sidebar list: the waiting entries' kinds merged onto all of them.
// opts: as waitingList plus tabOrder (tab ids). No focused/now-dependent exclusion: the focused terminal's marks are already
// cleared by markSeen, and the view marks it from the live focus. Rows hold no ages, so the published list changes only
// when something about a terminal changes. Rows: { address, space, tab, spaceName, tabName, program, cwd, kind|null, since }.
export const allRows = (memory, terms, opts = {}) => {
  const { currentSpace = null, spaceOrder = [], tabOrder = [], spaceNames = {}, tabNames = {}, now = null } = opts;
  const out = [];
  for (const term of terms ?? []) {
    if (!isPlain(term)) continue;
    const m = memory?.[term.address];
    const e = m && !m.ignored ? entryOf(term, m, now) : null;
    if (term.state === "finished" && !e) continue; // an exited terminal is listed only while it holds its mark
    const space = spaceOf(term), tab = tabOf(term);
    const name = String(term.foreground?.name ?? "").replace(/^-/, "");
    out.push({
      address: term.address, space, tab, spaceName: spaceNames[space] ?? space, tabName: tabNames[tab] ?? "",
      program: name || term.title || "", cwd: tail(term.foreground?.cwd ?? term.cwd), kind: e?.kind ?? null, since: e?.since ?? null,
    });
  }
  const rank = spaceRank(currentSpace, spaceOrder);
  const tabRank = (t) => { const i = tabOrder.indexOf(t); return i < 0 ? tabOrder.length : i; };
  return out.sort((a, b) =>
    rank(a.space) - rank(b.space) || (a.space < b.space ? -1 : a.space > b.space ? 1 : 0) ||
    tabRank(a.tab) - tabRank(b.tab) || (a.address < b.address ? -1 : 1));
};

export const count = (list) => list.filter((e) => e.kind !== "quiet").length;

// Only non-shell foregrounds are sampled. cpu (%, or null when unknown) comes from one ps per machine: a program
// that is using the CPU is not waiting, so its screen is not read. Otherwise read when there is no sample yet or the
// last is SAMPLE_EVERY_MS old; every SETTLED_EVERY_MS once the screen has been unchanged for QUIET_MS and was classified.
export const needsScreen = (term, memory, now, cpu = null) => {
  if (!isPlain(term) || term.state === "finished" || isShell(term)) return false;
  if (cpu != null && cpu >= CPU_QUIET) return false;
  const m = memory?.[term.address];
  const at = m?.sampleAt;
  if (at == null) return true;
  const settled = m.sig != null && m.sigSince != null && at - m.sigSince >= QUIET_MS;
  return now - at >= (settled ? SETTLED_EVERY_MS : SAMPLE_EVERY_MS);
};
