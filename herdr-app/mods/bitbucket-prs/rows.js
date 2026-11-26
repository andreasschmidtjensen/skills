// Pure helpers for the bitbucket-prs panel (no "herdr" import: node --test runs this file).
import { formatAge } from "./bb.js";

/** Value of `fixture=` in the config text, or "" (developer-only hook, see main.js). */
export function fixtureFrom(configText) {
  const m = /^fixture=(.*)$/m.exec(configText || "");
  return m ? m[1].trim().replace(/\r$/, "") : "";
}

/** "author · #id · repo · age" (parts left out when empty); age counts on from the poll that made the row (polledAt, ms). */
export function rowMeta(row, now, polledAt) {
  const age = (row.ageMs || 0) + Math.max(0, now - (polledAt || now));
  return [row.author, row.id != null ? `#${row.id}` : "", row.repo, formatAge(age)].filter(Boolean).join(" · ");
}

/** "source → destination" (just the source when there is no destination). */
export function branchText(row) {
  return [row.branch, row.dest].filter(Boolean).join(" → ");
}

export const EMPTY_TEXT = "No open pull requests in the project";

/** "updated 12s ago" / "updated 3m ago" / "not updated yet". */
export function updatedText(at, now) {
  if (!at) return "not updated yet";
  const s = Math.max(0, Math.floor((now - at) / 1000));
  return s < 60 ? `updated ${s}s ago` : `updated ${Math.floor(s / 60)}m ago`;
}

/** Colour name for the build dot, or null (hidden). */
export function buildColour(build) {
  return { ok: "ansi2", failed: "ansi1", running: "ansi3" }[build] ?? null;
}

export const approvalsText = (n) => (n > 0 ? `✓${n}` : "");
export const commentsText = (n) => (n > 0 ? `#${n}` : "");

/** What a non-ok state shows. block: replaces the list. tone: muted | accent | error. */
export function stateView(state, configured = true) {
  if (!configured || state?.status === "setup")
    return { block: true, title: "Bitbucket is not set up", text: "Run herdr-app/install-bitbucket.sh and `setup.sh token`, then press refresh." };
  if (state?.status === "auth")
    return { block: true, title: "Bitbucket sign-in failed", text: state.message || "Check the email and API token: run `setup.sh token` again." };
  if (state?.status === "throttled") return { block: false, tone: "accent", text: state.message || "Rate limited; waiting." };
  if (state?.status === "error") return { block: false, tone: "error", text: state.message || "Could not reach Bitbucket." };
  if (state?.message) return { block: false, tone: "muted", text: state.message };
  return null;
}

/** Command that opens a URL in the browser; only http(s) URLs. */
export function openCommand(url, platform) {
  if (!/^https?:\/\//.test(url || "")) return null;
  return [platform === "macos" ? "open" : platform === "windows" ? "explorer" : "xdg-open", [url]];
}

// ---- tabs -------------------------------------------------------------------------------

export const TABS = [["mine", "Mine"], ["review", "To review"], ["project", "Project"]];
export const REVIEW_EMPTY_TEXT = "Nothing waiting for your review";

/** Rows of a tab: To review is the Project rows with `reviewing` (same data, no extra requests). */
export function tabRows(data, tab) {
  if (tab === "mine") return data?.mine ?? [];
  const project = data?.project ?? [];
  return tab === "review" ? project.filter((r) => r.reviewing) : project;
}

export function emptyText(tab) {
  return tab === "project" ? EMPTY_TEXT : tab === "review" ? REVIEW_EMPTY_TEXT : "No open pull requests";
}

// ---- repo chooser -----------------------------------------------------------------------

/** Slugs from the `repos=` config line (comma separated), or null when there is no such line (= all repos). */
export function reposFrom(configText) {
  const m = /^repos=(.*)$/m.exec(configText || "");
  return m ? m[1].replace(/\r$/, "").split(",").map((s) => s.trim()).filter(Boolean) : null;
}

/** Config text with the `repos=` line set to `slugs` (null = no line = all repos); every other line is kept as it is. */
export function withRepos(configText, slugs) {
  const lines = (configText || "").split("\n").filter((l) => !/^repos=/.test(l));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (slugs) lines.push(`repos=${slugs.join(",")}`);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

/** Reads the config file and fails (non-zero) when it cannot be read. */
export const READ_CONFIG_SH = 'cat "${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs/config"';

/** A config we may rewrite: it was read and has a workspace (never save a config that is only repos=). */
export const canSaveConfig = (text) => /^workspace=\S/m.test(text || "");

/** sh script: `sh -c WRITE_CONFIG_SH sh <new text>` replaces the config file atomically, mode 600. */
export const WRITE_CONFIG_SH = 'd="${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs"; mkdir -p "$d" && umask 077 && t=$(mktemp "$d/.config.XXXXXX") && printf %s "$1" > "$t" && chmod 600 "$t" && mv "$t" "$d/config" || { rm -f "$t"; exit 1; }';

export const isChosen = (chosen, slug) => !chosen || chosen.includes(slug);

/** Number of listed repos that are chosen ("n of N repos"); unknown slugs in `chosen` do not count. */
export const chosenCount = (chosen, all) => (chosen ? all.filter((s) => chosen.includes(s)).length : all.length);

/** New choice after ticking/unticking `slug`; null (= all) when every repo ends up chosen. */
export function toggleRepo(chosen, all, slug) {
  const on = new Set(chosen ?? all);
  if (on.has(slug)) on.delete(slug); else on.add(slug);
  const next = all.filter((s) => on.has(s));
  return next.length === all.length ? null : next;
}

/** True when two choices (list or null = all) pick the same repos. */
export function sameChoice(a, b) {
  if (!a || !b) return !a && !b;
  return a.length === b.length && a.every((s) => b.includes(s));
}
