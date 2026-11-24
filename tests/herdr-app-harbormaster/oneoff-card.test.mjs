// A one-off on the Bridge, the card and the pane: the 1× tag, no Tasks, Claims only with a plan's claims,
// and the pushed branch where a PR would show.
// Run: node --import ./loader.mjs --test oneoff-card.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { resetShared } from "herdr";
import { find } from "gpui-kit";
import { cards } from "../../herdr-app/mods/harbormaster/overview.js";
import { noPrText } from "../../herdr-app/mods/harbormaster/prfacts.js";
import { card } from "../../herdr-app/mods/harbormaster/runcard.js";

const t = new Proxy({}, { get: () => "#888" });
const text = (e) => (e && typeof e === "object" && "kids" in e ? e.kids.map(text).join(" ") : typeof e === "string" || typeof e === "number" ? String(e) : "");
const run = (n, o = {}) => ({
  key: `:/r/${n}`, dir: `/r/${n}`, branch: `fix-${n}`, folder: "/p/skills", repo: "skills", type: "fix", phase: "running", statusLine: "running", progress: "working",
  tasks: [], prs: [], related: [], waiting: [], unhandled: 0, decided: [], issues: [], reports: [], proof: {}, question: null, ask: null, askedAt: null, away: null,
  updated: Date.now() - 60000, started: Date.now() - 300000, terminal: `w/${n}`, localTerminal: true, autonomy: "L1", machine: null, oneoff: null, pushed: null, ...o,
});
let view;
beforeEach(() => {
  resetShared();
  view = { runs: [], decisions: [], folds: new Map(), busy: {}, replying: null, size: { width: 860 } };
  globalThis.__herdrTerminals = [{ address: "w/a", name: "a", labels: { role: "orchestrator" }, state: "live", status: "idle" }];
  globalThis.__herdrAgents = [];
  globalThis.__herdrExec = async () => ({ code: 0, stdout: "[]", stderr: "" });
});

test("where a PR would show: the pushed branch, else the usual words", () => {
  assert.equal(noPrText(run("a", { pushed: "oneoff/typo" })), "branch oneoff/typo pushed · open the PR yourself");
  assert.equal(noPrText(run("a", { pushed: "oneoff/typo", phase: "finished" }), { card: true }), "branch oneoff/typo pushed · open the PR yourself");
  assert.equal(noPrText(run("a")), "No pull request yet");
  assert.equal(noPrText(run("a", { phase: "finished" })), "None");
  assert.equal(noPrText(run("a", { phase: "finished" }), { card: true }), null);
});

test("the Bridge row of a one-off has the 1× tag, a normal run does not", () => {
  const s = text(cards(view, t, [run("a", { oneoff: "checkout" }), run("b")], [], []));
  assert.equal((s.match(/1×/g) ?? []).length, 1);
});

test("a one-off's card: 1× tag, pushed line, no task strip", () => {
  const ctx = { terminals: globalThis.__herdrTerminals, agents: [], runs: [], prs: new Map() };
  const draw = (r) => text(card(view, t, r, ctx));
  // A normal run with the same tasks shows the bar: the check above is not vacuous.
  assert.ok(find(card(view, t, run("c", { tasks: [{ id: "t1", name: "t1", state: "merged" }], planned: 1, merged: 1 }), ctx), "seg-:/r/c-0"), "a normal run shows its task bar");
  const tasks = [{ id: "t1", name: "t1", state: "merged" }];
  const one = draw(run("a", { oneoff: "worktree", pushed: "oneoff/typo", tasks, planned: 1 }));
  assert.match(one, /1×/);
  assert.match(one, /branch oneoff\/typo pushed · open the PR yourself/);
  assert.doesNotMatch(one, /No pull request yet/);
  assert.ok(find(card(view, t, run("a", { oneoff: "worktree", tasks, planned: 1 }), ctx), "seg-:/r/a-0") === null, "no task bar");
  const plain = draw(run("b"));
  assert.doesNotMatch(plain, /1×/);
  assert.match(plain, /No pull request yet/);
});
