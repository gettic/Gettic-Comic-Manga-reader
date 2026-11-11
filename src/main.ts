// App entry: loads settings, switches between the start screen and the reader.
import "./styles.css";
import "./styles/start.css";
import "./styles/reader.css";
import {
  errorMessage,
  loadSettings,
  onFileDrop,
  onOpenPath,
  openComic,
  pickComic,
  recentComics,
  saveSettings,
  takeStartupPath,
  type AppSettings,
} from "./api";
import { closeHelp, toggleHelp } from "./reader/chrome/help";
import { Reader } from "./reader/reader";
import { StartScreen } from "./screens/start";
import { sanitizeSettings } from "./settings/defaults";
import { el } from "./ui/dom";
import { toast } from "./ui/toast";

const app = document.querySelector<HTMLDivElement>("#app")!;
let settings: AppSettings = sanitizeSettings(null);
let saveTimer = 0;
let reader: Reader | null = null;
let opening = false;
const dropHint = el("div.drop-hint", {}, el("div", { text: "Drop to open" }));

const start = new StartScreen({
  open: (p) => void open(p),
  pick: (k) => void pick(k),
  help: () => toggleHelp(),
});

function updateSettings(patch: Partial<AppSettings>): void {
  settings = sanitizeSettings({ ...settings, ...patch });
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => saveSettings(settings).catch(() => {}), 500);
}

async function showStart(): Promise<void> {
  app.replaceChildren(start.el);
  try {
    start.setRecent(await recentComics(5));
  } catch {
    start.setRecent([]);
  }
}

async function open(path: string): Promise<void> {
  if (opening) return;
  opening = true;
  const slow = window.setTimeout(() => toast("Opening..."), 400);
  try {
    const comic = await openComic(path);
    if (reader) await reader.close();
    closeHelp();
    reader = new Reader(comic, {
      settings: () => settings,
      updateSettings,
      back: () => void back(),
      pick: (k) => void pick(k),
    });
    app.replaceChildren(reader.el);
    reader.mounted();
  } catch (e) {
    toast(errorMessage(e), "error", 5000);
  } finally {
    clearTimeout(slow);
    opening = false;
  }
}

async function back(): Promise<void> {
  const r = reader;
  reader = null;
  if (r) await r.close();
  await showStart();
}

async function pick(kind: "file" | "folder"): Promise<void> {
  try {
    const path = await pickComic(kind);
    if (path) await open(path);
  } catch (e) {
    toast(errorMessage(e), "error", 5000);
  }
}

// Keys on the start screen (the reader handles its own while open).
window.addEventListener("keydown", (e) => {
  if (reader) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "o") {
    e.preventDefault();
    void pick(e.shiftKey ? "folder" : "file");
  } else if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") {
    if (start.resume()) e.preventDefault();
  } else if (e.key === "?") {
    toggleHelp();
  } else if (e.key === "Escape") {
    closeHelp();
  }
});

async function boot(): Promise<void> {
  try {
    settings = sanitizeSettings(await loadSettings());
  } catch {
    /* defaults */
  }
  await showStart();
  await onFileDrop({
    enter: () => {
      start.setDragOver(true);
      if (reader) document.body.append(dropHint);
    },
    leave: () => {
      start.setDragOver(false);
      dropHint.remove();
    },
    drop: (paths) => void open(paths[0]),
  }).catch(() => {});
  await onOpenPath((p) => void open(p)).catch(() => {});
  try {
    const first = await takeStartupPath();
    if (first) await open(first);
  } catch {
    /* nothing to open */
  }
}

void boot();
