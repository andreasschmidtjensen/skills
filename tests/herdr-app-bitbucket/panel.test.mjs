import test from "node:test";
import assert from "node:assert/strict";
import { fixtureFrom, rowMeta, updatedText, buildColour, approvalsText, commentsText, stateView, openCommand } from "../../herdr-app/mods/bitbucket-prs/rows.js";

test("fixtureFrom reads the line", () => {
  assert.equal(fixtureFrom("workspace=acme\nfixture=/tmp/f.json\r\n"), "/tmp/f.json");
  assert.equal(fixtureFrom("workspace=acme"), "");
});
test("rowMeta ages on from the poll", () => {
  const r = { repo: "app", branch: "fix", ageMs: 3_600_000 };
  assert.equal(rowMeta(r, 1000 + 3_600_000, 1000), "app · fix · 2h");
  assert.equal(rowMeta({ repo: "app", branch: "", ageMs: 0 }, 5, 5), "app · 0m");
});
test("updatedText", () => {
  assert.equal(updatedText(0, 5), "not updated yet");
  assert.equal(updatedText(1000, 13000), "updated 12s ago");
  assert.equal(updatedText(0 + 1, 200_000), "updated 3m ago");
});
test("buildColour / counts", () => {
  assert.equal(buildColour("ok"), "ansi2");
  assert.equal(buildColour("failed"), "ansi1");
  assert.equal(buildColour("running"), "ansi3");
  assert.equal(buildColour("none"), null);
  assert.equal(approvalsText(2), "✓2");
  assert.equal(approvalsText(0), "");
  assert.equal(commentsText(3), "#3");
});
test("stateView", () => {
  assert.equal(stateView({ status: "ok", message: "" }), null);
  assert.ok(stateView({ status: "setup" }).block);
  assert.ok(stateView({ status: "ok" }, false).block);
  assert.ok(stateView({ status: "auth" }).block);
  assert.equal(stateView({ status: "throttled", message: "wait" }).tone, "accent");
  assert.equal(stateView({ status: "error" }).tone, "error");
  assert.equal(stateView({ status: "ok", message: "budget" }).tone, "muted");
});
test("openCommand", () => {
  assert.deepEqual(openCommand("https://x.test/a", "macos"), ["open", ["https://x.test/a"]]);
  assert.deepEqual(openCommand("https://x.test/a", "linux"), ["xdg-open", ["https://x.test/a"]]);
  assert.equal(openCommand("javascript:1", "macos"), null);
});
