// The key map. One table drives both the keyboard handler and the help overlay.

export type Command =
  | "visualLeft"
  | "visualRight"
  | "next"
  | "prev"
  | "scrollDown"
  | "scrollUp"
  | "first"
  | "last"
  | "jumpLeft"
  | "jumpRight"
  | "layoutSingle"
  | "layoutDouble"
  | "layoutBook"
  | "layoutStrip"
  | "toggleDirection"
  | "fitWidth"
  | "fitHeight"
  | "fitPage"
  | "fitOriginal"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | "coverAlone"
  | "shiftLeft"
  | "shiftRight"
  | "goTo"
  | "fullscreen"
  | "escape"
  | "toggleChrome"
  | "openFile"
  | "openFolder"
  | "help";

export interface KeyLike {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

interface Binding {
  keys: string[]; // "Ctrl+Shift+O", "Shift+ArrowRight", " "
  cmd: Command;
  help: string;
  label: string; // how the keys are shown in the help
}

export const BINDINGS: Binding[] = [
  { keys: ["ArrowRight", "d"], cmd: "visualRight", label: "Right / D", help: "Page to the right (next in left-to-right, previous in right-to-left)" },
  { keys: ["ArrowLeft", "a"], cmd: "visualLeft", label: "Left / A", help: "Page to the left (previous in left-to-right, next in right-to-left)" },
  { keys: [" ", "PageDown"], cmd: "next", label: "Space / Page Down", help: "Next (scrolls a tall page first)" },
  { keys: ["Shift+ ", "PageUp"], cmd: "prev", label: "Shift+Space / Page Up", help: "Previous (scrolls a tall page first)" },
  { keys: ["ArrowDown", "j"], cmd: "scrollDown", label: "Down / J", help: "Scroll down, next page at the bottom" },
  { keys: ["ArrowUp", "k"], cmd: "scrollUp", label: "Up / K", help: "Scroll up, previous page at the top" },
  { keys: ["Home"], cmd: "first", label: "Home", help: "First page" },
  { keys: ["End"], cmd: "last", label: "End", help: "Last page" },
  { keys: ["Ctrl+ArrowLeft"], cmd: "jumpLeft", label: "Ctrl+Left", help: "10 pages to the left" },
  { keys: ["Ctrl+ArrowRight"], cmd: "jumpRight", label: "Ctrl+Right", help: "10 pages to the right" },
  { keys: ["1"], cmd: "layoutSingle", label: "1", help: "Single page" },
  { keys: ["2"], cmd: "layoutDouble", label: "2", help: "Double page" },
  { keys: ["3"], cmd: "layoutStrip", label: "3", help: "Strip (webtoon)" },
  { keys: ["4"], cmd: "layoutBook", label: "4", help: "Book (two pages with a spine; pages flip when Page turn is Animated)" },
  { keys: ["r"], cmd: "toggleDirection", label: "R", help: "Switch left-to-right / right-to-left" },
  { keys: ["w"], cmd: "fitWidth", label: "W", help: "Fit width" },
  { keys: ["h"], cmd: "fitHeight", label: "H", help: "Fit height" },
  { keys: ["p"], cmd: "fitPage", label: "P", help: "Fit page" },
  { keys: ["o"], cmd: "fitOriginal", label: "O", help: "Original size" },
  { keys: ["+", "=", "Ctrl+=", "Ctrl++"], cmd: "zoomIn", label: "+", help: "Zoom in" },
  { keys: ["-", "Ctrl+-"], cmd: "zoomOut", label: "-", help: "Zoom out" },
  { keys: ["0", "Ctrl+0"], cmd: "zoomReset", label: "0", help: "Reset zoom" },
  { keys: ["c"], cmd: "coverAlone", label: "C", help: "Cover shown alone (double page)" },
  { keys: ["Shift+ArrowLeft"], cmd: "shiftLeft", label: "Shift+Left", help: "Shift page pairing by one (double page)" },
  { keys: ["Shift+ArrowRight"], cmd: "shiftRight", label: "Shift+Right", help: "Shift page pairing by one (double page)" },
  { keys: ["g"], cmd: "goTo", label: "G", help: "Go to page" },
  { keys: ["f", "F11"], cmd: "fullscreen", label: "F / F11", help: "Fullscreen" },
  { keys: ["Escape"], cmd: "escape", label: "Esc", help: "Close menu, leave fullscreen, back to start" },
  { keys: ["Tab", "m"], cmd: "toggleChrome", label: "Tab / M", help: "Show or hide the controls" },
  { keys: ["Ctrl+o"], cmd: "openFile", label: "Ctrl+O", help: "Open a file" },
  { keys: ["Ctrl+Shift+o"], cmd: "openFolder", label: "Ctrl+Shift+O", help: "Open a folder" },
  { keys: ["?", "Shift+?"], cmd: "help", label: "?", help: "This help" },
];

/** Normalised name of a key press, e.g. "Ctrl+Shift+o", "Shift+ArrowLeft", " ". */
export function keyName(e: KeyLike): string {
  let k = e.key;
  if (k.length === 1) k = k.toLowerCase();
  let s = "";
  if (e.ctrlKey || e.metaKey) s += "Ctrl+";
  if (e.altKey) s += "Alt+";
  // Shift is part of printable symbols like "?" and "+", so only add it for named keys, letters and space.
  if (e.shiftKey && (k.length > 1 || /[a-z ]/.test(k))) s += "Shift+";
  return s + k;
}

const table = new Map<string, Command>();
for (const b of BINDINGS) for (const k of b.keys) table.set(k, b.cmd);

export function commandForKey(e: KeyLike): Command | undefined {
  return table.get(keyName(e));
}
