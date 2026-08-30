"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { keys: string; hint: string };

function isMacClient(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || navigator.platform || "";
  return /Mac|iPhone|iPad|iPod/i.test(platform);
}

function shortcutGroups(mod: string): { label: string; items: Row[] }[] {
  return [
    {
      label: "Essentials",
      items: [
        { keys: "Enter", hint: "send" },
        { keys: "Ctrl+Enter", hint: "send" },
        { keys: "Esc", hint: "close overlay / cancel turn" },
        { keys: "? · Ctrl+. · F2", hint: "this overlay" },
      ],
    },
    {
      label: "Composer",
      items: [
        { keys: "/", hint: "slash commands (/help /rename /compact /rewind)" },
        { keys: "↑ / ↓", hint: "prompt history" },
        { keys: "!", hint: "shell mode (empty composer)" },
      ],
    },
    {
      label: "Session",
      items: [
        { keys: `${mod}+j / ${mod}+k`, hint: "next / previous session" },
        { keys: `${mod}+n`, hint: "new session" },
        { keys: `${mod}+t`, hint: "cycle theme" },
      ],
    },
    {
      label: "Panes",
      items: [
        { keys: `${mod}+[ / ${mod}+]`, hint: "collapse / expand artifacts" },
        { keys: "Page Up / Down", hint: "scroll transcript" },
        { keys: "font size: 12", hint: "header picker · 12 / 13 / 14 / 16" },
      ],
    },
  ];
}

type Props = { open: boolean; onClose: () => void };

export function ShortcutsOverlay({ open, onClose }: Props) {
  const [selected, setSelected] = useState(0);
  const [mod, setMod] = useState("Alt");
  const groups = useMemo(() => shortcutGroups(mod), [mod]);
  const flatLen = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  useEffect(() => {
    setMod(isMacClient() ? "Option" : "Alt");
  }, []);

  useEffect(() => {
    if (open) setSelected(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => (i + 1) % flatLen);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        setSelected((i) => (i - 1 + flatLen) % flatLen);
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, flatLen]);

  if (!open) return null;

  let idx = 0;
  return (
    <div className="shortcuts-backdrop" role="presentation" onClick={onClose}>
      <div
        className="shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shortcuts-head">
          <h2 id="shortcuts-title">Keyboard Shortcuts</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">
            [x]
          </button>
        </div>
        {groups.map((g) => (
          <div key={g.label} className="shortcuts-group">
            <div className="shortcuts-group-label">{g.label}</div>
            {g.items.map((item) => {
              const i = idx++;
              const active = i === selected;
              return (
                <div
                  key={item.keys}
                  className={"shortcuts-row" + (active ? " selected" : "")}
                >
                  <span className="action-diamond" aria-hidden>
                    ◆
                  </span>
                  <span className="shortcuts-keys">{item.keys}</span>
                  <span className="shortcuts-hint">{item.hint}</span>
                </div>
              );
            })}
          </div>
        ))}
        <div className="shortcuts-footer">↑/↓ nav · Esc close</div>
      </div>
    </div>
  );
}
