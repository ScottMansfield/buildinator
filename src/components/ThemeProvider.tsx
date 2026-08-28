"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeName = "tui" | "web";

const KEY = "buildinator-theme";

type ThemeCtx = {
  theme: ThemeName;
  setTheme: (t: ThemeName) => void;
  toggle: () => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

function apply(theme: ThemeName) {
  document.documentElement.setAttribute("data-theme", theme);
}

function readStored(): ThemeName {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "default" || stored === "web") return "web";
    if (stored === "tui") return "tui";
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
    setTheme(theme === "tui" ? "web" : "tui");
  }, [setTheme, theme]);

  const value = useMemo(() => ({ theme, setTheme, toggle }), [theme, setTheme, toggle]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useTheme outside ThemeProvider");
  return ctx;
}
