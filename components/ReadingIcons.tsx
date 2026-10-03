import type { ReactNode } from "react";

export type IconName = "book" | "mic" | "stop" | "sound" | "settings" | "arrow" | "close" | "check" | "sun" | "house" | "leaf" | "cat" | "waves" | "bus";

export function ReadingIcon({ name, className = "" }: { name: IconName; className?: string }) {
  const shapes: Record<IconName, ReactNode> = {
    book: <><path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" /><path d="M12 5v15M6 8h3M15 8h3" /></>,
    mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" /></>,
    stop: <rect x="5" y="5" width="14" height="14" rx="3" />,
    sound: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8M18 4a11 11 0 0 1 0 16" /></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16" /><path d="M8 3v6M16 9v6M9 15v6" strokeWidth="4" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    check: <path d="m5 12 4 4L19 6" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 1v2M12 21v2M1 12h2M21 12h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" /></>,
    house: <><path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7" /><path d="M16 5V2h3v6" /></>,
    leaf: <><path d="M19 3C8 1 2 8 5 15c4 7 15 2 14-12ZM5 21 16 7M9 16l-1-5m5 1 4 1" /></>,
    cat: <><path d="m4 10 1-7 6 4h2l6-4 1 7v4c0 4-4 7-8 7s-8-3-8-7Z" /><path d="M8 12h.01M16 12h.01m-5 4 1 1 1-1M1 14l4 1m14 0 4-1" /></>,
    waves: <><path d="M2 14q3-4 6 0t6 0 6 0M2 20q3-4 6 0t6 0 6 0" /><circle cx="15" cy="5" r="3" /></>,
    bus: <><rect x="4" y="3" width="16" height="16" rx="3" /><path d="M4 11h16M8 3v8M7 19v3M17 19v3M7 15h2m6 0h2" /></>,
  };
  return <svg className={`reading-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{shapes[name]}</svg>;
}

/** A quiet, decorative book buddy; never moves or reacts to reading mistakes. */
export function BookBuddy() {
  return (
    <svg className="book-buddy" viewBox="0 0 64 64" fill="none" aria-hidden="true" focusable="false">
      <path d="M8 15c10-3 18-1 24 3 7-4 15-6 24-3v36c-9-3-17-1-24 3-7-4-15-6-24-3Z" fill="#cde2cc" stroke="#285b4b" strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M32 19v34" stroke="#285b4b" strokeWidth="2" />
      <path d="m44 14 7-1v13l-3-2-4 3Z" fill="#e2a058" />
      <circle cx="23" cy="32" r="2" fill="#285b4b" /><circle cx="41" cy="32" r="2" fill="#285b4b" />
      <path d="M27 39q5 5 10 0" stroke="#285b4b" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
