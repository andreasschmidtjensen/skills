// Pure helpers for the to-do tree (no herdr import; tests/tree.test.mjs).
// A list is a flat array of items { done, text, due, doneOn, depth }, in file
// order: a child directly follows its parent or a sibling subtree. File format:
// two spaces of indent per level, levels 0-2 (MAX_DEPTH 3). Any number of
// leading spaces is read, depth = floor(spaces / 2), as todo-items.py; an item
// keeps its own indent text until its depth changes, so an untouched file
// round-trips byte-identical.
export const MAX_DEPTH = 3;
export const ITEM = /^( *)- \[( |x)\] (.*)$/;

export function parseLine(text) {
  const due = /<!-- due: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  const done = /<!-- done: ([^>]*?) -->/.exec(text)?.[1] ?? null;
  return { text: text.replace(/\s*<!--[^>]*-->/g, "").trim(), due, doneOn: done };
}

// The items in a list file's text; an indent deeper than allowed (more than one
// level below the line before, or past MAX_DEPTH) is pulled up to fit.
export function parseItems(raw) {
  const items = [];
  for (const l of (raw ?? "").split("\n")) {
    const m = ITEM.exec(l);
    if (!m) continue;
    const depth = Math.min(Math.floor(m[1].length / 2), MAX_DEPTH - 1, items.length ? items[items.length - 1].depth + 1 : 0);
    items.push({ done: m[2] === "x", ...parseLine(m[3]), depth, indent: m[1], indentDepth: depth });
  }
  return items;
}

const indentOf = (i) => (i.indent !== undefined && i.indentDepth === (i.depth ?? 0) ? i.indent : "  ".repeat(i.depth ?? 0));
export const itemLine = (i) => `${indentOf(i)}- [${i.done ? "x" : " "}] ${i.text.replace(/\n/g, " ")}${i.due ? ` <!-- due: ${i.due} -->` : ""}${i.done && i.doneOn ? ` <!-- done: ${i.doneOn} -->` : ""}`;
export const serializeItems = (items) => `${items.map(itemLine).join("\n")}${items.length ? "\n" : ""}`;

// Each item's number as `mytodo` shows it (todo-items.py): 1, 1.2, 1.2.1.
export function numbers(items) {
  const c = [];
  return items.map((x) => {
    const d = x.depth ?? 0;
    c.length = Math.min(c.length, d + 1);
    while (c.length <= d) c.push(0);
    c[d]++;
    return c.join(".");
  });
}

// Index just past item i's subtree (its descendants follow it, deeper).
export function subtreeEnd(items, i) {
  let j = i + 1;
  while (j < items.length && (items[j].depth ?? 0) > (items[i].depth ?? 0)) j++;
  return j;
}
export const hasChildren = (items, i) => i + 1 < items.length && (items[i + 1].depth ?? 0) > (items[i].depth ?? 0);
export const descendants = (items, i) => { const out = []; for (let j = i + 1; j < subtreeEnd(items, i); j++) out.push(j); return out; };
// Parent's index, or -1 for a top-level item.
export function parentOf(items, i) {
  for (let j = i - 1; j >= 0; j--) if ((items[j].depth ?? 0) < (items[i].depth ?? 0)) return j;
  return -1;
}
// Ticked / all of the items below i (nested ones too).
export function counts(items, i) {
  const d = descendants(items, i);
  return { done: d.filter((j) => items[j].done).length, total: d.length };
}
export const allDone = (items, i) => items[i].done && descendants(items, i).every((j) => items[j].done);
export const canAddChild = (items, i) => (items[i].depth ?? 0) < MAX_DEPTH - 1;

// Ticks (on) or unticks the items at `idxs`. Ticking a parent ticks all its
// open descendants; unticking touches only the item itself; a parent is never
// ticked or unticked because of its children. Returns the new items and the
// indices that changed.
export function setDone(items, idxs, on, at) {
  const out = items.map((x) => ({ ...x })), changed = [];
  const set = (j) => { if (out[j].done !== on) { out[j].done = on; out[j].doneOn = on ? at : null; changed.push(j); } };
  for (const i of idxs) {
    set(i);
    if (on) for (const j of descendants(out, i)) set(j);
  }
  return { items: out, changed: changed.sort((a, b) => a - b) };
}
export const tick = (items, i, at) => setDone(items, [i], !items[i].done, at);

// The indices that removing `idxs` takes: each item and its subtree.
export function subtreeSet(items, idxs) {
  const gone = new Set();
  for (const i of idxs) for (let j = i; j < subtreeEnd(items, i); j++) gone.add(j);
  return gone;
}
// `idxs` without those inside another pick's subtree (what one `rm` covers).
export function subtreeRoots(items, idxs) {
  const gone = new Set(), roots = [];
  for (const i of [...new Set(idxs)].sort((a, b) => a - b)) {
    if (gone.has(i)) continue;
    roots.push(i);
    for (let j = i; j < subtreeEnd(items, i); j++) gone.add(j);
  }
  return roots;
}
export function removeSubtrees(items, idxs) {
  const gone = subtreeSet(items, idxs);
  return items.filter((_, j) => !gone.has(j));
}

// A new open item as the last child of item p (at the end of its subtree);
// null when p is already at the deepest level.
export function addChild(items, p, item) {
  if (!canAddChild(items, p)) return null;
  const at = subtreeEnd(items, p);
  return [...items.slice(0, at), { done: false, due: null, doneOn: null, ...item, depth: (items[p].depth ?? 0) + 1 }, ...items.slice(at)];
}

// `mytodo clear`: removes done items whose subtree is all done.
export function clearDone(items) {
  const hit = items.map((_, i) => i).filter((i) => allDone(items, i));
  return removeSubtrees(items, hit);
}

// How many items clearDone would remove.
export const clearCount = (items) => items.length - clearDone(items).length;

// Open items below i as lines of a bullet list, indented by how far below i.
export function openChildrenText(items, i) {
  const base = items[i].depth ?? 0;
  return descendants(items, i).filter((j) => !items[j].done)
    .map((j) => `${"  ".repeat((items[j].depth ?? 0) - base - 1)}- ${items[j].text}`).join("\n");
}
