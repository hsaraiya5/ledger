"use client";

import { useEffect, useState } from "react";

type Theme = "dark" | "light";

// Matches the light/dark --paper colors in globals.css, so the browser chrome follows a manual choice too.
const PAPER: Record<Theme, string> = { light: "#e6efe3", dark: "#071417" };

function current(): Theme {
  const set = document.documentElement.dataset.theme;
  if (set === "dark" || set === "light") return set;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", PAPER[t]));
}

/** Flips between dark and light. Until it's used, the page follows the device setting. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- read the applied theme once after hydration
  useEffect(() => setTheme(current()), []);
  const next: Theme = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="ibtn theme-toggle"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        apply(next);
        setTheme(next);
        try { localStorage.setItem("theme", next); } catch {}
      }}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {theme === "light"
          ? <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
          : <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0z" />}
      </svg>
    </button>
  );
}
