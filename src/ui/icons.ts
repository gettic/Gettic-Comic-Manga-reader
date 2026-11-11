// Hand-drawn inline SVG icons (no icon package). All use currentColor.

const s = (body: string, w = 1.9, fill = "none") =>
  `<svg width="18" height="18" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  back: s('<path d="M15 18l-6-6 6-6"/>', 2),
  left: s('<path d="M15 18l-6-6 6-6"/>', 2),
  right: s('<path d="M9 6l6 6-6 6"/>', 2),
  single: s('<rect x="6" y="3" width="12" height="18" rx="1.5"/>', 1.8),
  double: s('<rect x="2" y="4" width="9.5" height="16" rx="1.5"/><rect x="12.5" y="4" width="9.5" height="16" rx="1.5"/>', 1.8),
  strip: s('<rect x="7" y="1.5" width="10" height="9.5" rx="1"/><rect x="7" y="13" width="10" height="9.5" rx="1"/>', 1.8),
  ltr: s('<path d="M4 12h15M14 7l5 5-5 5"/>', 2),
  rtl: s('<path d="M20 12H5M10 7l-5 5 5 5"/>', 2),
  fit: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 1.8),
  chevron: s('<path d="M6 9l6 6 6-6"/>', 2.4),
  minus: s('<path d="M5 12h14"/>', 2.2),
  plus: s('<path d="M5 12h14M12 5v14"/>', 2.2),
  fullscreen: s('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>', 2),
  exitFullscreen: s('<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>', 2),
  gear: s('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>', 1.8),
  help: s('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .8-1 1.5v.4"/><path d="M12 16.8v.01"/>', 1.8),
  file: s('<path d="M6 2.5h8l4.5 4.5v14.5H6z"/><path d="M14 2.5V7h4.5"/>'),
  folder: s('<path d="M3 6.5h6l2 2h10v11H3z"/>'),
  book: s('<path d="M12 6.5C10 5 7 4.5 3 5v13c4-.5 7 0 9 1.5 2-1.5 5-2 9-1.5V5c-4-.5-7 0-9 1.5z"/><path d="M12 6.5v13"/>', 1.6),
  upload: s('<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 14v5.5h16V14"/>', 1.4),
  check: s('<path d="M5 12.5l4.5 4.5L19 7.5"/>', 2.4),
  close: s('<path d="M6 6l12 12M18 6L6 18"/>', 2),
  broken: s('<path d="M4 4h16v16H4z"/><path d="M4 15l4-4 3 3 3-4 6 6"/><path d="M3 3l18 18"/>', 1.6),
};
