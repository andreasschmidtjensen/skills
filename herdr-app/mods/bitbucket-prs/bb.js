// Pure logic for the bitbucket-prs mod. No imports from "herdr": node --test runs this file.
//
// Data comes from bb-fetch.sh (see interpretFetch). Everything here takes an injected
// `fetch(pathAndQuery) -> Promise<body | {error:{...}}>` and a clock, so it is testable.
//
// REQUEST BUDGET (Bitbucket Cloud allows 1000 requests/hour per token; we target well under 600):
//   Mine       every 60 s  -> 60 list calls/h (+1 statuses call per PR whose updated_on changed)
//   Project    every 5 min -> 12 scans/h; one scan = 1 call per "active" repo (had open PRs last
//                             time) + 1 call per idle repo every 30 min; repo list 1 call/h.
//                             e.g. 25 repos, 5 active: 12 * (5 + 20/6) ~ 100 calls/h.
//                             Build state: 1 statuses call per PR whose updated_on changed, but per scan
//                             only for `reviewing` rows plus <= PROJECT_BUILD_LOOKUPS_PER_SCAN (10) other
//                             unknown rows (oldest first); the rest stay "none" until a later scan.
//                             Worst case per scan: repo calls (<= 25) + reviewing + 10 statuses calls.
//   Hard cap: HOURLY_CAP (500) requests in any sliding hour; beyond it work is skipped (never errors,
//   state stays ok with a notice, last data kept). Project stops at cap - MINE_RESERVE so Mine keeps
//   refreshing. A scan makes <= MAX_REPO_CALLS_PER_SCAN repo calls (never-checked / oldest first), which
//   spreads big workspaces over several scans (25 * 12 = 300/h worst case).
// Requests are strictly sequential.
// With config `project=KEY` both tabs are limited to that Bitbucket project's repos (found with
//   GET /repositories/{ws}?q=project.key="KEY", cached 1h). Few repos -> Project can run every 60 s
//   (<= PROJECT_FAST_MAX_REPOS repos: <= 5 calls/min worst case = 300/h + Mine 60/h + builds, under the cap);
//   more repos fall back to the 5 min cadence.

export const API = "https://api.bitbucket.org/2.0";
export const MINE_EVERY_MS = 60_000;
export const REVIEW_EVERY_MS = 300_000;
export const REPO_LIST_TTL_MS = 3_600_000;
export const IDLE_REPO_EVERY_MS = 1_800_000;
export const MAX_BACKOFF_MS = 600_000;
export const HOURLY_CAP = 500;
export const PROJECT_FAST_MAX_REPOS = 5;
export const MINE_RESERVE = 100; // of the cap, never spent by Project / its build lookups
export const PROJECT_BUILD_LOOKUPS_PER_SCAN = 10; // non-reviewing Project rows whose build is looked up per scan
export const MAX_REPO_CALLS_PER_SCAN = 25; // one scan never spends the hour; leftovers wait for the next scan
export const BUDGET_NOTICE = "Request budget reached; showing the last data.";
export const SCOPE_HINT = "The API token needs these scopes: read:pullrequest:bitbucket, read:repository:bitbucket and read:user:bitbucket. Create a new token with all three, then run setup.sh token.";

// ---- URL builders -------------------------------------------------------------------------

const PR_FIELDS = [
  "id", "title", "state", "draft", "created_on", "updated_on", "comment_count",
  "author.uuid", "author.display_name", "source.branch.name", "destination.branch.name", "destination.repository.full_name", "links.html.href",
  "reviewers.uuid", "participants.role", "participants.approved", "participants.user.uuid",
].map((f) => `values.${f}`).concat("next").join(",");

const enc = encodeURIComponent;
export const fieldsParam = (fields) => `fields=${enc(fields)}`.replace(/%2C/g, ",").replace(/%2E/g, ".");
export const urlUser = () => `/user?${fieldsParam("uuid,display_name")}`;
export const urlMine = (uuid) => `/pullrequests/${enc(uuid)}?state=OPEN&pagelen=50&${fieldsParam(PR_FIELDS)}`;
export const urlRepos = (ws, project) =>
  `/repositories/${enc(ws)}?pagelen=100${project ? `&q=${enc(`project.key="${project}"`)}` : ""}&${fieldsParam("values.slug,values.updated_on,next")}`;
export const urlRepoPrs = (ws, repo) => `/repositories/${enc(ws)}/${enc(repo)}/pullrequests?state=OPEN&pagelen=50&${fieldsParam(PR_FIELDS)}`;
export const urlStatuses = (ws, repo, id) => `/repositories/${enc(ws)}/${enc(repo)}/pullrequests/${id}/statuses?pagelen=50&${fieldsParam("values.state,next")}`;

/** Turn a `next` link (absolute URL) back into a path for bb-fetch.sh. */
export const toPath = (url) => (url.startsWith(API) ? url.slice(API.length) : url);

// ---- small helpers ------------------------------------------------------------------------

export const sameUuid = (a, b) => !!a && !!b && String(a).replace(/[{}]/g, "").toLowerCase() === String(b).replace(/[{}]/g, "").toLowerCase();

export function formatAge(ms) {
  const m = Math.max(0, Math.floor(ms / 60_000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 14 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

/** Commit statuses (values[].state: SUCCESSFUL | FAILED | STOPPED | INPROGRESS) -> build state. */
export function buildState(statuses) {
  const s = (statuses || []).map((x) => x && x.state);
  if (!s.length) return "none";
  if (s.some((x) => x === "FAILED" || x === "STOPPED")) return "failed";
  if (s.some((x) => x === "INPROGRESS")) return "running";
  return s.every((x) => x === "SUCCESSFUL") ? "ok" : "none";
}

/** Bitbucket PR JSON -> panel row. `build` is filled in separately. */
export function normalisePr(pr, now, build = "none") {
  const full = (pr.destination && pr.destination.repository && pr.destination.repository.full_name) || "";
  const ps = pr.participants || [];
  return {
    id: pr.id,
    title: pr.title || "",
    repo: full.split("/").pop(),
    fullName: full,
    branch: (pr.source && pr.source.branch && pr.source.branch.name) || "",
    dest: (pr.destination && pr.destination.branch && pr.destination.branch.name) || "",
    author: (pr.author && pr.author.display_name) || "",
    draft: Boolean(pr.draft),
    url: (pr.links && pr.links.html && pr.links.html.href) || "",
    approvals: ps.filter((p) => p.approved).length,
    comments: pr.comment_count || 0,
    ageMs: Math.max(0, now - Date.parse(pr.created_on)),
    build,
    updatedOn: pr.updated_on || "",
    reviewing: false,
  };
}

/** Marker for the Project tab: someone else's open PR where I am a reviewer and have not approved. */
export function isToReview(pr, meUuid) {
  if (pr.state && pr.state !== "OPEN") return false;
  if (pr.author && sameUuid(pr.author.uuid, meUuid)) return false;
  const asReviewer = (pr.reviewers || []).some((r) => sameUuid(r.uuid, meUuid));
  const mine = (pr.participants || []).find((p) => p.user && sameUuid(p.user.uuid, meUuid));
  if (!asReviewer && !(mine && mine.role === "REVIEWER")) return false;
  return !(mine && mine.approved);
}

/** Interpret bb-fetch.sh output: (stdout, exit code) -> body | {error}. */
export function interpretFetch(stdout, code) {
  let body;
  try { body = JSON.parse(stdout); } catch { body = null; }
  if (code === 0 && body) return body;
  if (body && body.error) return body;
  return { error: { kind: code === 0 ? "parse" : "network", status: 0 } };
}

// ---- default "project" strategy ---------------------------------------------------------
// Bitbucket Cloud has no workspace-wide "PRs where I am a reviewer" endpoint (BCLOUD-21950), so we
// scan repos (the Project tab lists every open PR of the scanned repos; `reviewing` marks mine). A strategy is `async (ctx) => {prs: rawPr[]} | {error}`; swap it via createPoller.
// ctx: {call(path), listRepos() -> {repos:[{slug,updatedOn}]}|{error}, ws, me, now()}. Replaceable once a real token shows a better endpoint.
export function repoScanStrategy() {
  const info = new Map(); // slug -> {checkedAt, updatedOn, prs}
  return async (ctx) => {
    const t = ctx.now();
    const l = await ctx.listRepos(); // cached 1h by the poller; honours project=
    if (l.error) return l.error.kind === "budget" ? { prs: collect(), partial: true } : { error: l.error };
    const repos = l.repos;
    const keep = new Set(repos.map((x) => x.slug));
    for (const k of [...info.keys()]) if (!keep.has(k)) info.delete(k);
    const due = repos
      .filter((repo) => {
        const i = info.get(repo.slug);
        return !i || i.prs.length > 0 || i.updatedOn !== repo.updatedOn || t - i.checkedAt >= IDLE_REPO_EVERY_MS;
      })
      .sort((x, y) => (info.get(x.slug)?.checkedAt ?? -Infinity) - (info.get(y.slug)?.checkedAt ?? -Infinity))
      .slice(0, MAX_REPO_CALLS_PER_SCAN);
    let partial = false;
    for (const repo of due) {
      const r = await ctx.call(urlRepoPrs(ctx.ws, repo.slug));
      if (r.error) {
        if (r.error.kind === "budget") { partial = true; break; } // keep last known data for the rest
        // One repo that was deleted/renamed or lost PR read access is "no PRs", not a panel error.
        if (r.error.status === 403 || r.error.status === 404) { info.set(repo.slug, { checkedAt: t, updatedOn: repo.updatedOn, prs: [] }); continue; }
        return { error: r.error };
      }
      info.set(repo.slug, { checkedAt: t, updatedOn: repo.updatedOn, prs: r.values || [] });
    }
    return { prs: collect(), partial };
  };
  function collect() {
    return [...info.values()].flatMap((i) => i.prs);
  }
}

// ---- poller -------------------------------------------------------------------------------

/**
 * createPoller({fetch, workspace, now, projectStrategy, hourlyCap})
 * poll({force}) runs whatever is due and returns {mine, project, state}.
 * state = {status: ok|setup|auth|throttled|error, nextAt, message}. Call poll() as often as you like
 * (e.g. every 60 s while visible); it only hits the API when something is due.
 */
export function createPoller({ fetch, workspace, project = "", now = Date.now, projectStrategy = repoScanStrategy(), hourlyCap = HOURLY_CAP }) {
  const wsLower = workspace.toLowerCase();
  let me = null;
  let mineAt = -Infinity;
  let reviewAt = -Infinity;
  let repoCache = null; // {repos, at}
  let backoffMs = 0;
  const log = [];
  const builds = new Map(); // "full#id" -> {updatedOn, build}
  const out = { mine: [], project: [], state: { status: "ok", nextAt: 0, message: "" } };
  const snap = () => ({ mine: out.mine, project: out.project, state: { ...out.state } });

  async function call(path, reserve = 0) {
    const t = now();
    while (log.length && t - log[0] >= 3_600_000) log.shift();
    if (log.length >= hourlyCap - reserve) return { error: { kind: "budget", status: 0 } };
    log.push(t);
    try {
      const r = await fetch(path);
      return r && typeof r === "object" ? r : { error: { kind: "parse", status: 0 } };
    } catch {
      return { error: { kind: "network", status: 0 } };
    }
  }

  /** Workspace (or project) repo list, cached 1h and shared by both tabs. */
  async function listRepos() {
    const t = now();
    if (repoCache && t - repoCache.at < REPO_LIST_TTL_MS) return { repos: repoCache.repos };
    const l = await listPages(urlRepos(workspace, project), 5);
    if (l.error) return repoCache && l.error.kind === "budget" ? { repos: repoCache.repos } : { error: l.error };
    repoCache = { repos: l.values.map((v) => ({ slug: v.slug, updatedOn: v.updated_on || "" })), at: t };
    return { repos: repoCache.repos };
  }
  const reviewEvery = () => (project && repoCache && repoCache.repos.length > PROJECT_FAST_MAX_REPOS ? REVIEW_EVERY_MS : project ? MINE_EVERY_MS : REVIEW_EVERY_MS);

  function fail(err, t) {
    const status = err.status || 0;
    if (err.kind === "config" || err.kind === "token") {
      const what = (err.missing || [err.kind]).join(", ");
      out.state = { status: "setup", nextAt: t + MINE_EVERY_MS, message: `Setup needed: missing ${what}. Run the installer / setup.sh.` };
    } else if (status === 400 || status === 401 || status === 403) {
      out.state = { status: "auth", nextAt: t + MINE_EVERY_MS, message: `Bitbucket rejected the credentials (HTTP ${status}). ${SCOPE_HINT}` };
    } else if (status === 429) {
      backoffMs = Math.min((backoffMs || MINE_EVERY_MS) * 2, MAX_BACKOFF_MS);
      const wait = err.retryAfter != null ? err.retryAfter * 1000 : backoffMs;
      out.state = { status: "throttled", nextAt: t + wait, message: `Rate limited by Bitbucket; retrying in ${Math.ceil(wait / 1000)}s.` };
    } else {
      backoffMs = Math.min((backoffMs || MINE_EVERY_MS) * 2, MAX_BACKOFF_MS);
      out.state = { status: "error", nextAt: t + backoffMs, message: `Bitbucket request failed (${err.kind || "error"}${status ? ` ${status}` : ""}); retrying in ${Math.ceil(backoffMs / 1000)}s.` };
    }
  }

  async function listPages(path, maxPages) {
    const values = [];
    for (let page = 0; path && page < maxPages; page++) {
      const r = await call(path);
      if (r.error) return r;
      values.push(...(r.values || []));
      path = r.next ? toPath(r.next) : null;
    }
    return { values };
  }

  /** Rows with build state; statuses are fetched only when (id, updated_on) is new. */
  async function toRows(prs, t, reserve = 0, lookup = null) {
    const rows = [];
    for (const pr of prs) {
      const row = normalisePr(pr, t);
      const key = `${row.fullName}#${row.id}`;
      const hit = builds.get(key);
      if (hit && hit.updatedOn === row.updatedOn) row.build = hit.build;
      else if (lookup && !lookup.has(key)) row.build = hit ? hit.build : "none"; // not this scan
      else {
        const [ws, repo] = row.fullName.split("/");
        const r = await call(urlStatuses(ws, repo, row.id), reserve);
        if (r.error) {
          if (r.error.kind !== "budget") return { error: r.error };
          row.build = hit ? hit.build : "none"; // out of budget: show stale, retry next time
        } else {
          row.build = buildState(r.values);
          builds.set(key, { updatedOn: row.updatedOn, build: row.build });
        }
      }
      rows.push(row);
    }
    return { rows };
  }

  const isBudget = (e) => e && e.kind === "budget";

  async function poll({ force = false } = {}) {
    const t = now();
    if (out.state.status === "throttled" && t < out.state.nextAt) return snap();
    if (!force && t < out.state.nextAt && out.state.status !== "ok") return snap();
    const mineDue = force || t - mineAt >= MINE_EVERY_MS;
    const reviewDue = force || t - reviewAt >= reviewEvery();
    if (!mineDue && !reviewDue) return snap();

    let notice = "";
    const skip = () => ((out.state = { status: "ok", nextAt: t + MINE_EVERY_MS, message: BUDGET_NOTICE }), snap());
    if (!me) {
      const u = await call(urlUser());
      if (isBudget(u.error)) return skip();
      if (u.error) return fail(u.error, t), snap();
      if (!u.uuid) return fail({ kind: "parse", status: 0 }, t), snap();
      me = u.uuid;
    }
    if (mineDue) {
      const l = await listPages(urlMine(me), 2);
      if (isBudget(l.error)) return skip();
      if (l.error) return fail(l.error, t), snap();
      let allowed = null;
      if (project) {
        const rl = await listRepos();
        if (isBudget(rl.error)) return skip();
        if (rl.error) return fail(rl.error, t), snap();
        allowed = new Set(rl.repos.map((x) => `${wsLower}/${x.slug}`.toLowerCase()));
      }
      const prs = l.values.filter((p) => {
        const full = (p.destination?.repository?.full_name || "").toLowerCase();
        return allowed ? allowed.has(full) : full.startsWith(`${wsLower}/`);
      });
      const r = await toRows(prs, t);
      if (r.error) return fail(r.error, t), snap();
      out.mine = r.rows;
      mineAt = t;
    }
    if (reviewDue) {
      const rcall = (path) => call(path, MINE_RESERVE);
      const s = await projectStrategy({ call: rcall, listRepos, ws: workspace, me, now });
      if (isBudget(s.error)) { reviewAt = t; notice = BUDGET_NOTICE; }
      else if (s.error) return fail(s.error, t), snap();
      else {
        if (s.partial) notice = BUDGET_NOTICE;
        const open = s.prs.filter((p) => !p.state || p.state === "OPEN")
          .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on));
        const keyOf = (p) => `${p.destination?.repository?.full_name}#${p.id}`;
        const byKey = new Map(open.map((p) => [keyOf(p), p]));
        const stale = (p) => builds.get(keyOf(p))?.updatedOn !== (p.updated_on || "");
        const lookup = new Set(open.filter((p) => stale(p) && isToReview(p, me)).map(keyOf));
        for (const p of open.filter((p) => stale(p) && !lookup.has(keyOf(p))).reverse().slice(0, PROJECT_BUILD_LOOKUPS_PER_SCAN)) lookup.add(keyOf(p));
        const r = await toRows(open, t, MINE_RESERVE, lookup);
        if (r.error) return fail(r.error, t), snap();
        for (const row of r.rows) row.reviewing = isToReview(byKey.get(`${row.fullName}#${row.id}`), me);
        out.project = r.rows;
        reviewAt = t;
      }
    }
    backoffMs = 0;
    out.state = { status: "ok", nextAt: t + MINE_EVERY_MS, message: notice };
    return snap();
  }

  return { poll, requestsLastHour: () => log.filter((x) => now() - x < 3_600_000).length };
}
