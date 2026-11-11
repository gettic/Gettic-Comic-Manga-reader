import { describe, expect, it } from "vitest";
import { pageUrl } from "../api/comics";
import type { ComicInfo } from "../api/types";
import { needsSharper, renderWidth, startWidth } from "./page-cache";

describe("PDF render widths", () => {
  it("asks for the shown width x devicePixelRatio, rounded up to 256", () => {
    // A page shown 657 CSS px wide at 100% on a 1x screen: 768, not the screen width.
    expect(renderWidth(657, 1, 1)).toBe(768);
    expect(renderWidth(657, 1, 1.5)).toBe(1024); // 985.5 -> 1024
    expect(renderWidth(512, 1, 1)).toBe(512);
    expect(renderWidth(10, 1, 1)).toBe(256);
    expect(renderWidth(3000, 3, 2)).toBe(4096); // capped
  });

  it("zoom makes the wanted width bigger", () => {
    expect(renderWidth(657, 2, 1)).toBe(1536); // 1314 -> 1536
  });

  it("re-renders only when the wanted width needs a bigger step", () => {
    expect(needsSharper(768, 700)).toBe(false);
    expect(needsSharper(768, 768)).toBe(false);
    expect(needsSharper(768, 769)).toBe(true);
    expect(needsSharper(768, 1314)).toBe(true);
    expect(needsSharper(1536, 657)).toBe(false); // zooming out never asks again
    expect(needsSharper(0, 5000)).toBe(false); // not a rendered comic
  });

  it("page URLs carry ?w only for rendered comics", () => {
    const base: ComicInfo = {
      id: "c1",
      path: "x",
      title: "x",
      kind: "pdf",
      pages: [],
      urlBase: "http://comic.localhost/c1/",
      lastPage: 0,
      isRendered: true,
    };
    expect(pageUrl(base, 3, 985.5)).toBe("http://comic.localhost/c1/3?w=1024");
    expect(pageUrl({ ...base, isRendered: false, kind: "zip" }, 3, 985.5)).toBe("http://comic.localhost/c1/3");
  });
});

describe("preload width (Book view halves)", () => {
  it("preloads at the layout's shown width, not an older bigger one", () => {
    // A Book half 576 css px wide at dpr 1 -> 768, even after a zoomed page asked for 2048.
    expect(startWidth(0, renderWidth(576, 1, 1), 2048)).toBe(768);
  });
  it("an explicit width wins; nothing known falls back to the last, then 1792", () => {
    expect(startWidth(1280, 768, 2048)).toBe(1280);
    expect(startWidth(0, 0, 1024)).toBe(1024);
    expect(startWidth(0, 0, 0)).toBe(1792);
  });
});