// Demo backend for the plain web build (no Tauri): two generated comics with placeholder art,
// settings and progress in localStorage. Loaded only when not running in the desktop app.
import { setDemoPageUrl } from "./comics";
import type { ComicInfo, PageInfo, RecentComic, ViewSettings } from "./types";

interface DemoDef {
  title: string;
  count: number;
  size: (i: number) => [number, number];
  art: (i: number, w: number, h: number) => string;
}

const DEMOS: Record<string, DemoDef> = {
  "demo:comic": {
    title: "Demo comic",
    count: 24,
    size: (i) => (i === 9 ? [2000, 1500] : [1000, 1500]),
    art: paperPage,
  },
  "demo:webtoon": {
    title: "Demo webtoon",
    count: 30,
    size: () => [800, 2400],
    art: colorPage,
  },
};

const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem("gcmr.demo." + k);
      return v ? (JSON.parse(v) as T) : d;
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem("gcmr.demo." + k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

interface Entry {
  page: number;
  view?: ViewSettings;
  updated: number;
}

const urlCache = new Map<string, string>();

setDemoPageUrl((comic, index) => {
  const key = comic.path + "#" + index;
  let url = urlCache.get(key);
  if (!url) {
    const def = DEMOS[comic.path];
    const [w, h] = def.size(index);
    url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(def.art(index, w, h));
    urlCache.set(key, url);
  }
  return url;
});

// "?keys=ArrowLeft,ArrowLeft,f" presses those keys after opening (for headless preview runs).
{
  const keys = new URLSearchParams(location.search).get("keys");
  if (keys) {
    keys.split(",").forEach((key, i) => {
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })), 700 + i * 350);
    });
  }
}

export function pickComic(kind: "file" | "folder"): string | null {
  return kind === "file" ? "demo:comic" : "demo:webtoon";
}

export function openComic(path: string): ComicInfo {
  const def = DEMOS[path];
  if (!def) throw { code: "not_found", message: "The web demo can only open its two demo comics." };
  const entries = store.get<Record<string, Entry>>("progress", {});
  const e = entries[path];
  // Like archives, sizes are not known up front (the UI measures loaded images).
  const pages: PageInfo[] = Array.from({ length: def.count }, (_, i) => ({ index: i, name: `page-${i + 1}.svg` }));
  return {
    id: path,
    path,
    title: def.title,
    kind: "folder",
    pages,
    urlBase: "demo:" + path + "/",
    lastPage: Math.min(e ? e.page : Number(new URLSearchParams(location.search).get("page") ?? 0) || 0, def.count - 1),
    isRendered: false,
    view: e?.view ?? urlView(),
  };
}

/** "?layout=double&direction=rtl&fit=width&page=13" sets the demo's first view (for previews). */
function urlView(): Partial<ViewSettings> | undefined {
  const q = new URLSearchParams(location.search);
  const v: Record<string, string> = {};
  for (const k of ["layout", "direction", "fit"]) {
    const x = q.get(k);
    if (x) v[k] = x;
  }
  return Object.keys(v).length ? (v as Partial<ViewSettings>) : undefined;
}

function update(id: string, f: (e: Entry) => void) {
  const entries = store.get<Record<string, Entry>>("progress", {});
  const e = entries[id] ?? { page: 0, updated: 0 };
  f(e);
  e.updated = Date.now();
  entries[id] = e;
  store.set("progress", entries);
}

export function setProgress(id: string, page: number): void {
  update(id, (e) => (e.page = page));
}

export function setComicView(id: string, view: ViewSettings): void {
  update(id, (e) => (e.view = view));
}

export function recentComics(limit: number): RecentComic[] {
  const entries = store.get<Record<string, Entry>>("progress", {});
  return Object.entries(entries)
    .filter(([p]) => DEMOS[p])
    .sort((a, b) => b[1].updated - a[1].updated)
    .slice(0, limit)
    .map(([path, e]) => ({
      path,
      title: DEMOS[path].title,
      page: e.page,
      pageCount: DEMOS[path].count,
      updated: e.updated,
      direction: e.view?.direction,
      layout: e.view?.layout,
    }));
}

// ---------- placeholder art ----------

function rng(seed: number) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

function paperPage(i: number, w: number, h: number): string {
  const r = rng(i + 3);
  const m = w > h ? h * 0.055 : w * 0.055;
  const g = m * 0.4;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f3efe6"/>`;
  const rows = w > h ? [1] : [0.3, 0.4, 0.3];
  let y = m;
  for (const f of rows) {
    const rh = f * (h - 2 * m);
    const cols = rows.length === 1 ? 1 : r() > 0.5 ? 2 : 3;
    const pw = (w - 2 * m - (cols - 1) * g) / cols;
    for (let c = 0; c < cols; c++) {
      const x = m + c * (pw + g);
      s += `<rect x="${x}" y="${y}" width="${pw}" height="${rh - g}" fill="#fbf9f4" stroke="#1d1c1a" stroke-width="5"/>`;
      const cx = x + pw * (0.3 + r() * 0.4);
      const rad = Math.min(pw, rh) * 0.12;
      s += `<circle cx="${cx}" cy="${y + rh * 0.45}" r="${rad}" fill="#2b2a28"/>`;
      s += `<path d="M${cx - rad * 1.3} ${y + rh - g} Q ${cx} ${y + rh * 0.5} ${cx + rad * 1.3} ${y + rh - g} Z" fill="#3b3a37"/>`;
      if (r() > 0.35) {
        const bx = x + pw * (0.2 + r() * 0.5);
        s += `<ellipse cx="${bx}" cy="${y + rh * 0.2}" rx="${Math.min(pw * 0.22, 120)}" ry="${Math.min(rh * 0.1, 50)}" fill="#fff" stroke="#222" stroke-width="3"/>`;
      }
    }
    y += rh;
  }
  const label = w > h ? `${i + 1}-${i + 2} (spread)` : `${i + 1}`;
  s += `<text x="${w / 2}" y="${h - m * 0.3}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${m * 0.55}" fill="#9a958a">${label}</text>`;
  s += `<text x="${w / 2}" y="${h / 2}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-weight="700" font-size="${w > h ? h * 0.2 : w * 0.3}" fill="rgba(242,165,65,.35)">${i + 1}</text>`;
  return s + "</svg>";
}

function colorPage(i: number, w: number, h: number): string {
  const pal = [
    ["#2a3d66", "#6f8fd1"],
    ["#5a2d4a", "#d1709a"],
    ["#1f4d45", "#5fbfa5"],
    ["#6b4a1f", "#e0a85a"],
  ];
  const [a, b] = pal[i % pal.length];
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>`;
  s += `<rect width="${w}" height="${h}" fill="#f7f6f2"/><rect x="0" y="${h * 0.05}" width="${w}" height="${h * 0.55}" fill="url(#g)"/>`;
  s += `<circle cx="${w * 0.45}" cy="${h * 0.32}" r="${w * 0.1}" fill="rgba(15,15,25,.85)"/>`;
  s += `<ellipse cx="${w * 0.65}" cy="${h * 0.12}" rx="${w * 0.17}" ry="${w * 0.06}" fill="#fff" stroke="#222" stroke-width="3"/>`;
  s += `<rect x="${w * 0.1}" y="${h * 0.68}" width="${w * 0.8}" height="${h * 0.25}" fill="url(#g)" opacity=".7"/>`;
  s += `<text x="${w / 2}" y="${h * 0.66}" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="${w * 0.05}" fill="#888">${i + 1}</text>`;
  return s + "</svg>";
}
