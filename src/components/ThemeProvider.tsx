"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeName = "tui" | "grokday" | "web" | "light";

const KEY = "buildinator-theme";
const THEMES: ThemeName[] = ["tui", "grokday", "web", "light"];

type ThemeCtx = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function isTheme(v: string | null): v is ThemeName {
  return v === "tui" || v === "grokday" || v === "web" || v === "light";
}

function apply(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
}

function readStored(): ThemeName {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "default") return "web";
    if (isTheme(stored)) return stored;
  } catch {
    // ignore
  }
  return "tui";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>("tui");

  useEffect(() => {
    const next = readStored();
    setThemeState(next);
    apply(next);
  }, []);

  const setTheme = useCallback((t: ThemeName) => {
    setThemeState(t);
    apply(t);
    localStorage.setItem(KEY, t);
  }, []);

  const toggle = useCallback(() => {
    const i = THEMES.indexOf(theme);
    setTheme(THEMES[(i + 1) % THEMES.length]);
  }, [setTheme, theme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
