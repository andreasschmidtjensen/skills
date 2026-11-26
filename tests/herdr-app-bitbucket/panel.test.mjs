import test from "node:test";
import assert from "node:assert/strict";
import { fixtureFrom, rowMeta, branchText, EMPTY_TEXT, updatedText, buildColour, approvalsText, commentsText, stateView, openCommand } from "../../herdr-app/mods/bitbucket-prs/rows.js";

test("fixtureFrom reads the line", () => {
  assert.equal(fixtureFrom("workspace=acme\nfixture=/tmp/f.json\r\n"), "/tmp/f.json");
  assert.equal(fixtureFrom("workspace=acme"), "");
});
test("rowMeta: author · #id · repo · age, ages on from the poll", () => {
  const r = { author: "anna", id: 21, repo: "app", branch: "fix", dest: "main", ageMs: 3_600_000 };
  assert.equal(rowMeta(r, 1000 + 3_600_000, 1000), "anna · #21 · app · 2h");
  assert.equal(rowMeta({ id: 3, repo: "app", ageMs: 0 }, 5, 5), "#3 · app · 0m");
});
test("branchText and empty text", () => {
  assert.equal(branchText({ branch: "fix", dest: "main" }), "fix → main");
  assert.equal(branchText({ branch: "fix", dest: "" }), "fix");
  assert.equal(branchText({ branch: "", dest: "" }), "");
  assert.equal(EMPTY_TEXT, "No open pull requests in the project");
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

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tabRows, emptyText, REVIEW_EMPTY_TEXT, TABS, reposFrom, withRepos, WRITE_CONFIG_SH, canSaveConfig, isChosen, chosenCount, toggleRepo, sameChoice } from "../../herdr-app/mods/bitbucket-prs/rows.js";

test("tabs: Mine | To review | Project; To review = reviewing Project rows", () => {
  assert.deepEqual(TABS.map((t) => t[1]), ["Mine", "To review", "Project"]);
  const data = { mine: [{ id: 1 }], project: [{ id: 2, reviewing: true }, { id: 3, reviewing: false }, { id: 4, reviewing: true }] };
  assert.deepEqual(tabRows(data, "mine").map((r) => r.id), [1]);
  assert.deepEqual(tabRows(data, "review").map((r) => r.id), [2, 4]);
  assert.deepEqual(tabRows(data, "project").map((r) => r.id), [2, 3, 4]);
  assert.deepEqual(tabRows({}, "review"), []);
  assert.equal(emptyText("review"), "Nothing waiting for your review");
  assert.equal(REVIEW_EMPTY_TEXT, emptyText("review"));
  assert.equal(emptyText("project"), EMPTY_TEXT);
  assert.equal(emptyText("mine"), "No open pull requests");
});

test("reposFrom: no line = null (all), empty = none, else the slugs", () => {
  assert.equal(reposFrom("workspace=acme\nemail=kim@example.com\n"), null);
  assert.deepEqual(reposFrom("workspace=acme\nrepos=app, api ,lib\r\nemail=x"), ["app", "api", "lib"]);
  assert.deepEqual(reposFrom("repos=\n"), []);
});

test("withRepos replaces/adds/removes only the repos= line", () => {
  const cfg = "workspace=acme\nemail=kim@example.com\nproject=WEB\n";
  assert.equal(withRepos(cfg, ["app", "api"]), `${cfg}repos=app,api\n`);
  assert.equal(withRepos(`${cfg}repos=old\n`, ["lib"]), `${cfg}repos=lib\n`);
  assert.equal(withRepos("workspace=acme\nrepos=old\nemail=kim@example.com", ["x"]), "workspace=acme\nemail=kim@example.com\nrepos=x\n");
  assert.equal(withRepos(`${cfg}repos=old\n`, null), cfg);
  assert.equal(withRepos(cfg, []), `${cfg}repos=\n`);
  assert.equal(withRepos("", null), "");
});

test("chooser helpers", () => {
  const all = ["a", "b", "c"];
  assert.equal(isChosen(null, "a"), true);
  assert.equal(isChosen(["b"], "a"), false);
  assert.equal(chosenCount(null, all), 3);
  assert.equal(chosenCount(["a", "gone"], all), 1);
  assert.deepEqual(toggleRepo(null, all, "b"), ["a", "c"]);
  assert.deepEqual(toggleRepo(["a"], all, "c"), ["a", "c"]);
  assert.equal(toggleRepo(["a", "b"], all, "c"), null, "everything ticked = all");
  assert.deepEqual(toggleRepo(["a"], all, "a"), []);
  assert.equal(sameChoice(null, null), true);
  assert.equal(sameChoice(null, ["a"]), false);
  assert.equal(sameChoice(["a", "b"], ["b", "a"]), true);
});

test("WRITE_CONFIG_SH writes the config atomically, mode 600, other lines kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "bbcfg-"));
  try {
    const env = { ...process.env, XDG_CONFIG_HOME: dir };
    const text = withRepos("workspace=acme\nemail=kim@example.com\n", ["app", "api"]);
    execFileSync("sh", ["-c", WRITE_CONFIG_SH, "sh", text], { env });
    const file = join(dir, "bitbucket-prs", "config");
    assert.equal(readFileSync(file, "utf8"), "workspace=acme\nemail=kim@example.com\nrepos=app,api\n");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    execFileSync("sh", ["-c", WRITE_CONFIG_SH, "sh", withRepos(readFileSync(file, "utf8"), null)], { env });
    assert.equal(readFileSync(file, "utf8"), "workspace=acme\nemail=kim@example.com\n");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(execFileSync("ls", ["-A", join(dir, "bitbucket-prs")], { env }).toString().trim().split("\n"), ["config"], "no temp file left");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("canSaveConfig: only a config with a workspace may be rewritten", () => {
  assert.equal(canSaveConfig("workspace=acme\nemail=kim@example.com\n"), true);
  assert.equal(canSaveConfig(""), false);
  assert.equal(canSaveConfig(null), false);
  assert.equal(canSaveConfig("repos=app\n"), false);
  assert.equal(canSaveConfig("workspace=\nrepos=app\n"), false);
});
