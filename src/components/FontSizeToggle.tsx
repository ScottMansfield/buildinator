"use client";

import { useCallback, useEffect, useState } from "react";

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

  useEffect(() => {
    const next = readFontSize();
    setSize(next);
    applyFontSize(next);
  }, []);

  const cycle = useCallback(() => {
    const i = SIZES.indexOf(size);
    const next = SIZES[(i + 1) % SIZES.length];
    setSize(next);
    applyFontSize(next);
    try {
      localStorage.setItem(KEY, String(next));
    } catch {
      // ignore
    }
  }, [size]);

  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={cycle}
      title="Font size (cycles 12 / 13 / 14 / 16)"
    >
      font: {size}
    </button>
  );
}
