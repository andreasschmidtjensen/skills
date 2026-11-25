import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseItems, serializeItems, subtreeEnd, counts, setDone, tick, removeSubtrees, addChild, clearDone, openChildrenText, canAddChild, MAX_DEPTH, clearCount, subtreeSet, subtreeRoots, numbers } from "../../herdr-app/mods/my-todos/tree.js";

const FLAT = "- [ ] one <!-- due: 2026-11-04 15:00 -->\n- [x] two <!-- done: 2026-11-03 09:30 -->\n- [ ] three\n";
const NESTED = "- [ ] a\n  - [ ] a1\n    - [x] a1x <!-- done: 2026-11-03 09:30 -->\n  - [ ] a2\n- [ ] b\n  - [x] b1 <!-- done: 2026-11-03 09:30 -->\n";

test("flat file round-trips byte-identical", () => {
  const items = parseItems(FLAT);
  assert.ok(items.every((x) => x.depth === 0));
  assert.equal(serializeItems(items), FLAT);
});

test("nested file round-trips and keeps depth", () => {
  const items = parseItems(NESTED);
  assert.deepEqual(items.map((x) => x.depth), [0, 1, 2, 1, 0, 1]);
  assert.equal(serializeItems(items), NESTED);
});

test("subtree ends and counts", () => {
  const items = parseItems(NESTED);
  assert.equal(subtreeEnd(items, 0), 4);
  assert.equal(subtreeEnd(items, 1), 3);
  assert.deepEqual(counts(items, 0), { done: 1, total: 3 });
});

test("cascade tick: parent ticks open descendants only", () => {
  const items = parseItems(NESTED);
  const r = tick(items, 0, "2026-11-23 10:00");
  assert.deepEqual(r.changed, [0, 1, 3]);
  assert.equal(r.items[2].doneOn, "2026-11-03 09:30"); // already done: untouched
  assert.ok(r.items.slice(0, 4).every((x) => x.done));
  assert.equal(items[0].done, false); // input not mutated
});

test("untick only that item; last child ticked doesn't tick parent", () => {
  const items = parseItems(NESTED);
  const all = tick(items, 0, "t").items;
  const r = tick(all, 0, "t");
  assert.deepEqual(r.changed, [0]);
  assert.ok(r.items[1].done && r.items[3].done);
  const one = setDone(items, [1], true, "t").items; // a1 (its child already done)
  const two = setDone(one, [3], true, "t").items;
  assert.equal(two[0].done, false);
});

test("subtree delete, also for several picks", () => {
  const items = parseItems(NESTED);
  assert.deepEqual(removeSubtrees(items, [0]).map((x) => x.text), ["b", "b1"]);
  assert.deepEqual(removeSubtrees(items, [1, 0, 5]).map((x) => x.text), ["b"]);
});

test("clear removes done items whose subtree is all done", () => {
  const items = parseItems(NESTED);
  assert.deepEqual(clearDone(items).map((x) => x.text), ["a", "a1", "a2", "b"]);
  assert.deepEqual(clearDone(parseItems(FLAT)).map((x) => x.text), ["one", "three"]);
});

test("depth limit: three levels, deeper indent is pulled up", () => {
  assert.equal(MAX_DEPTH, 3);
  const items = parseItems("- [ ] a\n  - [ ] b\n    - [ ] c\n      - [ ] d\n");
  assert.deepEqual(items.map((x) => x.depth), [0, 1, 2, 2]);
  assert.equal(canAddChild(items, 2), false);
  assert.equal(addChild(items, 2, { text: "x" }), null);
  assert.deepEqual(parseItems("      - [ ] x\n").map((x) => x.depth), [0]);
});

test("addChild goes at the end of the parent's subtree", () => {
  const items = parseItems(NESTED);
  const r = addChild(items, 0, { text: "a3", due: "2026-11-30" });
  assert.deepEqual(r.map((x) => x.text), ["a", "a1", "a1x", "a2", "a3", "b", "b1"]);
  assert.equal(r[4].depth, 1);
  assert.match(serializeItems(r), /\n {2}- \[ \] a3 <!-- due: 2026-11-30 -->\n- \[ \] b/);
});

test("open children as bullets", () => {
  assert.equal(openChildrenText(parseItems(NESTED), 0), "- a1\n- a2");
});

test("clearCount counts every item clear removes, nested ones too", () => {
  assert.equal(clearCount(parseItems(NESTED)), 2); // a1x and b1
  assert.equal(clearCount(parseItems(FLAT)), 1);
  assert.equal(clearCount(parseItems("- [ ] a\n  - [ ] b\n")), 0);
});

test("subtreeSet lists a parent and all below it (for syncing removals)", () => {
  assert.deepEqual([...subtreeSet(parseItems(NESTED), [0])], [0, 1, 2, 3]);
});

test("odd indent (shared fixture with tests/cli.sh): depth = spaces/2 rounded down, untouched file round-trips", () => {
  const raw = readFileSync(new URL("./fixtures/odd-indent.md", import.meta.url), "utf8");
  const items = parseItems(raw);
  assert.deepEqual(items.map((x) => x.text), ["a", "b odd three", "c odd one", "d five", "e six", "f eight"]);
  assert.deepEqual(items.map((x) => x.depth), [0, 1, 0, 1, 2, 2]);
  assert.equal(serializeItems(items), raw);
  // an added child gets the standard indent; the others keep theirs
  const r = addChild(items, 0, { text: "n" });
  assert.match(serializeItems(r), /^- \[ \] a\n {3}- \[ \] b odd three\n {2}- \[ \] n\n - \[ \] c odd one\n/);
});

test("subtreeRoots: only the picks not inside another pick's subtree", () => {
  const items = parseItems(NESTED);
  assert.deepEqual(subtreeRoots(items, [1, 0, 5, 2, 0]), [0, 5]);
  assert.deepEqual(subtreeRoots(items, [2, 3]), [2, 3]);
});

test("numbers match mytodo's paths", () => {
  assert.deepEqual(numbers(parseItems(NESTED)), ["1", "1.1", "1.1.1", "1.2", "2", "2.1"]);
});
