"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FontPx = 12 | 13 | 14 | 16;

const KEY = "buildinator-font-size";
const SIZES: FontPx[] = [12, 13, 14, 16];

function isFontPx(v: string | null): v is `${FontPx}` {
  return v === "12" || v === "13" || v === "14" || v === "16";
}

export function applyFontSize(n: FontPx) {
  document.documentElement.style.setProperty("--ui-font-size", `${n}px`);
}

export function readFontSize(): FontPx {
  try {
    const stored = localStorage.getItem(KEY);
    if (isFontPx(stored)) return Number(stored) as FontPx;
  } catch {
    // ignore
  }
  return 14;
}

export function FontSizeToggle() {
  const [size, setSize] = useState<FontPx>(14);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = readFontSize();
    setSize(next);
    applyFontSize(next);
  }, []);

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

  const choose = useCallback((next: FontPx) => {
    setSize(next);
    applyFontSize(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // ignore
    }
    setOpen(false);
  }, []);

  return (
    <div className="theme-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Font size"
        title="Font size"
      >
        font size: {size}
      </button>
      {open ? (
        <div className="theme-menu" role="listbox" aria-label="Font size">
          {SIZES.map((n) => (
            <button
              key={n}
              type="button"
              role="option"
              aria-selected={size === n}
              className={"theme-option" + (size === n ? " selected" : "")}
              onClick={() => choose(n)}
            >
              {n}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
