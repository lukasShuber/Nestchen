// Small hand-drawn line icon set (24×24, round strokes).
const PATHS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-5.5h4v5.5h3.5a1 1 0 0 0 1-1V9" /></>,
  calendar: <><rect x="3.5" y="4.5" width="17" height="16" rx="3.5" /><path d="M3.5 9.5h17M8 2.5v4M16 2.5v4" /></>,
  visits: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.4-5.6 6.5-5.6s5.7 2 6.5 5.6" /><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.8c1.8.8 3 2.6 3.5 5.2" /></>,
  list: <><path d="M10 6.5h10M10 12h10M10 17.5h10" /><path d="m3.5 6.5 1.3 1.3 2.2-2.6M3.5 12l1.3 1.3L7 10.7M3.5 17.5l1.3 1.3 2.2-2.6" /></>,
  more: <><circle cx="5.5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="18.5" cy="12" r="1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  chevronLeft: <path d="m14.5 18-6-6 6-6" />,
  chevronRight: <path d="m9.5 18 6-6-6-6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronUp: <path d="m6 14.5 6-6 6 6" />,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l.9 12.2A2 2 0 0 0 8.9 21h6.2a2 2 0 0 0 2-1.8L18 7" /><path d="M9 7V4.5A1.5 1.5 0 0 1 10.5 3h3A1.5 1.5 0 0 1 15 4.5V7" /></>,
  edit: <><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  gift: <><rect x="3.5" y="8" width="17" height="4" rx="1" /><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7M12 8v13" /><path d="M12 8S10.6 3.5 8.2 3.5a2.2 2.2 0 0 0 0 4.5H12zM12 8s1.4-4.5 3.8-4.5a2.2 2.2 0 0 1 0 4.5H12z" /></>,
  heart: <path d="M12 20s-7.4-4.4-9-9.2C1.9 7.4 4.2 4.5 7.3 4.5c2 0 3.4 1.1 4.7 2.8 1.3-1.7 2.7-2.8 4.7-2.8 3.1 0 5.4 2.9 4.3 6.3-1.6 4.8-9 9.2-9 9.2z" />,
  settings: <><path d="M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="17" r="2" /></>,
  logout: <><path d="M14.5 4H18a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3.5" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  moon: <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5 8 8 0 1 0 19.5 14.6z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2.5" /><path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" /></>,
  phone: <path d="M5.5 3.5h3l1.6 4.3-2.1 1.4a11.5 11.5 0 0 0 6.8 6.8l1.4-2.1 4.3 1.6v3a2 2 0 0 1-2.2 2C10.6 19.9 4.1 13.4 3.5 5.7a2 2 0 0 1 2-2.2z" />,
  chat: <path d="M4 12a8 8 0 1 1 3.3 6.5L4 19.5l1-3.4A8 8 0 0 1 4 12z" />,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7.5 8 5.5 8-5.5" /></>,
  lock: <><rect x="4.5" y="10.5" width="15" height="10" rx="2.5" /><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z" /></>,
  pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>,
  download: <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />,
  refresh: <><path d="M19.5 11A7.5 7.5 0 0 0 6 6.8L4.5 8.5M4.5 4.5v4h4" /><path d="M4.5 13A7.5 7.5 0 0 0 18 17.2l1.5-1.7M19.5 19.5v-4h-4" /></>,
  bell: <><path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  tag: <><path d="M3.5 12.4V5A1.5 1.5 0 0 1 5 3.5h7.4l8 8a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0z" /><circle cx="8" cy="8" r="1.3" /></>,
  send: <><path d="M20.5 3.5 10 14" /><path d="m20.5 3.5-6.3 17-4.2-6.5-6.5-4.2z" /></>,
  share: <><circle cx="18" cy="5.5" r="2.5" /><circle cx="6" cy="12" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="m8.2 10.8 7.6-4.2M8.2 13.2l7.6 4.2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 20.5c1-3.9 4-6 7.5-6s6.5 2.1 7.5 6" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5M12 7.8v.1" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3.1-3.1a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3.1 3.1a4 4 0 0 0 5.7 5.7l1-1" /></>,
  star: <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" />,
  bottle: <><path d="M10.5 4.8V3.9a1.5 1.5 0 0 1 3 0v.9" /><rect x="8.3" y="4.8" width="7.4" height="2.6" rx="1.1" /><path d="M9.2 7.4 8.2 10v9.3a2.2 2.2 0 0 0 2.2 2.2h3.2a2.2 2.2 0 0 0 2.2-2.2V10l-1-2.6" /><path d="M10.6 12.5h2.2M10.6 15.5h2.2" /></>,
  play: <path d="M8 5.5v13l10.5-6.5z" />,
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" />,
  inbox: <><path d="M3.5 13.5 6 5.5a2 2 0 0 1 1.9-1.4h8.2A2 2 0 0 1 18 5.5l2.5 8" /><path d="M3.5 13.5V18a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-4.5h-5a3 3 0 0 1-6 0z" /></>,
} as const;

export type IconName = keyof typeof PATHS;

const FILLED = new Set<IconName>(["play", "stop"]);

export function Icon({ name, size = 20, class: cls }: { name: IconName; size?: number; class?: string }) {
  return (
    <svg
      class={cls ? `icon ${cls}` : "icon"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={FILLED.has(name) ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.9"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The little moon-and-star logo. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <mask id="logo-cut">
          <rect width="64" height="64" fill="#fff" />
          <circle cx="41" cy="24" r="13.5" fill="#000" />
        </mask>
      </defs>
      <rect width="64" height="64" rx="18" class="logo-bg" />
      <circle cx="30" cy="35" r="17" class="logo-moon" mask="url(#logo-cut)" />
      <path
        class="logo-star"
        transform="translate(46.5 19.5)"
        d="M0-6.2 1.6-2.2 5.9-1.9 2.6.9 3.6 5 0 2.8-3.6 5-2.6.9-5.9-1.9-1.6-2.2Z"
      />
    </svg>
  );
}
