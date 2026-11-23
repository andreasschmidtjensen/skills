// The waiting mod: plain (non-agent) terminals that wait on you, across spaces.
// props().role picks the view:
//   "badge"            one row "Waiting · n" for the sidebar; a click opens the picker. Polls and hears the keys' commands.
//   "picker" (overlay) the list, grouped by space; ↑/↓ and Enter focus, Esc closes.
// Keys (keys.json): "cmd-shift-j": "mod.open:waiting" opens the picker (mod.json's popup; needs no listener),
// "cmd-j": "waiting.next" focuses the next waiting terminal. A "waiting.picker" command also toggles the list.
// Known limit: "waiting.<command>" reaches shown copies only (AGENTS.md), so "next" needs the badge (or the picker) on screen:
// with the sidebar collapsed or a layout without the badge block it does nothing.
// Only one copy polls (the shared lock); it publishes the list as shared "waiting.list" and the count as "waiting.count",
// each only when it changes.
// Rules live in rules.js, the pure view/command helpers in view.js.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, terminals, spaces, panes, focused, run, theme, props, nextCommand, openOverlay, closeOverlay, shared, setShared } from "herdr";
import { isPlain, needsScreen, track, markSeen, waitingList, count, screenSig, lastLine } from "./rules.js";
import { POLL_MS, rowParts, groupBySpace, pickNext, moveAt, lockHeld, whereIs } from "./view.js";

const LIST = "waiting.list", COUNT = "waiting.count", LOCK = "waiting.lock", POPUP = "waiting.popup";
// Module scope is shared by every copy, so per-copy state (the lock id, the "polling" flag) lives on the view (init).
// MEM is deliberately module-scoped: whichever copy holds the lock reads and writes the one memory, so a
// hand-over keeps the marks. A reload of the mod's source starts it empty: marks raised so far are lost.
let MEM = {}; // address -> rules.js memory
let LAST = ""; // the published list as JSON, to write shared state only when it changes

async function sampleOf(term) {
  // The foreground pid belongs to the terminal's machine ("machine/tN"): look it up there, not here.
  const machine = String(term.address).includes("/") ? String(term.address).split("/")[0] : null;
  const [screen, ps] = await Promise.all([
    exec("hc", ["read", "--lines", "0", term.address]).catch(() => null),
    exec("ps", ["-o", "%cpu=", "-p", String(term.foreground?.pid ?? "")], machine ? { on: machine } : undefined).catch(() => null),
  ]);
  if (!screen || screen.code !== 0) return null;
  const cpu = ps && ps.code === 0 ? parseFloat(ps.stdout) : NaN;
  return { sig: screenSig(screen.stdout), cpu: Number.isFinite(cpu) ? cpu : null, line: lastLine(screen.stdout) };
}

async function pollOnce() {
  const now = Date.now();
  const all = terminals();
  const plain = all.filter(isPlain);
  const samples = new Map();
  await Promise.all(plain.filter((t) => needsScreen(t, MEM, now)).map(async (t) => {
    const s = await sampleOf(t);
    if (s) samples.set(t.address, s);
  }));
  const next = {};
  for (const t of plain) next[t.address] = track(MEM[t.address], t, now, samples.get(t.address) ?? null);
  MEM = next;
  const f = focused();
  if (f?.terminal) MEM = markSeen(MEM, f.terminal, now);
  const ss = spaces();
  const list = waitingList(MEM, all, {
    currentSpace: ss.find((s) => s.id === f?.space)?.name ?? null,
    spaceOrder: ss.map((s) => s.name), focused: f?.terminal ?? null, now,
  });
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
    this.role = props()?.role ?? "badge";
    this.st = { me: `w${Math.random().toString(36).slice(2, 8)}`, polling: false }; // this copy's lock id
    this.handle = cx.focus_handle();
    this.at = 0;
    if (this.role === "picker") { this.handle.focus(); cx.timer.after(300, () => this.handle.focus()); }
    cx.timer.every(POLL_MS, (cx) => { if (this.role !== "picker") poll(this.st); cx.notify(); });
    if (this.role !== "picker") poll(this.st);
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
    if (this.role !== "picker") return this.renderBadge(t);
    const now = Date.now();
    const list = published();
    this.at = Math.min(this.at, Math.max(0, list.length - 1));
    const sel = list[this.at];
    const kids = [];
    for (const g of groupBySpace(list)) {
      kids.push(div().px(14).pt(8).pb(2).text_size(11).text_color(t.dim).child(g.space || "—"));
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
