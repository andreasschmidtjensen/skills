import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalisePr, buildState, formatAge, isToReview, createPoller, interpretFetch, urlRepos, urlMine, urlRepoPrs, repoScanStrategy, HOURLY_CAP, PROJECT_BUILD_LOOKUPS_PER_SCAN } from "../../herdr-app/mods/bitbucket-prs/bb.js";

const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}.json`, import.meta.url), "utf8"));
const ME = "{11111111-aaaa-aaaa-aaaa-111111111111}";
const NOW = Date.parse("2026-11-25T12:00:00Z");

// Fake Bitbucket: routes by path, counts calls. `over` replaces a route's response.
function fake(over = {}) {
  const calls = [];
  const f = async (path) => {
    calls.push(path);
    for (const [k, v] of Object.entries(over)) if (path.includes(k)) return typeof v === "function" ? v(path) : v;
    if (path.startsWith("/user")) return fx("user");
    if (path.includes("/pullrequests/%7B")) return fx("mine");
    if (path.startsWith("/repositories/acme?")) return fx("repos");
    if (path.includes("/app/pullrequests?")) return fx("repo-app-prs");
    if (path.includes("/api/pullrequests?")) return fx("repo-api-prs");
    if (path.includes("/statuses")) return fx("statuses-ok");
    throw new Error("unrouted " + path);
  };
  return { f, calls };
}
const clock = (t = NOW) => { const c = { t, now: () => c.t }; return c; };

test("normalisePr maps a Bitbucket PR to a row", () => {
  const row = normalisePr(fx("mine").values[0], NOW, "ok");
  assert.deepEqual(row, { id: 7, title: "Add retry to client", repo: "app", fullName: "acme/app", branch: "feature/retry",
    url: "https://bitbucket.org/acme/app/pull-requests/7", approvals: 1, comments: 3, ageMs: NOW - Date.parse("2026-11-24T08:00:00Z"),
    build: "ok", updatedOn: "2026-11-25T10:00:00.000000+00:00", dest: "", author: "", draft: false, reviewing: false });
});

test("formatAge", () => {
  assert.equal(formatAge(5 * 60_000), "5m");
  assert.equal(formatAge(3 * 3600_000), "3h");
  assert.equal(formatAge(47 * 3600_000), "47h");
  assert.equal(formatAge(60 * 3600_000), "2d");
  assert.equal(formatAge(20 * 86400_000), "2w");
});

test("buildState from commit statuses", () => {
  assert.equal(buildState(fx("statuses-ok").values), "ok");
  assert.equal(buildState(fx("statuses-failed").values), "failed");
  assert.equal(buildState(fx("statuses-running").values), "running");
  assert.equal(buildState([]), "none");
});

test("urls carry a fields filter", () => {
  assert.match(urlMine("acme", ME), /^\/workspaces\/acme\/pullrequests\/%7B1111[^?]+\?state=OPEN&pagelen=50&fields=values\.id,/);
  assert.match(urlRepoPrs("acme", "app"), /^\/repositories\/acme\/app\/pullrequests\?state=OPEN/);
});

test("strategy filter: reviewer, not approved, not author", () => {
  const ids = fx("repo-app-prs").values.filter((p) => isToReview(p, ME)).map((p) => p.id);
  assert.deepEqual(ids, [21]);
  assert.equal(isToReview({ ...fx("repo-app-prs").values[0], author: { uuid: "{11111111-AAAA-aaaa-aaaa-111111111111}" } }, ME), false);
});

test("Mine lists my open PRs in the configured workspace only", async () => {
  const { f } = fake(); const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  const r = await p.poll();
  assert.equal(r.state.status, "ok");
  assert.deepEqual(r.mine.map((x) => x.id), [7]);
  assert.equal(r.mine[0].build, "ok");
  assert.deepEqual(r.project.map((x) => x.id), [24, 21, 22, 23], "all open PRs, newest first, incl. mine and drafts");
  assert.deepEqual(r.project.map((x) => x.reviewing), [false, true, false, false], "marker: reviewer and not approved");
  const d = r.project[0];
  assert.deepEqual([d.draft, d.author, d.dest, d.branch], [true, "kim", "develop", "feature/d"]);
  assert.deepEqual([r.project[1].draft, r.project[1].author, r.project[1].dest], [false, "anna", "main"]);
});

test("build status is fetched once per (id, updated_on)", async () => {
  let updated = "2026-11-25T10:00:00.000000+00:00";
  const mine = () => { const m = fx("mine"); m.values[0].updated_on = updated; return m; };
  const { f, calls } = fake({ "/pullrequests/%7B": mine });
  const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  const n = () => calls.filter((x) => x.includes("/pullrequests/7/statuses")).length;
  await p.poll(); c.t += 60_000; await p.poll({ force: true });
  assert.equal(n(), 1);
  updated = "2026-11-25T11:00:00.000000+00:00"; c.t += 60_000; await p.poll({ force: true });
  assert.equal(n(), 2);
});

test("429 honours Retry-After and pauses polling", async () => {
  const c = clock(); let limited = true;
  const { f, calls } = fake({ "/user": () => (limited ? { error: { kind: "http", status: 429, retryAfter: 90 } } : fx("user")) });
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  let r = await p.poll();
  assert.equal(r.state.status, "throttled");
  assert.equal(r.state.nextAt, NOW + 90_000);
  const n = calls.length; c.t += 30_000; await p.poll({ force: true });
  assert.equal(calls.length, n, "no request while throttled, even when forced");
  limited = false; c.t += 61_000; r = await p.poll();
  assert.equal(r.state.status, "ok");
});

test("429 without Retry-After doubles up to 10 min", async () => {
  const c = clock();
  const { f } = fake({ "/user": { error: { kind: "http", status: 429, retryAfter: null } } });
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  const waits = [];
  for (let i = 0; i < 6; i++) { const r = await p.poll(); waits.push(r.state.nextAt - c.t); c.t = r.state.nextAt; }
  assert.deepEqual(waits, [120_000, 240_000, 480_000, 600_000, 600_000, 600_000]);
});

test("missing config/token -> setup state; 401 -> auth state naming scopes", async () => {
  let r = await createPoller({ fetch: async () => ({ error: { kind: "token", status: 0 } }), workspace: "acme", now: clock().now }).poll();
  assert.equal(r.state.status, "setup");
  assert.match(r.state.message, /token/);
  r = await createPoller({ fetch: async () => ({ error: { kind: "http", status: 401, retryAfter: null } }), workspace: "acme", now: clock().now }).poll();
  assert.equal(r.state.status, "auth");
  assert.match(r.state.message, /read:user:bitbucket/);
  assert.doesNotMatch(JSON.stringify(r), /secret/);
});

test("5xx -> error state with backoff", async () => {
  const r = await createPoller({ fetch: async () => ({ error: { kind: "http", status: 502, retryAfter: null } }), workspace: "acme", now: clock().now }).poll();
  assert.equal(r.state.status, "error");
});

test("interpretFetch", () => {
  assert.deepEqual(interpretFetch('{"a":1}', 0), { a: 1 });
  assert.equal(interpretFetch('{"error":{"kind":"token","status":0}}', 4).error.kind, "token");
  assert.equal(interpretFetch("", 5).error.kind, "network");
});

test("request budget: a simulated hour stays well under 600 requests", async () => {
  const c = clock();
  const repos = { values: Array.from({ length: 40 }, (_, i) => ({ slug: `r${i}`, updated_on: "2026-10-01T00:00:00+00:00" })) };
  const active = (path) => {
    const slug = /repositories\/acme\/(r\d+)\//.exec(path)[1];
    const n = Number(slug.slice(1));
    return { values: n < 8 ? fx("repo-app-prs").values.map((v) => ({ ...v, id: v.id + n * 100, destination: { repository: { full_name: `acme/${slug}` } } })) : [] };
  };
  const { f, calls } = fake({ "/repositories/acme?": repos, "/pullrequests?": active });
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  for (let i = 0; i < 60; i++) { await p.poll(); c.t += 60_000; }
  assert.ok(calls.length < 600, `used ${calls.length}`);
  assert.ok(p.requestsLastHour() <= HOURLY_CAP);
});

test("hard cap skips work instead of erroring", async () => {
  const c = clock();
  const { f, calls } = fake();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now, hourlyCap: 3 });
  const r = await p.poll();
  assert.equal(calls.length, 3);
  assert.notEqual(r.state.status, "throttled");
});

test("project strategy is replaceable", async () => {
  const c = clock(); const { f } = fake();
  const only = async () => ({ prs: [fx("repo-app-prs").values[0]] });
  const r = await createPoller({ fetch: f, workspace: "acme", now: c.now, projectStrategy: only }).poll();
  assert.deepEqual(r.project.map((x) => x.id), [21]);
});

test("repo list is cached for an hour; idle repos are rescanned rarely", async () => {
  const c = clock(); const { f, calls } = fake();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  await p.poll({ force: true });
  c.t += 300_000; await p.poll({ force: true });
  assert.equal(calls.filter((x) => x.startsWith("/repositories/acme?")).length, 1);
  assert.equal(calls.filter((x) => x.includes("/api/pullrequests?")).length, 1, "idle repo not rescanned after 5 min");
  assert.equal(calls.filter((x) => x.includes("/app/pullrequests?")).length, 2, "active repo rescanned");
});

// ---- project=KEY ----
test("urlRepos adds a project.key query only with a project", () => {
  assert.doesNotMatch(urlRepos("acme"), /q=/);
  assert.match(urlRepos("acme", "ACME"), /&q=project\.key%3D%22ACME%22&fields=/);
});

test("project: repos found via project query; Mine limited to those repos; scan only those", async () => {
  const mine = fx("mine");
  mine.values.push({ ...mine.values[0], id: 8, destination: { repository: { full_name: "acme/api" } } }); // in workspace, not in project
  const { f, calls } = fake({ "q=project": fx("repos-project"), "/pullrequests/%7B": mine });
  const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", project: "ACME", now: c.now });
  const r = await p.poll();
  assert.equal(r.state.status, "ok");
  assert.deepEqual(r.mine.map((x) => x.id), [7]);
  assert.deepEqual(r.project.map((x) => x.id), [24, 21, 22, 23]);
  assert.equal(calls.filter((x) => x.startsWith("/repositories/acme?")).length, 1, "repo list shared by both tabs");
  assert.equal(calls.filter((x) => x.includes("/api/pullrequests?")).length, 0);
});

test("project with few repos scans every 60s; many repos fall back to 5 min", async () => {
  const run = async (n) => {
    const repos = { values: Array.from({ length: n }, (_, i) => ({ slug: `r${i}`, updated_on: "x" })) };
    const { f, calls } = fake({ "q=project": repos, "/pullrequests?": fx("repo-app-prs") }); // active repos are rescanned every cycle
    const c = clock();
    const p = createPoller({ fetch: f, workspace: "acme", project: "ACME", now: c.now });
    await p.poll(); const n0 = calls.length;
    c.t += 60_000; await p.poll();
    return calls.slice(n0).some((x) => x.includes("/pullrequests?"));
  };
  assert.equal(await run(3), true);
  assert.equal(await run(9), false);
});

test("project: a simulated hour stays under 600 requests", async () => {
  const repos = { values: Array.from({ length: 5 }, (_, i) => ({ slug: `r${i}`, updated_on: "x" })) };
  const active = (path) => { const s = /acme\/(r\d)\//.exec(path)[1]; return { values: fx("repo-app-prs").values.map((v) => ({ ...v, id: v.id + Number(s[1]) * 100, destination: { repository: { full_name: `acme/${s}` } } })) }; };
  const { f, calls } = fake({ "q=project": repos, "/pullrequests?": active, "/pullrequests/%7B": { values: [] } });
  const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", project: "ACME", now: c.now });
  for (let i = 0; i < 60; i++) { await p.poll(); c.t += 60_000; }
  assert.ok(calls.length < 600, `used ${calls.length}`);
});

// ---- budget never becomes an error ----
test("300 repos: budget is never an error and Mine still refreshes every 60s", async () => {
  const repos = { values: Array.from({ length: 300 }, (_, i) => ({ slug: `r${i}`, updated_on: "x" })) };
  const { f, calls } = fake({ "/repositories/acme?": repos, "/pullrequests?": { values: [] } });
  const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  let mineCalls = 0, notices = 0;
  for (let i = 0; i < 180; i++) { // three simulated hours
    const before = calls.filter((x) => x.includes("/pullrequests/%7B")).length;
    const r = await p.poll();
    assert.equal(r.state.status, "ok", `minute ${i}: ${r.state.message}`);
    if (r.state.message) notices++;
    mineCalls += calls.filter((x) => x.includes("/pullrequests/%7B")).length - before;
    c.t += 60_000;
  }
  assert.equal(mineCalls, 180, "Mine listed every minute");
  assert.ok(p.requestsLastHour() <= HOURLY_CAP);
  assert.ok(calls.length <= 3 * HOURLY_CAP, `used ${calls.length} in 3h`);
});

test("budget exhausted: state stays ok with a notice, last data kept", async () => {
  const c = clock(); const { f } = fake();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now, hourlyCap: 4 });
  const r1 = await p.poll();
  assert.deepEqual(r1.mine.map((x) => x.id), [7]);
  c.t += 60_000;
  const r2 = await p.poll({ force: true });
  assert.equal(r2.state.status, "ok");
  assert.match(r2.state.message, /budget/);
  assert.deepEqual(r2.mine.map((x) => x.id), [7]);
});

test("/user reply without uuid is an error, not a cached undefined", async () => {
  const { f, calls } = fake({ "/user": { display_name: "x" } });
  const r = await createPoller({ fetch: f, workspace: "acme", now: clock().now }).poll();
  assert.equal(r.state.status, "error");
  assert.ok(!calls.some((x) => x.includes("undefined")));
});

test("one repo answering 404 or 403 counts as no PRs; panel stays ok and Mine refreshes", async () => {
  const repos = { values: ["app", "gone", "locked"].map((slug) => ({ slug, updated_on: "2026-11-25T10:00:00+00:00" })) };
  const { f, calls } = fake({
    "/repositories/acme?": repos,
    "/gone/pullrequests?": { error: { kind: "http", status: 404 } },
    "/locked/pullrequests?": { error: { kind: "http", status: 403 } },
  });
  const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  let r = await p.poll();
  assert.equal(r.state.status, "ok");
  assert.deepEqual(r.mine.map((x) => x.id), [7]);
  assert.deepEqual(r.project.map((x) => x.id), [24, 21, 22, 23]);
  const n = (s) => calls.filter((x) => x.includes(s)).length;
  assert.equal(n("/gone/pullrequests?"), 1);
  c.t += 60_000; r = await p.poll(); // Mine due again, Project not (5 min)
  assert.equal(r.state.status, "ok");
  assert.equal(n("/pullrequests/%7B"), 2, "Mine refreshed");
  c.t += 300_000; r = await p.poll();
  assert.equal(r.state.status, "ok");
  assert.equal(n("/gone/pullrequests?"), 1, "failing repo is not retried until idle recheck");
  assert.equal(n("/locked/pullrequests?"), 1);
});

test("workspace and repo slugs compare case-insensitively", async () => {
  const run = async (project) => {
    const { f } = fake(project ? { "q=project": fx("repos-project") } : {});
    const p = createPoller({ fetch: f, workspace: "Acme", project, now: clock().now });
    return (await p.poll()).mine.map((x) => x.id);
  };
  assert.deepEqual(await run(""), [7]);
  assert.deepEqual(await run("ACME"), [7]);
});

test("Project build lookups are capped per scan: reviewing rows plus 10 others", async () => {
  const repos = { values: Array.from({ length: 25 }, (_, i) => ({ slug: `r${i}`, updated_on: "x" })) };
  const pr = (repo, id, reviewing) => ({
    id, title: `PR ${id}`, state: "OPEN", created_on: `2026-11-2${id % 5}T06:00:00+00:00`, updated_on: "2026-11-25T09:00:00+00:00",
    author: { uuid: "{22222222-bbbb-bbbb-bbbb-222222222222}", display_name: "anna" }, source: { branch: { name: "f" } },
    destination: { repository: { full_name: `acme/${repo}` }, branch: { name: "main" } }, links: { html: { href: "https://bitbucket.org/x" } },
    reviewers: reviewing ? [{ uuid: ME }] : [], participants: reviewing ? [{ role: "REVIEWER", approved: false, user: { uuid: ME } }] : [],
  });
  const over = { "/statuses": fx("statuses-ok"), "/pullrequests/%7B": { values: [] } };
  repos.values.forEach((r, i) => { over[`/${r.slug}/pullrequests?`] = { values: Array.from({ length: 10 }, (_, k) => pr(r.slug, i * 10 + k + 1, i === 0 && k < 2)) }; });
  const { f, calls } = fake({ "/repositories/acme?": repos, ...over });
  const c = clock();
  const r = await createPoller({ fetch: f, workspace: "acme", now: c.now }).poll();
  const n = (s) => calls.filter((x) => x.includes(s)).length;
  assert.equal(r.project.length, 250);
  assert.equal(r.project.filter((x) => x.reviewing).length, 2);
  assert.equal(n("/statuses"), 2 + PROJECT_BUILD_LOOKUPS_PER_SCAN);
  assert.equal(r.project.filter((x) => x.build === "ok").length, 12);
  assert.ok(r.project.filter((x) => x.reviewing).every((x) => x.build === "ok"));
  assert.equal(n("/pullrequests?"), 25);
});

// ---- repo allowlist (the chooser) -----------------------------------------------------------

function bigProject(n = 53) {
  const repos = { values: Array.from({ length: n }, (_, i) => ({ slug: `r${i}`, updated_on: "x" })) };
  const prs = (path) => {
    const slug = /repositories\/acme\/(r\d+)\//.exec(path)[1];
    return { values: Number(slug.slice(1)) < 6 ? fx("repo-app-prs").values.map((v) => ({ ...v, id: v.id + Number(slug.slice(1)) * 100, destination: { ...v.destination, repository: { full_name: `acme/${slug}` } } })) : [] };
  };
  return fake({ "/repositories/acme?": repos, "/pullrequests?": prs, "/pullrequests/%7B": { values: [] } });
}
const repoCalls = (calls) => calls.filter((x) => /\/repositories\/acme\/r\d+\/pullrequests\?/.test(x));

test("allowlist: 3 of 53 repos -> first scan makes <= 3 repo calls; To review = reviewing rows", async () => {
  const { f, calls } = bigProject(); const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", project: "WEB", repos: ["r0", "r1", "r40"], now: c.now });
  const r = await p.poll();
  assert.equal(repoCalls(calls).length, 3);
  assert.deepEqual([...new Set(r.project.map((x) => x.repo))].sort(), ["r0", "r1"]);
  assert.deepEqual(r.project.filter((x) => x.reviewing).map((x) => `${x.repo}#${x.id}`), ["r0#21", "r1#121"]);
  assert.equal(calls.filter((x) => x.startsWith("/repositories/acme?")).length, 1);
});

test("allowlist: slugs that no longer exist are ignored; Mine is not limited", async () => {
  const { f, calls } = fake({ "q=project": fx("repos") });
  const p = createPoller({ fetch: f, workspace: "acme", project: "WEB", repos: ["api", "gone"], now: clock().now });
  const r = await p.poll();
  assert.deepEqual(repoCalls(calls), []);
  assert.deepEqual(calls.filter((x) => /\/pullrequests\?/.test(x)).map((x) => /acme\/(\w+)\//.exec(x)[1]), ["api"]);
  assert.deepEqual(r.mine.map((x) => x.id), [7], "Mine shows the app PR although only api is chosen");
});

test("repoList fetches the list before any scan, sorted, once (cached)", async () => {
  const { f, calls } = bigProject(12); const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", now: c.now });
  const [a, b] = await Promise.all([p.repoList(), p.repoList()]);
  assert.deepEqual(a.repos, Array.from({ length: 12 }, (_, i) => `r${i}`).sort());
  assert.deepEqual(b, a);
  assert.deepEqual(calls, [calls[0]], "one request for two callers, no user/PR calls");
  await p.repoList();
  assert.equal(calls.length, 1);
  assert.equal((await createPoller({ fetch: async () => ({ error: { kind: "http", status: 500 } }), workspace: "acme", now: c.now }).repoList()).error.status, 500);
});

test("setRepos: removing a repo drops its rows at once, adding one scans it on the next poll", async () => {
  const { f, calls } = bigProject(); const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", project: "WEB", repos: ["r0", "r1"], now: c.now });
  let r = await p.poll();
  assert.deepEqual([...new Set(r.project.map((x) => x.repo))].sort(), ["r0", "r1"]);
  p.setRepos(["r0", "r3"]);
  const n = calls.length;
  assert.deepEqual([...new Set((await p.poll({ force: false })).project.map((x) => x.repo))].sort(), ["r0", "r3"], "r1 gone, r3 scanned although 5 min have not passed");
  assert.ok(repoCalls(calls.slice(n)).some((x) => x.includes("/r3/")));
  assert.ok(!repoCalls(calls.slice(n)).some((x) => x.includes("/r2/")));
  p.setRepos(["r0"]);
  assert.deepEqual([...new Set((await p.poll({ force: true })).project.map((x) => x.repo))], ["r0"]);
  p.setRepos(null);
  r = await p.poll({ force: true });
  assert.equal(new Set(r.project.map((x) => x.repo)).size, 6, "null = all repos again");
});

test("three chosen repos of a project count as few: scan every 60 s", async () => {
  const { f, calls } = bigProject(); const c = clock();
  const p = createPoller({ fetch: f, workspace: "acme", project: "WEB", repos: ["r0", "r1", "r2"], now: c.now });
  await p.poll(); const n = repoCalls(calls).length;
  c.t += 61_000; await p.poll();
  assert.ok(repoCalls(calls).length > n, "rescans after 61 s because few repos are chosen");
});

test("setRepos during an in-flight scan is not undone by it", async () => {
  const { f } = bigProject(); const c = clock();
  let release; const gate = new Promise((r) => { release = r; });
  let hold = false;
  const slow = async (path) => { if (hold && /\/repositories\/acme\/r0\/pullrequests\?/.test(path)) await gate; return f(path); };
  const p = createPoller({ fetch: slow, workspace: "acme", project: "WEB", repos: ["r0", "r1"], now: c.now });
  await p.poll();
  hold = true; c.t += 61_000;
  const running = p.poll({ force: true });
  await new Promise((r) => setImmediate(r));
  p.setRepos(["r1", "r3"]); // r0 dropped, r3 added while the scan of r0 is pending
  release();
  const mid = await running;
  assert.ok(!mid.project.some((x) => x.repo === "r0"), "dropped repo's rows do not come back");
  hold = false;
  const after = await p.poll(); // not forced: still scans the added repo at once
  assert.ok(after.project.some((x) => x.repo === "r3"), "added repo scanned on the next poll");
  assert.ok(!after.project.some((x) => x.repo === "r0"));
});
