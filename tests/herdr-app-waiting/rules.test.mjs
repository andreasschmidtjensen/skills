import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RUN_MS, QUIET_MS, QUIET_LIST_MS, STALE_MS, track, markSeen, waitingList, count, needsScreen, allRows, parsePs, parsePsArgs, isInteractive, CPU_QUIET, SETTLED_EVERY_MS, SAMPLE_EVERY_MS, looksLikePrompt, lastLine, screenSig,
} from "../../herdr-app/mods/waiting/rules.js";

const S = 1000;
const t0 = 1_000_000;
const term = (o = {}) => ({
  address: "t4h", state: "live", status: null, foreground: { name: "zsh", pid: 1 }, program: { shell: true, agent: false },
  labels: { "herdr.space": "sp1", "herdr.tab": "tb1" }, ...o,
});
const busy = (o = {}) => term({ foreground: { name: "make", pid: 2 }, program: { shell: false, agent: false }, ...o });
const run = (steps) => { let m; for (const [t, now, s] of steps) m = track(m, t, now, s); return m; };
const mem = (m, a = "t4h") => ({ [a]: m });
const sm = (sig, line = "", cpu = 0) => ({ sig, cpu, line });

test("looksLikePrompt", () => {
  for (const l of ["Continue?", "Name:", "$ >", "Proceed [y/N]", "ok (yes/no)", "Enter PASSWORD", "enter Passphrase for key", "will continue now"])
    assert.ok(looksLikePrompt(l), l);
  for (const l of ["", "   ", "building...", "done", "[1/3] compiling", "arr[0]"]) assert.ok(!looksLikePrompt(l), l);
  assert.equal(lastLine("a\nb\n\n  \n"), "b");
  assert.notEqual(screenSig("a"), screenSig("b"));
});

test("command >= 10 s that returns to shell is finished", () => {
  const m = run([[busy(), t0], [term(), t0 + MIN_RUN_MS]]);
  const l = waitingList(mem(m), [term()]);
  assert.deepEqual(l.map((e) => [e.kind, e.since, e.command]), [["finished", t0 + MIN_RUN_MS, "make"]]);
  assert.equal(count(l), 1);
});

test("9 s command is not flagged", () => {
  const m = run([[busy(), t0], [term(), t0 + 9 * S]]);
  assert.deepEqual(waitingList(mem(m), [term()]), []);
});

test("exited terminal is waiting with exit code", () => {
  const x = term({ state: "finished", finished_ms: t0 - 5, exit_code: 2 });
  const l = waitingList(mem(track(undefined, x, t0)), [x]);
  assert.deepEqual(l.map((e) => [e.kind, e.since, e.exit_code]), [["exited", t0 - 5, 2]]);
});

test("exited stays cleared after seen, even on later polls", () => {
  const x = term({ state: "finished", finished_ms: t0 - 5, exit_code: 0 });
  let M = mem(track(undefined, x, t0));
  M = markSeen(M, "t4h", t0 + 1);
  M = mem(track(M.t4h, x, t0 + 2 * S));
  assert.deepEqual(waitingList(M, [x]), []);
});

const B = sm("0", "starting"); // baseline sample: the screen when tracking began
const U = t0 + S; // the prompt appears one second in

test("needs input: quiet screen + prompt + low cpu", () => {
  const b = busy();
  const P = sm("A", "Continue? [y/N]");
  let m = run([[b, t0, B], [b, U, P], [b, U + QUIET_MS - 1, P]]);
  assert.deepEqual(waitingList(mem(m), [b], { now: U + QUIET_MS - 1 }), []);
  m = track(m, b, U + QUIET_MS, P);
  const l = waitingList(mem(m), [b], { now: U + QUIET_MS });
  assert.deepEqual(l.map((e) => [e.kind, e.since, e.command]), [["needs-input", U, "make"]]);
  assert.equal(count(l), 1);
});

test("no needs input when cpu busy, cpu missing, or line is not a prompt", () => {
  const b = busy();
  const at = U + 10 * S;
  const hot = run([[b, t0, B], [b, U, sm("A", "Name:", 50)], [b, at, sm("A", "Name:", 50)]]);
  assert.deepEqual(waitingList(mem(hot), [b], { now: at }), []);
  const nocpu = run([[b, t0, B], [b, U, { sig: "A", line: "Name:" }], [b, at, { sig: "A", line: "Name:" }]]);
  assert.deepEqual(waitingList(mem(nocpu), [b], { now: at }), []);
  const plain = run([[b, t0, B], [b, U, sm("A", "building")], [b, at, sm("A", "building")]]);
  assert.deepEqual(waitingList(mem(plain), [b], { now: at }), []);
});

test("screen change ends needs-input", () => {
  const b = busy();
  let m = run([[b, t0, B], [b, U, sm("A", "Name:")], [b, U + 6 * S, sm("A", "Name:")]]);
  assert.equal(waitingList(mem(m), [b], { now: U + 6 * S }).length, 1);
  m = track(m, b, U + 7 * S, sm("B", "working..."));
  assert.deepEqual(waitingList(mem(m), [b], { now: U + 7 * S }), []);
});

test("quiet >= 60 s without prompt is listed, not counted, last in its group", () => {
  const b = busy(), n = busy({ address: "t9" });
  const Q = t0 + S;
  let M = mem(run([[b, t0, B], [b, Q, sm("A", "building")], [b, Q + QUIET_LIST_MS - 1, sm("A", "building")]]));
  assert.deepEqual(waitingList(M, [b], { now: Q + QUIET_LIST_MS - 1 }), []);
  M.t4h = track(M.t4h, b, Q + QUIET_LIST_MS, sm("A", "building"));
  M.t9 = run([[n, t0 + 30 * S, B], [n, t0 + 31 * S, sm("P", "Name:")], [n, t0 + 40 * S, sm("P", "Name:")], [n, Q + QUIET_LIST_MS - 1000, sm("P", "Name:")]]);
  const l = waitingList(M, [b, n], { now: Q + QUIET_LIST_MS });
  assert.deepEqual(l.map((e) => e.kind), ["needs-input", "quiet"]);
  assert.equal(count(l), 1);
});

test("seen clears finished mark and exited; needs-input stays cleared while screen same, re-arms on change", () => {
  const b = busy();
  let M = mem(run([[b, t0], [term(), t0 + 11 * S]]));
  M = markSeen(M, "t4h", t0 + 12 * S);
  assert.deepEqual(waitingList(M, [term()]), []);
  M = mem(track(M.t4h, term(), t0 + 13 * S));
  assert.deepEqual(waitingList(M, [term()]), []);

  let N = mem(run([[b, t0, B], [b, U, sm("A", "Name:")], [b, U + 6 * S, sm("A", "Name:")]]));
  assert.equal(waitingList(N, [b], { now: U + 6 * S }).length, 1);
  N = markSeen(N, "t4h", U + 7 * S);
  assert.deepEqual(waitingList(N, [b], { now: U + 7 * S }), []);
  N = mem(track(N.t4h, b, U + 20 * S, sm("A", "Name:")));
  assert.deepEqual(waitingList(N, [b], { now: U + 20 * S }), [], "same screen stays cleared");
  N = mem(track(N.t4h, b, U + 21 * S, sm("B", "Password:")));
  N = mem(track(N.t4h, b, U + 27 * S, sm("B", "Password:")));
  assert.equal(waitingList(N, [b], { now: U + 27 * S })[0].kind, "needs-input");
});

test("busy sample then idle prompt: needs-input (no cpu latch); needsScreen keeps sampling", () => {
  const b = busy();
  let M = mem(run([[b, t0, B], [b, t0 + S, sm("A", "compiling", 40)]]));
  assert.equal(needsScreen(b, M, t0 + S + 1000), false, "sampled < 2 s ago");
  assert.equal(needsScreen(b, M, t0 + S + 2000), true, "2 s later: sample again");
  M = mem(track(M.t4h, b, t0 + 6 * S, sm("P", "Name:", 0)));
  M = mem(track(M.t4h, b, t0 + 11 * S, sm("P", "Name:", 0)));
  assert.equal(waitingList(M, [b], { now: t0 + 11 * S })[0].kind, "needs-input");
});

test("stale samples give no needs-input and no quiet", () => {
  const b = busy();
  const M = mem(run([[b, t0, B], [b, t0 + S, sm("A", "Name:")], [b, t0 + 7 * S, sm("A", "Name:")]]));
  assert.equal(waitingList(M, [b], { now: t0 + 7 * S })[0].kind, "needs-input");
  assert.deepEqual(waitingList(M, [b], { now: t0 + 7 * S + STALE_MS + 1 }), []);
  const Q = mem(run([[b, t0, B], [b, t0 + S, sm("A", "building")]]));
  assert.deepEqual(waitingList(Q, [b], { now: t0 + 10 * 60 * S }), []);
});

test("foreground switch without a shell keeps the run start but shows the latest name", () => {
  const cc = busy({ foreground: { name: "cc", pid: 3 } });
  const M = mem(run([[busy(), t0], [cc, t0 + 4 * S], [term(), t0 + MIN_RUN_MS]]));
  assert.deepEqual(waitingList(M, [term()]).map((e) => [e.kind, e.command]), [["finished", "cc"]]);
});

test("REPL/pager left open stays out of the list until its screen changes", () => {
  const py = busy({ foreground: { name: "sqlplus", pid: 9 } }); // not on the REPL list, so only the seen-screen rule keeps it quiet
  const repl = sm("R1", ">>>");
  let M = mem(run([[py, t0, B], [py, t0 + S, repl], [py, t0 + S + QUIET_MS, repl]]));
  assert.equal(waitingList(M, [py], { now: t0 + S + QUIET_MS })[0].kind, "needs-input");
  M = markSeen(M, "t4h", t0 + 2 * S);
  for (const t of [10 * S, 60 * S, 10 * 60 * S]) M = mem(track(M.t4h, py, t0 + t, repl));
  assert.deepEqual(waitingList(M, [py], { now: t0 + 10 * 60 * S }), [], "no needs-input, no quiet");
  M = mem(track(M.t4h, py, t0 + 11 * 60 * S, sm("R2", "42\n>>>")));
  M = mem(track(M.t4h, py, t0 + 11 * 60 * S + 6 * S, sm("R2", ">>>")));
  assert.equal(waitingList(M, [py], { now: t0 + 11 * 60 * S + 6 * S })[0].kind, "needs-input");
});

test("a program already at a prompt when tracking began (after a reload) is flagged: no first-screen baseline", () => {
  const b = busy({ foreground: { name: "sudo", pid: 9 } });
  let M = mem(run([[b, t0, sm("S1", "Password:")], [b, t0 + 6 * S, sm("S1", "Password:")]]));
  assert.equal(waitingList(M, [b], { now: t0 + 6 * S })[0].kind, "needs-input");
});

const ansible = busy({ foreground: { name: "python3.10", pid: 7 } });
const ARGS = "/usr/bin/python3.10 /usr/local/bin/ansible-playbook -i inv plays/patch.yml";
const as = (sig, line, cpu = 4, args = ARGS) => ({ sig, cpu, line, args });

test("isInteractive: pagers always, REPLs only without a script or -c/-m", () => {
  const t = (name) => busy({ foreground: { name, pid: 1 } });
  assert.equal(isInteractive(t("less"), "less file.txt"), true);
  assert.equal(isInteractive(t("man"), "man ls"), true);
  assert.equal(isInteractive(t("python3"), "python3"), true);
  assert.equal(isInteractive(t("python3.10"), "python3.10 -i"), true);
  assert.equal(isInteractive(t("python3.10"), "python3.10 /bin/ansible-playbook x.yml"), false);
  assert.equal(isInteractive(t("python3"), "python3 -c input('? ')"), false);
  assert.equal(isInteractive(t("python3"), ["python3", "-m", "http.server"]), false);
  assert.equal(isInteractive(t("node"), "node"), true);
  assert.equal(isInteractive(t("node"), "node app.js"), false);
  assert.equal(isInteractive(t("sudo"), "sudo ls"), false);
  assert.equal(isInteractive(busy({ foreground: { name: "python3", pid: 1, argv: ["python3", "x.py"] } })), false, "falls back to foreground.argv");
});

test("ansible-like prompt (python3.10 with script argv, cpu 4, ':') is needs-input, even right after a reload", () => {
  const P = as("A", ":");
  const m = run([[ansible, t0, P], [ansible, t0 + QUIET_MS, P]]);
  assert.equal(waitingList(mem(m), [ansible], { now: t0 + QUIET_MS })[0].kind, "needs-input");
  assert.equal(needsScreen(ansible, {}, t0, 4, ARGS), true);
});

test("python3 REPL with '>>>' and less with ':' are not flagged and never quiet", () => {
  for (const [name, args, line] of [["python3", "python3", ">>>"], ["less", "less big.log", ":"]]) {
    const t = busy({ foreground: { name, pid: 3 } });
    const P = as("R", line, 0, args);
    let m = run([[t, t0, P], [t, t0 + QUIET_MS, P], [t, t0 + QUIET_LIST_MS + S, P]]);
    assert.deepEqual(waitingList(mem(m), [t], { now: t0 + QUIET_LIST_MS + S }), [], name);
    assert.equal(needsScreen(t, mem(m), t0 + 99 * S, 0, args), false, name);
  }
});

test("python3 -c input() prompt is flagged", () => {
  const t = busy({ foreground: { name: "python3", pid: 3 } });
  const P = as("Q", "? ", 0, "python3 -c input('? ')");
  const m = run([[t, t0, P], [t, t0 + QUIET_MS, P]]);
  assert.equal(waitingList(mem(m), [t], { now: t0 + QUIET_MS })[0].kind, "needs-input");
});

test("seen then unchanged stays quiet", () => {
  const P = as("A", ":");
  let M = mem(run([[ansible, t0, P], [ansible, t0 + QUIET_MS, P]]));
  M = markSeen(M, "t4h", t0 + QUIET_MS + S);
  M = mem(track(M.t4h, ansible, t0 + 2 * QUIET_MS, P));
  assert.deepEqual(waitingList(M, [ansible], { now: t0 + 2 * QUIET_MS }), []);
});

test("parsePsArgs keeps the args with their spaces", () => {
  const m = parsePsArgs(" 12  4.2 /usr/bin/python3.10 /x/ansible-playbook -e a=b c\n 13 0.0\njunk\n");
  assert.deepEqual(m.get(12), { cpu: 4.2, args: "/usr/bin/python3.10 /x/ansible-playbook -e a=b c" });
  assert.deepEqual(m.get(13), { cpu: 0, args: "" });
});

test("a mark raised after the seen time is not cleared by it", () => {
  const b = busy();
  let M = markSeen(mem(run([[b, t0]])), "t4h", t0 + 5 * S);
  M = mem(track(M.t4h, term(), t0 + 20 * S));
  assert.equal(waitingList(M, [term()]).length, 1);
});

test("focused terminal never counts", () => {
  const M = mem(run([[busy(), t0], [term(), t0 + 11 * S]]));
  assert.deepEqual(waitingList(M, [term()], { focused: "t4h" }), []);
});

test("agents and hidden workers are ignored", () => {
  const ag = term({ address: "a1", status: "working" });
  const ag2 = term({ address: "a2", program: { shell: true, agent: true } });
  const hid = term({ address: "h1", labels: {} });
  const hidBusy = busy({ address: "h2", labels: {} });
  const M = {};
  for (const x of [ag, ag2, hid]) M[x.address] = track(undefined, x, t0);
  for (const x of [ag, ag2, hid]) M[x.address] = track(M[x.address], term({ ...x, state: "finished", finished_ms: t0 }), t0 + 20 * S);
  M.h2 = track(undefined, hidBusy, t0);
  assert.ok(Object.values(M).every((m) => m.ignored));
  assert.deepEqual(waitingList(M, [ag, ag2, hid, hidBusy], { now: t0 + 99 * S }), []);
});

test("order: current space first, then spaceOrder, oldest first within a group", () => {
  const mk = (address, space, since) => {
    const t = term({ address, state: "finished", finished_ms: since, exit_code: 1, labels: { "herdr.space": space } });
    return [t, track(undefined, t, since + 1)];
  };
  const rows = [mk("a", "s1", 300), mk("b", "s2", 500), mk("c", "s2", 100), mk("d", "s3", 50), mk("e", "s1", 200), mk("f", "zz", 10)];
  const M = Object.fromEntries(rows.map(([t, m]) => [t.address, m]));
  const l = waitingList(M, rows.map(([t]) => t), { currentSpace: "s2", spaceOrder: ["s1", "s2", "s3"] });
  assert.deepEqual(l.map((e) => e.address), ["c", "b", "e", "a", "d", "f"]);
});

test("needsScreen: only non-shell foreground that may be quiet", () => {
  assert.equal(needsScreen(term(), {}, t0), false);
  assert.equal(needsScreen(busy(), {}, t0), true);
  assert.equal(needsScreen(busy({ cpu: 40 }), {}, t0), true, "term.cpu does not gate sampling");
  assert.equal(needsScreen(busy(), { t4h: { cpu: 30, sampleAt: t0 } }, t0 + 5 * S), true, "memory cpu does not latch");
  assert.equal(needsScreen(busy(), { t4h: { sampleAt: t0 } }, t0 + 1 * S), false);
  assert.equal(needsScreen(busy({ state: "finished" }), {}, t0), false);
  assert.equal(needsScreen(busy({ status: "idle" }), {}, t0), false);
  assert.equal(needsScreen(busy({ labels: {} }), {}, t0), false);
});

test("a program started while tracked that shows a prompt at once needs input (live bug)", () => {
  const base = { address: "t9", state: "live", status: null, labels: { "herdr.space": "s1" } };
  const shell = { ...base, foreground: { name: "zsh", pid: 1 }, program: { shell: true, agent: false } };
  const py = { ...base, foreground: { name: "python3", pid: 2, argv: ["python3", "job.py"] }, program: { shell: false, agent: false } };
  let m = track(undefined, shell, 0);
  m = track(m, py, 1000, { sig: "P", cpu: 0, line: "Continue? [y/N]" });
  m = track(m, py, 7000, { sig: "P", cpu: 0, line: "Continue? [y/N]" });
  assert.ok(m.needs, "flagged");
});

test("a REPL already open when tracking began stays quiet", () => {
  const py = { address: "t8", state: "live", status: null, labels: { "herdr.space": "s1" }, foreground: { name: "python3", pid: 2 }, program: { shell: false, agent: false } };
  let m = track(undefined, py, 0, { sig: "R", cpu: 0, line: ">>>" });
  m = track(m, py, 60000, { sig: "R", cpu: 0, line: ">>>" });
  assert.equal(m.needs ?? null, null);
});

test("waitingList: ids rank and group, names come from the maps (ids differ from names)", () => {
  const mk = (a, sp, tb) => busy({ address: a, labels: { "herdr.space": sp, "herdr.tab": tb } });
  const a = mk("t1", "s9", "tb1"), b = mk("t2", "s2", "tb2"), c = mk("t3", "s5", "tb3");
  let M = {};
  for (const [i, x] of [a, b, c].entries()) M[x.address] = track(undefined, x, t0 + i);
  for (const x of [a, b, c]) M[x.address] = track(M[x.address], term({ address: x.address, labels: x.labels }), t0 + MIN_RUN_MS + 5);
  const l = waitingList(M, [a, b, c].map((x) => term({ address: x.address, labels: x.labels })), {
    currentSpace: "s5", spaceOrder: ["s2", "s5", "s9"],
    spaceNames: { s5: "api", s2: "web", s9: "ops" }, tabNames: { tb3: "build", tb2: "2", tb1: "logs" }, now: t0 + MIN_RUN_MS + 6,
  });
  assert.deepEqual(l.map((e) => [e.space, e.spaceName, e.tab, e.tabName]),
    [["s5", "api", "tb3", "build"], ["s2", "web", "tb2", "2"], ["s9", "ops", "tb1", "logs"]], "current space first, then spaceOrder");
});

test("waitingList: a remote terminal's labels get the machine prefix", () => {
  const r = busy({ address: "box/t7", labels: { "herdr.space": "s1", "herdr.tab": "tb1" } });
  const M = { "box/t7": track(undefined, r, t0) };
  const rs = term({ address: "box/t7", labels: { "herdr.space": "s1", "herdr.tab": "tb1" } });
  M["box/t7"] = track(M["box/t7"], rs, t0 + MIN_RUN_MS);
  const l = waitingList(M, [rs], { currentSpace: "box/s1", spaceNames: { "box/s1": "remote" }, now: t0 + MIN_RUN_MS });
  assert.deepEqual([l[0].space, l[0].tab, l[0].spaceName], ["box/s1", "box/tb1", "remote"]);
});

test("parsePs reads pid and cpu lines, skips junk", () => {
  const m = parsePs("  123  0.0\n 4567 12.5\nbad line\n");
  assert.deepEqual([...m], [[123, 0], [4567, 12.5]]);
  assert.equal(parsePs(null).size, 0);
});

test("needsScreen gating: busy cpu skips the read; settled screens back off to 10 s", () => {
  assert.equal(needsScreen(busy(), {}, t0, CPU_QUIET), false, "cpu at the threshold is busy");
  assert.equal(needsScreen(busy(), {}, t0, 40), false);
  assert.equal(needsScreen(busy(), {}, t0, 0.2), true, "quiet cpu, no sample yet");
  assert.equal(needsScreen(busy(), {}, t0, null), true, "unknown cpu falls back to reading");
  const fresh = { t4h: { sig: "A", sigSince: t0, sampleAt: t0 + S } }; // read < QUIET_MS after the change: not yet classified
  assert.equal(needsScreen(busy(), fresh, t0 + S + SAMPLE_EVERY_MS, 0), true);
  const settled = { t4h: { sig: "A", sigSince: t0, sampleAt: t0 + QUIET_MS } };
  assert.equal(needsScreen(busy(), settled, t0 + QUIET_MS + SAMPLE_EVERY_MS, 0), false, "settled: wait 10 s");
  assert.equal(needsScreen(busy(), settled, t0 + QUIET_MS + SETTLED_EVERY_MS, 0), true);
});

test("a cpu-only sample while busy resets the screen baseline and hides needs-input", () => {
  const b = busy();
  let m = run([[b, t0, sm("A", "compiling", 0)], [b, t0 + S, sm("P", "Continue?", 0)], [b, t0 + S + QUIET_MS, sm("P", "Continue?", 0)]]);
  assert.equal(waitingList(mem(m), [b], { now: t0 + S + QUIET_MS })[0].kind, "needs-input");
  m = track(m, b, t0 + QUIET_MS + 2 * S, { cpu: 50 });
  assert.deepEqual(waitingList(mem(m), [b], { now: t0 + QUIET_MS + 2 * S }), []);
  assert.equal(m.sig, null);
  assert.equal(m.sigSince, null);
});

test("allRows: every live plain terminal, current space first, marks merged, agents left out", () => {
  const a = term({ address: "t1", foreground: { name: "-zsh", pid: 1, cwd: "/home/u/proj/app" }, labels: { "herdr.space": "s1", "herdr.tab": "b1" } });
  const b = busy({ address: "t2", labels: { "herdr.space": "s2", "herdr.tab": "b2" } });
  const c = term({ address: "t3", status: "idle", labels: { "herdr.space": "s2", "herdr.tab": "b2" } }); // an agent
  const d = term({ address: "t4", state: "finished", labels: { "herdr.space": "s2", "herdr.tab": "b3" } });
  const e = term({ address: "t5", labels: { "herdr.space": "s2", "herdr.tab": "b3" } });
  const terms = [a, b, c, d, e];
  let m = {};
  for (const x of terms) m = { ...m, [x.address]: track(m[x.address], x, t0) };
  m = { ...m, t5: track(track(undefined, busy({ address: "t5", labels: e.labels }), t0), e, t0 + MIN_RUN_MS) };
  const rows = allRows(m, terms, { currentSpace: "s2", spaceOrder: ["s1", "s2"], tabOrder: ["b3", "b2", "b1"], spaceNames: { s1: "one", s2: "two" }, tabNames: { b1: "main", b2: "build" }, now: t0 + MIN_RUN_MS });
  assert.deepEqual(rows.map((r) => [r.address, r.spaceName, r.kind]), [["t4", "two", "exited"], ["t5", "two", "finished"], ["t2", "two", null], ["t1", "one", null]]);
  assert.deepEqual([rows[3].program, rows[3].cwd, rows[3].tabName, rows[2].program, rows[2].tabName], ["zsh", "app", "main", "make", "build"]);
  assert.equal(count(waitingList(m, terms, { now: t0 + MIN_RUN_MS })), 2);
});

test("allRows: an exited terminal is listed while it holds its mark; rows hold no ages", () => {
  const x = term({ address: "t9", state: "finished", finished_ms: t0 - 5, exit_code: 1 });
  const m = mem(track(undefined, x, t0), "t9");
  const [r] = allRows(m, [x], { now: t0 });
  assert.equal(r.kind, "exited");
  assert.deepEqual(allRows(m, [x], { now: t0 + 99 * S }), [r]);
  assert.deepEqual(allRows({}, [x], {}), []);
});
