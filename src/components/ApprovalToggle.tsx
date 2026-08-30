"use client";

import { useEffect, useRef, useState } from "react";
import {
  APPROVAL_LABELS,
  APPROVALS,
  isApproval,
  type ApprovalMode,
} from "@/lib/session-prefs";

type Props = {
  value: string;
  onChange: (next: ApprovalMode) => void;
  disabled?: boolean;
};

export function ApprovalToggle({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const current: ApprovalMode = isApproval(value) ? value : "always-approve";

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
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Permission mode"
        title="Permission mode (UI + sqlite; process --always-approve is unchanged)"
        disabled={disabled}
      >
        mode: {APPROVAL_LABELS[current]}
      </button>
      {open && !disabled ? (
        <div className="theme-menu" role="listbox" aria-label="Permission mode">
          {APPROVALS.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={current === id}
              className={"theme-option" + (current === id ? " selected" : "")}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              {APPROVAL_LABELS[id]}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
