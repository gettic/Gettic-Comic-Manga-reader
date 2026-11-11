// Start screen: drop zone, Open file / Open folder, and the last 5 comics.
import { isTauri, type RecentComic } from "../api";
import { el, svg } from "../ui/dom";
import { icons } from "../ui/icons";

export interface StartActions {
  open(path: string): void;
  pick(kind: "file" | "folder"): void;
  help(): void;
}

export class StartScreen {
  readonly el: HTMLElement;
  private drop: HTMLElement;
  private recentBox: HTMLElement;
  private recent: RecentComic[] = [];

  constructor(private actions: StartActions) {
    const kbd = (t: string) => el("kbd", { text: t });
    this.drop = el(
      "div.drop",
      {},
      svg(icons.upload, "icon big"),
      el("h2", { text: "Drop a comic or a folder of images here" }),
      el("p.muted", { text: "or" }),
      el(
        "div.btns",
        {},
        el("button.btn.primary", { onclick: () => actions.pick("file") }, svg(icons.file), "Open file", kbd("Ctrl O")),
        el("button.btn", { onclick: () => actions.pick("folder") }, svg(icons.folder), "Open folder", kbd("Ctrl Shift O")),
      ),
      el("div.formats", { text: "CBZ · CBR · CB7 · ZIP · RAR · 7Z · PDF · folders of images" }),
      isTauri() ? null : el("div.formats.demo", { text: "Web demo: Open file shows a demo comic, Open folder a demo webtoon." }),
    );
    this.recentBox = el("div.recent");
    this.el = el(
      "main.start",
      {},
      el(
        "div.corner",
        {},
        el("button.icon-btn", { title: "Keys and help (?)", "aria-label": "Help", onclick: () => actions.help() }, svg(icons.help)),
      ),
      el(
        "div.logo",
        {},
        svg(icons.book, "icon logo-icon"),
        el("div", {}, el("div.name", { text: "Gettic's Comic-Manga reader" }), el("small", { text: "Comics and manga, left to right or right to left" })),
      ),
      this.drop,
      this.recentBox,
    );
  }

  setDragOver(on: boolean): void {
    this.drop.classList.toggle("over", on);
  }

  setRecent(list: RecentComic[]): void {
    this.recent = list;
    if (!list.length) {
      this.recentBox.replaceChildren();
      return;
    }
    const rows = list.map((r, i) => {
      const parts = [`Page ${r.page + 1} of ${r.pageCount}`];
      if (r.direction === "rtl") parts.push("Right to left");
      if (r.layout === "double") parts.push("Double page");
      if (r.layout === "book") parts.push("Book");
      if (r.layout === "strip") parts.push("Strip");
      const pct = r.pageCount > 1 ? Math.round((r.page / (r.pageCount - 1)) * 100) : 100;
      const bar = el("div.progress", {}, el("i"));
      (bar.firstChild as HTMLElement).style.width = `${pct}%`;
      return el(
        `button.recent-row${i === 0 ? ".first" : ""}`,
        { title: r.path, onclick: () => this.actions.open(r.path) },
        el("div.info", {}, el("b", { text: i === 0 ? `Continue: ${r.title}` : r.title }), el("span", { text: parts.join(" · ") }), bar),
        i === 0 ? el("span.resume", {}, "Resume", el("kbd", { text: "Enter" })) : null,
      );
    });
    this.recentBox.replaceChildren(el("h3", { text: "Recent" }), ...rows);
  }

  /** Enter on the start screen resumes the most recent comic. */
  resume(): boolean {
    const r = this.recent[0];
    if (!r) return false;
    this.actions.open(r.path);
    return true;
  }
}
