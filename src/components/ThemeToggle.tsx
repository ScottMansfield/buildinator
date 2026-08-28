"use client";

import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={toggle}
      aria-pressed={theme === "tui"}
      title="Toggle TUI / web theme (t)"
    >
      {theme === "tui" ? "theme: tui" : "theme: web"}
    </button>
  );
}
