// Pull requests: the right panel listing open Bitbucket Cloud PRs, three tabs:
// "Mine" (I wrote them), "To review" (open PRs where I'm a reviewer and have not approved) and
// "Project" (all open PRs of the project's repos, newest first; those to review carry a "review"
// marker; drafts a "Draft" tag). The Repos button swaps the list for a checklist of the project's
// repos; the choice is saved as `repos=a,b` in the config (no line = all) and limits Project / To review.
// Data and rate-limit logic are in bb.js (createPoller); requests go through bb-fetch.sh,
// which holds the credentials (the panel never sees a token or email).
// The poll loop runs only while the window is visible (window()?.visible); every 15 s it
// calls poll(), which decides what is actually due. The refresh button forces one.
// Click a row to open the PR in the browser.
//
// Developer-only: a config line `fixture=<absolute path to a JSON file>` makes the panel read
// {mine:[...],project:[...],state:{...},repos:[slug,...]} from that file instead of polling (for `herdr-app check`
// and screenshots). setup.sh never writes it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec, appHome, home, window, readTextFile } from "herdr";
import { createPoller, interpretFetch } from "./bb.js";
import { fixtureFrom, reposFrom, withRepos, WRITE_CONFIG_SH, READ_CONFIG_SH, canSaveConfig, isChosen, chosenCount, toggleRepo, sameChoice, TABS, tabRows, emptyText, rowMeta, branchText, updatedText, buildColour, approvalsText, commentsText, stateView, openCommand } from "./rows.js";

const TICK_MS = 15_000;
const SCRIPT = () => `${appHome()}/mods/bitbucket-prs/bb-fetch.sh`;
const CONFIG_SH = 'cat "${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs/config" 2>/dev/null; true';

export default class PullRequests extends View {
  init(_props, cx) {
    this.tab = "mine";
    this.view = "list"; // "list" | "repos" (the chooser)
    this.chosen = null; // slugs Project / To review scan; null = all
    this.repoAll = []; // the project's repo slugs, for the chooser
    this.repoMsg = "";
    this.repoStart = null; // the choice when the chooser opened
    this.saving = Promise.resolve();
    this.data = { mine: [], project: [], state: { status: "ok", message: "" } };
    this.polledAt = 0;
    this.configured = true;
    this.poller = null;
    this.fixture = "";
    this.fixtureRepos = [];
    this.busy = false;
    this.pending = false;
    this.loop = false;
    this.ready = false; // setup finished: the loop waits for it
    cx.spawn(async (cx) => { await this.setup(cx); this.ensureLoop(cx); });
    // "updated 12s ago" and ages move on while visible; also restarts the loop when it was hidden.
    cx.timer.every(1000, (cx) => { if (window()?.visible !== false) { this.ensureLoop(cx); cx.notify(); } });
  }

  async setup(cx) {
    const cfg = (await exec("sh", ["-c", CONFIG_SH]).catch(() => null))?.stdout ?? "";
    this.fixture = fixtureFrom(cfg);
    this.chosen = reposFrom(cfg);
    if (!this.fixture) {
      const r = await exec("sh", [SCRIPT(), "--config-status"]).catch(() => null);
      let st = null;
      try { st = JSON.parse(r?.stdout ?? ""); } catch { st = null; }
      this.configured = Boolean(st?.configured);
      if (this.configured) {
        const fetch = async (path) => { const r = await exec("sh", [SCRIPT(), path]).catch(() => null); return interpretFetch(r?.stdout ?? "", r?.code ?? 5); };
        this.poller = createPoller({ fetch, workspace: st.workspace, project: st.project || "", repos: this.chosen });
      }
    }
    this.ready = true;
    cx.notify();
  }

  // Polls while the window is visible; the loop ends when it is hidden (ensureLoop restarts it).
  ensureLoop(cx) {
    if (!this.ready || this.loop || window()?.visible === false) return;
    this.loop = true;
    cx.spawn(async (cx) => {
      try {
        while (window()?.visible !== false) {
          await this.refresh(false, cx);
          await cx.sleep(TICK_MS);
        }
      } finally { this.loop = false; }
    });
  }

  async refresh(force, cx) {
    if (this.busy) { if (force) this.pending = true; return; } // run it once the poll in flight is done
    this.busy = true;
    cx.notify();
    try {
      if (force && !this.poller && !this.fixture) await this.setup(cx); // not set up yet: look at the config again
      if (this.fixture) {
        const txt = await readTextFile(this.fixture).catch(() => null);
        let d = null;
        try { d = JSON.parse(txt ?? ""); } catch { d = null; }
        this.fixtureRepos = d?.repos ?? [];
        this.data = d ? { mine: d.mine ?? [], project: (d.project ?? []).filter((r) => isChosen(this.chosen, r.repo)), state: d.state ?? { status: "ok", message: "" } }
          : { mine: [], project: [], state: { status: "error", message: "Fixture file unreadable." } };
        this.polledAt = Date.now();
      } else if (this.poller) {
        this.data = await this.poller.poll({ force });
        this.polledAt = Date.now();
      }
    } catch {
      this.data = { ...this.data, state: { status: "error", message: "Could not reach Bitbucket." } };
    } finally {
      this.busy = false; cx.notify();
      if (this.pending) { this.pending = false; await this.refresh(true, cx); }
    }
  }

  // The chooser: opening it loads the repo list (cached by the poller); closing it applies a changed choice.
  async toggleRepos(cx) {
    if (this.view === "repos") {
      this.view = "list";
      const changed = !sameChoice(this.repoStart, this.chosen);
      cx.notify();
      if (changed && this.poller) await this.refresh(true, cx);
      return;
    }
    this.view = "repos";
    this.repoStart = this.chosen;
    this.repoMsg = "";
    cx.notify();
    if (this.fixture) this.repoAll = [...(this.fixtureRepos ?? [])];
    else if (this.poller) {
      const r = await this.poller.repoList().catch(() => ({ error: {} }));
      if (r.error) this.repoMsg = "Could not load the repository list.";
      else this.repoAll = r.repos;
    } else this.repoMsg = "Bitbucket is not set up.";
    cx.notify();
  }

  // Applies and saves a new choice (null = all). Rows of dropped repos go at once.
  choose(next, cx) {
    this.chosen = next;
    if (this.poller) this.poller.setRepos(next);
    this.data = { ...this.data, project: this.data.project.filter((r) => isChosen(next, r.repo)) };
    if (!this.fixture && this.poller) {
      this.saving = this.saving.then(async () => {
        const r = await exec("sh", ["-c", READ_CONFIG_SH]).catch(() => null);
        if (!r || r.code !== 0 || !canSaveConfig(r.stdout)) return; // unreadable config: never write one with only repos=
        const cfg = r.stdout;
        await exec("sh", ["-c", WRITE_CONFIG_SH, "sh", withRepos(cfg, next)]).catch(() => null);
      });
    }
    cx.notify();
  }

  tag(label, colour, t) {
    return div().flex_none().px(4).rounded(3).border_1().border_color(colour).text_size(10).line_height("14px").text_color(colour).child(label);
  }

  open(url) {
    const c = openCommand(url, window()?.platform);
    if (c) exec(c[0], c[1]).catch(() => null);
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const rows = tabRows(this.data, this.tab);
    const sv = stateView(this.data.state, this.configured);
    const tone = { muted: t.muted, accent: t.accent, error: t.ansi1 };
    const count = (k) => tabRows(this.data, k).length;

    const tab = (key, label) => {
      const on = this.tab === key;
      return h_flex().id(`tab-${key}`).h(20).px(7).gap(4).flex_none().items_center().rounded(5).cursor_pointer().text_size(11.5)
        .text_color(on ? t.foreground : t.muted).when(on, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => { this.tab = key; cx.notify(); })
        .child(div().child(label))
        .child(div().text_color(t.dim).child(String(count(key))));
    };

    const row = (r) => {
      const bc = buildColour(r.build);
      const ap = approvalsText(r.approvals), cm = commentsText(r.comments);
      return h_flex().id(`pr-${this.tab}-${r.repo}-${r.id}`).min_h(34).px(8).py(3).gap(8).items_center().rounded(8).cursor_pointer()
        .hover((s) => s.bg(t.hover)).tooltip(r.title)
        .on_click((_e, cx) => this.open(r.url))
        .child(v_flex().flex_1().min_w(0)
          .child(h_flex().gap(5).items_center().min_w(0)
            .child(div().flex_1().min_w(0).truncate().text_size(13).line_height("18px").text_color(t.foreground).child(r.title))
            .when(Boolean(r.draft), (el) => el.child(this.tag("Draft", t.muted, t)))
            .when(Boolean(r.reviewing), (el) => el.child(this.tag("review", t.accent, t))))
          .child(div().truncate().text_size(11).line_height("14px").text_color(t.dim).child(rowMeta(r, now, this.polledAt)))
          .when(Boolean(branchText(r)), (el) => el.child(div().truncate().text_size(11).line_height("14px").text_color(t.dim).child(branchText(r)))))
        .when(Boolean(cm), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(cm)))
        .when(Boolean(ap), (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(ap)))
        .when(Boolean(bc), (el) => el.child(div().size(7).flex_none().rounded(4).bg(t[bc])));
    };

    const all = this.repoAll;
    const btn = (id, label, onClick) => div().id(id).h(22).px(8).flex_none().flex().items_center().rounded(5).cursor_pointer().text_size(11.5)
      .text_color(t.muted).border_1().border_color(t.border).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(label);
    const repoRow = (slug) => {
      const on = isChosen(this.chosen, slug);
      return h_flex().id(`repo-${slug}`).h(26).px(8).gap(8).items_center().flex_none().rounded(6).cursor_pointer()
        .hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.choose(toggleRepo(this.chosen, all, slug), cx))
        .child(div().size(14).flex_none().flex().items_center().justify_center().rounded(3).border_1().border_color(on ? t.accent : t.border).text_size(10).text_color(t.accent).child(on ? "✓" : ""))
        .child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.foreground).child(slug));
    };
    const chooser = v_flex().flex_1().min_h(0)
      .child(h_flex().flex_none().px(14).pt(8).pb(6).gap(6).items_center()
        .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.muted).child(this.repoMsg || `${chosenCount(this.chosen, all)} of ${all.length} repos`))
        .child(btn("repos-all", "All", (_e, cx) => this.choose(null, cx)))
        .child(btn("repos-none", "None", (_e, cx) => this.choose([], cx)))
        .child(btn("repos-done", "Done", (_e, cx) => { cx.spawn(async (cx) => this.toggleRepos(cx)); })))
      .child(v_flex().id("repo-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8).children(all.map(repoRow)));

    const body = this.view === "repos" ? chooser : sv?.block
      ? v_flex().flex_1().min_h(0).px(14).py(12).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child(sv.title))
        .child(div().text_size(12).line_height("17px").text_color(t.muted).child(sv.text))
      : v_flex().id("pr-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .children(rows.map(row))
        .when(!rows.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child(emptyText(this.tab))));

    return v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(count("mine") + count("project"))))
        .child(div().flex_1())
        .child(div().id("pr-repos").size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Choose repositories")
          .on_click((_e, cx) => { cx.spawn(async (cx) => this.toggleRepos(cx)); })
          .child(svg("mods/bitbucket-prs/repos.svg").size(13).text_color(this.view === "repos" ? t.accent : t.muted)))
        .child(div().id("pr-refresh").size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => { cx.spawn(async (cx) => this.refresh(true, cx)); })
          .child(svg("mods/bitbucket-prs/refresh.svg").size(13).text_color(this.busy ? t.accent : t.muted))))
      .child(h_flex().flex_wrap().min_h(30).gap(2).px(8).pt(5).items_center()
        .children(TABS.map(([k, l]) => tab(k, l))))
      .child(body)
      .child(h_flex().h(24).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border).text_size(11)
        .child(div().flex_none().text_color(t.dim).child(updatedText(this.polledAt, now)))
        .when(Boolean(sv && !sv.block), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(tone[sv.tone] ?? t.muted).child(sv.text))));
  }
}
