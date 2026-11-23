// The waiting mod: plain (non-agent) terminals that wait on you, across spaces.
// props().role picks the view:
//   "list"             a sidebar block: header "Terminals · n waiting" (a click opens the picker) and every live plain terminal
//                      below it, grouped by space, waiting ones marked; a click on a row focuses it. Polls and hears the keys' commands.
//   "badge"            the older one-row "Waiting · n" for layouts that still have it; a click opens the picker. Same polling.
//   "picker" (overlay) the list, grouped by space; ↑/↓ and Enter focus, Esc closes. An overlay copy with no role is the picker.
// Keys (keys.json): "cmd-shift-j": "mod.open:waiting" opens the picker (mod.json's popup; needs no listener),
// "cmd-j": "waiting.next" focuses the next waiting terminal. A "waiting.picker" command also toggles the list.
// Known limit: "waiting.<command>" reaches shown copies only (AGENTS.md), so "next" needs the badge (or the picker) on screen:
// with the sidebar collapsed or a layout without the list (or badge) block it does nothing.
// Every copy tries to poll, but only one holds the shared lock (the picker polls too, so it is fresh without the badge); it publishes the waiting list as shared "waiting.list", every terminal for the list block as "waiting.all" and the count as "waiting.count",
// each only when it changes.
// Rules live in rules.js, the pure view/command helpers in view.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, terminals, spaces, panes, focused, run, theme, props, nextCommand, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { isPlain, isShell, parsePsArgs, needsScreen, track, markSeen, waitingList, allRows, count, screenSig, lastLine } from "./rules.js";
import { POLL_MS, rowParts, listHeader, listRow, groupBySpace, pickNext, moveAt, lockHeld, whereIs } from "./view.js";

const LIST = "waiting.list", ALL = "waiting.all", COUNT = "waiting.count", LOCK = "waiting.lock", POPUP = "waiting.popup";
// Module scope is shared by every copy, so per-copy state (the lock id, the "polling" flag) lives on the view (init).
// MEM is deliberately module-scoped: whichever copy holds the lock reads and writes the one memory, so a
// hand-over keeps the marks. A reload of the mod's source starts it empty: marks raised so far are lost.
let MEM = {}; // address -> rules.js memory
let LAST = "", LAST_ALL = ""; // the published lists as JSON, to write shared state only when they change

const machineOf = (t) => (String(t.address).includes("/") ? String(t.address).split("/")[0] : null);

// One ps per machine for all candidate pids: address -> { cpu %, args }. A pid ps does not know simply has no entry.
async function cpuOf(terms) {
  const byMachine = new Map();
  for (const t of terms) {
    if (t.foreground?.pid == null) continue;
    const k = machineOf(t) ?? "";
    if (!byMachine.has(k)) byMachine.set(k, []);
    byMachine.get(k).push(t);
  }
  const out = new Map();
  await Promise.all([...byMachine].map(async ([k, ts]) => {
    // The foreground pid belongs to the terminal's machine: look it up there, not here.
    const ps = await exec("ps", ["-o", "pid=,%cpu=,args=", "-p", ts.map((t) => t.foreground.pid).join(",")], k ? { on: k } : undefined).catch(() => null);
    if (!ps) return; // ps exits 1 when some pid is gone but still prints the others
    const info = parsePsArgs(ps.stdout);
    for (const t of ts) if (info.has(Number(t.foreground.pid))) out.set(t.address, info.get(Number(t.foreground.pid)));
  }));
  return out;
}

// The screen is read only for a terminal whose CPU is quiet (rules.needsScreen).
async function screenOf(term) {
  const screen = await exec("hc", ["read", "--lines", "0", term.address]).catch(() => null);
  if (!screen || screen.code !== 0) return null;
  return { sig: screenSig(screen.stdout), line: lastLine(screen.stdout) };
}

async function pollOnce() {
  const now = Date.now();
  const all = terminals();
  const plain = all.filter(isPlain);
  const cands = plain.filter((t) => t.state !== "finished" && !isShell(t));
  const cpus = await cpuOf(cands);
  const samples = new Map();
  await Promise.all(cands.map(async (t) => {
    const info = cpus.get(t.address);
    const cpu = info?.cpu ?? null, args = info?.args ?? null;
    if (!needsScreen(t, MEM, now, cpu, args)) { if (cpu != null) samples.set(t.address, { cpu, args }); return; }
    const s = await screenOf(t);
    samples.set(t.address, s ? { ...s, cpu, args } : cpu != null ? { cpu, args } : null);
  }));
  const next = {};
  for (const t of plain) next[t.address] = track(MEM[t.address], t, now, samples.get(t.address) ?? null);
  MEM = next;
  const f = focused();
  if (f?.terminal) MEM = markSeen(MEM, f.terminal, now);
  const ss = spaces();
  const spaceNames = {}, tabNames = {}, tabOrder = [];
  for (const sp of ss) { spaceNames[sp.id] = sp.name; for (const tb of sp.tabs ?? []) { tabNames[tb.id] = tb.name; tabOrder.push(tb.id); } }
  const opts = { currentSpace: f?.space ?? null, spaceOrder: ss.map((s) => s.id), tabOrder, spaceNames, tabNames, now };
  const list = waitingList(MEM, all, { ...opts, focused: f?.terminal ?? null });
  const rows = allRows(MEM, all, opts);
  const allJson = JSON.stringify(rows);
  if (allJson !== LAST_ALL) { LAST_ALL = allJson; setShared(ALL, { rows }); }
  // Shared state is persisted and re-renders every mod: write it only when it changed.
  const json = JSON.stringify(list);
  if (json !== LAST) { LAST = json; setShared(LIST, { list }); }
  const n = count(list);
  if (shared(COUNT) !== n) setShared(COUNT, n);
}

// One poller: whoever finds the lock free or stale takes it; the holder renews it on every 2nd poll (lease LOCK_MS).
async function poll(st) {
  if (st.polling) return;
  st.polling = true;
  try {
    const now = Date.now();
    const lock = shared(LOCK);
    if (lockHeld(lock, st.me, now)) return;
    if (lock?.id !== st.me || now - lock.at >= POLL_MS * 1.5) setShared(LOCK, { id: st.me, at: now });
    await pollOnce();
  } catch (e) { console.log(`waiting: poll failed: ${e?.message ?? e}`); }
  finally { st.polling = false; }
}

const published = () => shared(LIST)?.list ?? [];
const publishedAll = () => shared(ALL)?.rows ?? [];

// Shows the terminal: its space and tab first, then its pane. A parked one (no pane) is kept as a tab first.
function focusTerminal(address) {
  const at = whereIs(address, panes(), spaces());
  if (!at) { run("terminal.keep", { terminal: address }); run("pane.focus", { terminal: address }); return; }
  if (at.space) run("space.select", { id: at.space });
  run("tab.select", { id: at.tab });
  run("pane.focus", { pane: at.pane });
}

// Debounced like Harbormaster's popup: two shown copies hear the same command, only the first acts.
function togglePicker() {
  const cur = shared(POPUP);
  if (cur && Date.now() - cur.at < 2000) return;
  if (cur?.open) { try { closeOverlay(cur.id); } catch {} setShared(POPUP, null); return; }
  const id = openOverlay({ mod: "waiting", props: { role: "picker" } });
  setShared(POPUP, { id, at: Date.now(), open: true });
}

async function listen(cx) {
  for (;;) {
    const c = String(await nextCommand());
    try {
      if (c === "picker") togglePicker();
      else if (c === "next") {
        const e = pickNext(published(), focused()?.terminal ?? null);
        if (e) focusTerminal(e.address);
      }
    } catch (e) { console.log(`waiting: command "${c}" failed: ${e?.message ?? e}`); }
    cx.notify();
  }
}

export default class Waiting extends View {
  init(_props, cx) {
    // An overlay copy without a role (mod.open:waiting) is the picker.
    this.role = props()?.role ?? (props()?.overlay ? "picker" : "badge");
    this.st = { me: `w${Math.random().toString(36).slice(2, 8)}`, polling: false }; // this copy's lock id
    this.handle = cx.focus_handle();
    this.at = 0;
    if (this.role === "picker") {
      this.handle.focus(); cx.timer.after(300, () => this.handle.focus());
      // Known to the badge's toggle even when opened by mod.open (cmd-shift-j).
      const id = props()?.overlay;
      if (id && shared(POPUP)?.id !== id) setShared(POPUP, { id, at: Date.now(), open: true });
    }
    // Every copy polls; the shared lock lets one do it, so the picker stays fresh without the badge.
    cx.timer.every(POLL_MS, (cx) => { poll(this.st); cx.notify(); });
    poll(this.st);
    cx.spawn((cx) => listen(cx)); // the picker copy listens too, so "next" works while it is open
  }

  // Called by Herdr when the copy ends, however the popup closed (Esc, a click beside it, Enter).
  async close() {
    if (this.role === "picker") { try { setShared(POPUP, null); } catch {} }
  }

  dismiss() {
    try { closeOverlay(props().overlay); } catch {}
  }

  go(e) {
    if (!e) return;
    this.dismiss();
    focusTerminal(e.address);
  }

  renderBadge(t) {
    const n = shared(COUNT) ?? 0;
    return h_flex().id("waiting-badge").px(12).h(28).items_center().gap(8).text_size(12).cursor_pointer()
      .text_color(n ? t.foreground : t.dim).hover((s) => s.bg(t.hover))
      .on_click(() => togglePicker())
      .child(div().text_color(n ? t.blocked : t.dim).child(n ? "●" : "○"))
      .child(div().flex_1().child(`Waiting · ${n}`));
  }

  renderList(t) {
    const n = shared(COUNT) ?? 0, h = listHeader(n);
    const here = focused()?.terminal ?? null;
    const kids = [];
    for (const g of groupBySpace(publishedAll())) {
      kids.push(div().px(12).pt(6).pb(2).text_size(11).text_color(t.dim).truncate().child(g.name || "—"));
      for (const e of g.rows) {
        const p = listRow(e), tone = p.dim ? t.dim : p.tone ? t[p.tone] ?? t.foreground : t.foreground;
        kids.push(h_flex().id(`wl-${e.address}`).mx(4).px(8).h(24).rounded(6).gap(6).items_center().text_size(12).cursor_pointer()
          .when(e.address === here, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
          .on_click(() => focusTerminal(e.address))
          .child(div().w(12).flex_none().text_color(tone).child(p.mark))
          .child(div().max_w(90).flex_none().truncate().text_color(p.dim ? t.dim : t.foreground).child(p.program))
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(p.tab))
          .child(div().max_w(70).flex_none().truncate().text_size(11).text_color(t.dim).child(p.cwd)));
      }
    }
    return v_flex().id("waiting-block").size_full().min_h(0)
      .child(h_flex().id("waiting-head").px(12).h(28).flex_none().items_center().text_size(12).cursor_pointer()
        .text_color(h.dim ? t.dim : t.foreground).hover((s) => s.bg(t.hover))
        .on_click(() => togglePicker())
        .child(div().flex_1().child(h.text)))
      .child(v_flex().id("waiting-all").flex_1().min_h(0).overflow_y_scrollbar().mode("always").children(kids));
  }

  renderRow(t, e, on, now) {
    const p = rowParts(e, now);
    const tone = p.dim ? t.dim : t[p.tone] ?? t.foreground;
    return h_flex().id(`wt-${e.address}`).mx(4).px(10).h(32).rounded(7).gap(10).items_center().cursor_pointer()
      .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover))
      .on_click(() => this.go(e))
      .child(div().w(14).flex_none().text_color(tone).child(p.icon))
      .child(div().w(84).flex_none().text_size(11).text_color(tone).child(p.word))
      .child(div().flex_1().truncate().text_color(p.dim ? t.dim : t.foreground).child(p.name))
      .child(div().max_w(160).truncate().text_size(11).text_color(t.dim).child(p.where))
      .child(div().w(36).flex_none().text_size(11).text_color(t.dim).child(p.age));
  }

  render() {
    const t = theme();
    if (this.role === "list") return this.renderList(t);
    if (this.role !== "picker") return this.renderBadge(t);
    const now = Date.now();
    const list = published();
    this.at = Math.min(this.at, Math.max(0, list.length - 1));
    const sel = list[this.at];
    const kids = [];
    for (const g of groupBySpace(list)) {
      kids.push(div().px(14).pt(8).pb(2).text_size(11).text_color(t.dim).child(g.name || "—"));
      for (const e of g.rows) kids.push(this.renderRow(t, e, e === sel, now));
    }
    if (!list.length) kids.push(div().px(14).py(12).text_color(t.dim).child("Nothing is waiting for you."));
    return v_flex().id("waiting-picker").track_focus(this.handle).w_full().min_h(0).p(14).gap(6).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.dismiss();
        if (k === "down") this.at = moveAt(this.at, list.length, 1);
        else if (k === "up") this.at = moveAt(this.at, list.length, -1);
        else if (k === "enter") return this.go(sel);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Waiting"))
        .child(div().id("waiting-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => this.dismiss()).child("Esc")))
      .child(v_flex().id("waiting-list").min_h(0).overflow_y_scroll().children(kids));
  }
}
