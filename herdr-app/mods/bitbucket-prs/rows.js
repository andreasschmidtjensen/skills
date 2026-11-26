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
