// Pull requests: the right panel listing open Bitbucket Cloud PRs, two tabs:
// "Mine" (I wrote them) and "To review" (I'm a reviewer, not yet approved).
// Data and rate-limit logic are in bb.js (createPoller); requests go through bb-fetch.sh,
// which holds the credentials (the panel never sees a token or email).
// The poll loop runs only while the window is visible (window()?.visible); every 15 s it
// calls poll(), which decides what is actually due. The refresh button forces one.
// Click a row to open the PR in the browser.
//
// Developer-only: a config line `fixture=<absolute path to a JSON file>` makes the panel read
// {mine:[...],review:[...],state:{...}} from that file instead of polling (for `herdr-app check`
// and screenshots). setup.sh never writes it.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, exec, appHome, home, window, readTextFile } from "herdr";
import { createPoller, interpretFetch } from "./bb.js";
import { fixtureFrom, rowMeta, updatedText, buildColour, approvalsText, commentsText, stateView, openCommand } from "./rows.js";

const TICK_MS = 15_000;
const SCRIPT = () => `${appHome()}/mods/bitbucket-prs/bb-fetch.sh`;
const CONFIG_SH = 'cat "${XDG_CONFIG_HOME:-$HOME/.config}/bitbucket-prs/config" 2>/dev/null; true';

export default class PullRequests extends View {
  init(_props, cx) {
    this.tab = "mine";
    this.data = { mine: [], review: [], state: { status: "ok", message: "" } };
    this.polledAt = 0;
    this.configured = true;
    this.poller = null;
    this.fixture = "";
    this.busy = false;
    this.loop = false;
    this.ready = false; // setup finished: the loop waits for it
    cx.spawn(async (cx) => { await this.setup(cx); this.ensureLoop(cx); });
    // "updated 12s ago" and ages move on while visible; also restarts the loop when it was hidden.
    cx.timer.every(1000, (cx) => { if (window()?.visible !== false) { this.ensureLoop(cx); cx.notify(); } });
  }

  async setup(cx) {
    const cfg = (await exec("sh", ["-c", CONFIG_SH]).catch(() => null))?.stdout ?? "";
    this.fixture = fixtureFrom(cfg);
    if (!this.fixture) {
      const r = await exec("sh", [SCRIPT(), "--config-status"]).catch(() => null);
      let st = null;
      try { st = JSON.parse(r?.stdout ?? ""); } catch { st = null; }
      this.configured = Boolean(st?.configured);
      if (this.configured) {
        const fetch = async (path) => { const r = await exec("sh", [SCRIPT(), path]).catch(() => null); return interpretFetch(r?.stdout ?? "", r?.code ?? 5); };
        this.poller = createPoller({ fetch, workspace: st.workspace, project: st.project || "" });
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
    if (this.busy) return;
    this.busy = true;
    cx.notify();
    try {
      if (force && !this.poller && !this.fixture) await this.setup(cx); // not set up yet: look at the config again
      if (this.fixture) {
        const txt = await readTextFile(this.fixture).catch(() => null);
        let d = null;
        try { d = JSON.parse(txt ?? ""); } catch { d = null; }
        this.data = d ? { mine: d.mine ?? [], review: d.review ?? [], state: d.state ?? { status: "ok", message: "" } }
          : { mine: [], review: [], state: { status: "error", message: "Fixture file unreadable." } };
        this.polledAt = Date.now();
      } else if (this.poller) {
        this.data = await this.poller.poll({ force });
        this.polledAt = Date.now();
      }
    } catch {
      this.data = { ...this.data, state: { status: "error", message: "Could not reach Bitbucket." } };
    } finally { this.busy = false; cx.notify(); }
  }

  open(url) {
    const c = openCommand(url, window()?.platform);
    if (c) exec(c[0], c[1]).catch(() => null);
  }

  render(cx) {
    const t = theme();
    const now = Date.now();
    const rows = this.data[this.tab] ?? [];
    const sv = stateView(this.data.state, this.configured);
    const tone = { muted: t.muted, accent: t.accent, error: t.ansi1 };
    const count = (k) => this.data[k]?.length ?? 0;

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
          .child(div().truncate().text_size(13).line_height("18px").text_color(t.foreground).child(r.title))
          .child(div().truncate().text_size(11).line_height("14px").text_color(t.dim).child(rowMeta(r, now, this.polledAt))))
        .when(Boolean(cm), (el) => el.child(div().flex_none().text_size(11).text_color(t.muted).child(cm)))
        .when(Boolean(ap), (el) => el.child(div().flex_none().text_size(11).text_color(t.ansi2).child(ap)))
        .when(Boolean(bc), (el) => el.child(div().size(7).flex_none().rounded(4).bg(t[bc])));
    };

    const body = sv?.block
      ? v_flex().flex_1().min_h(0).px(14).py(12).gap(4)
        .child(div().text_size(13).text_color(t.foreground).child(sv.title))
        .child(div().text_size(12).line_height("17px").text_color(t.muted).child(sv.text))
      : v_flex().id("pr-scroll").flex_1().min_h(0).overflow_y_scrollbar().px(8).pb(8)
        .children(rows.map(row))
        .when(!rows.length, (el) => el.child(div().px(8).py(6).text_size(12).text_color(t.dim).child("No open pull requests")));

    return v_flex().size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Pull requests"))
        .child(div().px(5).py(1).rounded(4).border_1().border_color(t.border).text_size(10).text_color(t.muted).child(String(count("mine") + count("review"))))
        .child(div().flex_1())
        .child(div().id("pr-refresh").size(22).flex_none().flex().items_center().justify_center().rounded(5).cursor_pointer()
          .hover((s) => s.bg(t.hover)).tooltip("Refresh")
          .on_click((_e, cx) => { cx.spawn(async (cx) => this.refresh(true, cx)); })
          .child(svg("mods/bitbucket-prs/refresh.svg").size(13).text_color(this.busy ? t.accent : t.muted))))
      .child(h_flex().flex_wrap().min_h(30).gap(2).px(8).pt(5).items_center()
        .child(tab("mine", "Mine")).child(tab("review", "To review")))
      .child(body)
      .child(h_flex().h(24).flex_none().px(14).gap(8).items_center().border_t(1).border_color(t.border).text_size(11)
        .child(div().flex_none().text_color(t.dim).child(updatedText(this.polledAt, now)))
        .when(Boolean(sv && !sv.block), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(tone[sv.tone] ?? t.muted).child(sv.text))));
  }
}
