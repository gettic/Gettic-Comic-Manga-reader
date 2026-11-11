// Demo backend for the plain web build (no Tauri): two generated comics with placeholder art,
// settings and progress in localStorage. Loaded only when not running in the desktop app.
import { setDemoPageUrl } from "./comics";
import type { ComicInfo, PageInfo, RecentComic, ViewSettings } from "./types";

interface DemoDef {
  title: string;
  /** Acts like a PDF: page sizes are known up front. */
  pdf?: boolean;
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
  "demo:book": {
    title: "Demo book",
    pdf: true,
    count: 40,
    size: () => [793, 1122],
    art: bookPage,
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

// "?keys=ArrowLeft,ArrowLeft,f" presses those keys after opening, "?drag=-300" holds a touch drag
// of that many px from the middle of the page (for headless preview runs).
{
  const drag = Number(new URLSearchParams(location.search).get("drag"));
  if (drag) {
    setTimeout(() => {
      const stage = document.querySelector(".stage");
      if (!stage) return;
      const x = innerWidth / 2 + (drag < 0 ? 200 : -200);
      const y = innerHeight / 2;
      const ev = (type: string, cx: number) =>
        new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, clientX: cx, clientY: y, bubbles: true });
      stage.dispatchEvent(ev("pointerdown", x));
      for (let k = 1; k <= 10; k++) setTimeout(() => stage.dispatchEvent(ev("pointermove", x + (drag * k) / 10)), k * 16);
    }, 900);
  }
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
  const pages: PageInfo[] = Array.from({ length: def.count }, (_, i) => {
    const [width, height] = def.size(i);
    return def.pdf ? { index: i, name: `page-${i + 1}`, width, height } : { index: i, name: `page-${i + 1}.svg` };
  });
  return {
    id: path,
    path,
    title: def.title,
    kind: def.pdf ? "pdf" : "folder",
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

/** A plain-book page: margins, grey bars instead of text, sometimes a picture; page 1 is a cover. */
function bookPage(i: number, w: number, h: number): string {
  if (i === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#25344f"/><stop offset="1" stop-color="#5b3b5e"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#c)"/><rect x="50" y="50" width="${w - 100}" height="${h - 100}" fill="none" stroke="#e8c98a" stroke-width="3" opacity=".7"/><rect x="${w * 0.2}" y="230" width="${w * 0.6}" height="24" rx="4" fill="#f0dcae"/><rect x="${w * 0.3}" y="275" width="${w * 0.4}" height="14" rx="4" fill="#d9c493"/><circle cx="${w / 2}" cy="${h * 0.58}" r="140" fill="none" stroke="#e8c98a" stroke-width="3" opacity=".8"/><circle cx="${w / 2}" cy="${h * 0.58}" r="90" fill="#e8c98a" opacity=".25"/></svg>`;
  }
  const r = rng(i + 11);
  const m = 86;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" fill="#f6f1e7"/>`;
  let y = m;
  const figure = i % 5 === 3;
  while (y < h - m - 30) {
    if (figure && y > 300 && y < 340) {
      s += `<rect x="${m}" y="${y}" width="${w - 2 * m}" height="300" fill="#e6dfd0"/><circle cx="${w * 0.42}" cy="${y + 140}" r="64" fill="#7f8aa3"/><path d="M${m} ${y + 300} L${w * 0.35} ${y + 170} L${w * 0.55} ${y + 240} L${w * 0.7} ${y + 140} L${w - m} ${y + 300} Z" fill="#a8b49a"/>`;
      y += 340;
      continue;
    }
    const lines = 3 + Math.floor(r() * 5);
    for (let k = 0; k < lines && y < h - m - 30; k++) {
      const last = k === lines - 1;
      const indent = k === 0 ? 28 : 0;
      const lw = (w - 2 * m) * (last ? 0.35 + r() * 0.4 : 0.97) - indent;
      s += `<rect x="${m + indent}" y="${y}" width="${lw}" height="10" rx="3" fill="#5d5a54" opacity=".5"/>`;
      y += 26;
    }
    y += 18;
  }
  s += `<text x="${w / 2}" y="${h - 40}" text-anchor="middle" font-family="Georgia, serif" font-size="18" fill="#8f897d">${i + 1}</text>`;
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
