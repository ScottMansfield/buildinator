"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme, type ThemeName } from "./ThemeProvider";

const GROUPS: { label: string; items: { id: ThemeName; label: string }[] }[] = [
  {
    label: "TUI",
    items: [
      { id: "tui", label: "groknight" },
      { id: "grokday", label: "grokday" },
    ],
  },
  {
    label: "web",
    items: [
      { id: "web", label: "dark" },
      { id: "light", label: "light" },
    ],
  },
];

const LABELS: Record<ThemeName, string> = {
  tui: "groknight",
  grokday: "grokday",
  web: "dark",
  light: "light",
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title="Theme picker (t cycles)"
      >
        theme: {LABELS[theme]}
      </button>
      {open ? (
        <div className="theme-menu" role="listbox" aria-label="Theme">
          {GROUPS.map((g) => (
            <div key={g.label} className="theme-group">
              <div className="theme-group-label">{g.label}</div>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="option"
                  aria-selected={theme === item.id}
                  className={"theme-option" + (theme === item.id ? " selected" : "")}
                  onClick={() => {
                    setTheme(item.id);
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
