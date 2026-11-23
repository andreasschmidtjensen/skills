import { test } from "node:test";
import assert from "node:assert/strict";
import { ageText, rowParts, groupBySpace, pickNext, moveAt, lockHeld, whereIs, LOCK_MS } from "../../herdr-app/mods/waiting/view.js";

test("ageText: seconds, minutes, hours, days", () => {
  assert.equal(ageText(4000), "4s");
  assert.equal(ageText(185000), "3m");
  assert.equal(ageText(2 * 3600e3), "2h");
  assert.equal(ageText(72 * 3600e3), "3d");
  assert.equal(ageText(-5), "0s");
});

test("rowParts: finished, exited with code, needs input, quiet greyed", () => {
  const now = 100000;
  const fin = rowParts({ kind: "finished", command: "make", tab: "build", since: now - 30000, address: "t1" }, now);
  assert.deepEqual([fin.icon, fin.word, fin.name, fin.where, fin.age, fin.dim], ["✓", "finished", "make", "build", "30s", false]);
  assert.equal(rowParts({ kind: "exited", exit_code: 2, title: "zsh", tab: "1", since: now, address: "t2" }, now).word, "exited 2");
  const ni = rowParts({ kind: "needs-input", command: "ssh", tab: "2", title: "ssh host", since: now, address: "t3" }, now);
  assert.equal(ni.icon, "!");
  assert.equal(ni.where, "ssh host"); // an unnamed (numeric) tab falls back to the title
  const q = rowParts({ kind: "quiet", command: "node", since: now - 120000, address: "t4" }, now);
  assert.equal(q.dim, true);
  assert.equal(q.age, "2m");
});

test("groupBySpace keeps list order and splits on space change", () => {
  const g = groupBySpace([{ space: "a", address: "1" }, { space: "a", address: "2" }, { space: "b", address: "3" }]);
  assert.deepEqual(g.map((x) => [x.space, x.rows.length]), [["a", 2], ["b", 1]]);
  assert.deepEqual(groupBySpace(null), []);
  const n = groupBySpace([{ space: "s7", spaceName: "api", address: "1" }]);
  assert.deepEqual([n[0].space, n[0].name], ["s7", "api"], "header shows the name, falls back to the id");
  assert.equal(groupBySpace([{ space: "s8", address: "1" }])[0].name, "s8");
});

test("rowParts: where shows the tab name, not the id", () => {
  assert.equal(rowParts({ kind: "finished", command: "make", tab: "tb4", tabName: "build", since: 0, address: "t1" }, 0).where, "build");
  assert.equal(rowParts({ kind: "finished", command: "make", tab: "tb4", tabName: "2", title: "zsh", since: 0, address: "t1" }, 0).where, "zsh");
});

test("pickNext: first counted entry, skipping quiet; after the focused one with wrap", () => {
  const l = [{ address: "q", kind: "quiet" }, { address: "a", kind: "finished" }, { address: "b", kind: "exited" }];
  assert.equal(pickNext(l, "x").address, "a");
  assert.equal(pickNext(l, "a").address, "b");
  assert.equal(pickNext(l, "b").address, "a");
  assert.equal(pickNext([{ address: "a", kind: "finished" }], "a"), null);
  assert.equal(pickNext([{ address: "q", kind: "quiet" }], null), null);
  assert.equal(pickNext([], null), null);
});

test("moveAt wraps both ways and survives an empty list", () => {
  assert.equal(moveAt(0, 3, -1), 2);
  assert.equal(moveAt(2, 3, 1), 0);
  assert.equal(moveAt(0, 0, 1), 0);
});

test("lockHeld: only another copy's fresh claim blocks", () => {
  assert.equal(lockHeld(null, "me", 1000), false);
  assert.equal(lockHeld({ id: "me", at: 999 }, "me", 1000), false);
  assert.equal(lockHeld({ id: "other", at: 1000 }, "me", 1000 + LOCK_MS - 1), true);
  assert.equal(lockHeld({ id: "other", at: 1000 }, "me", 1000 + LOCK_MS), false);
});

test("whereIs finds pane, tab and space; null for a parked terminal", () => {
  const panes = [{ pane: "p1", terminal: "t1", tab: "tab9" }];
  const spaces = [{ id: "s1", tabs: [{ id: "tab1" }] }, { id: "s2", tabs: [{ id: "tab9" }] }];
  assert.deepEqual(whereIs("t1", panes, spaces), { pane: "p1", tab: "tab9", space: "s2" });
  assert.equal(whereIs("t2", panes, spaces), null);
});
