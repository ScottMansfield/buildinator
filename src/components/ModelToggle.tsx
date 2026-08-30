"use client";

import { useEffect, useRef, useState } from "react";
import { MODELS, VARIANTS, isModel, isVariant } from "@/lib/session-prefs";

type Props = {
  model: string;
  variant: string;
  onChange: (next: { model?: string; variant?: string }) => void;
  disabled?: boolean;
};

export function ModelToggle({ model, variant, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const modelId = isModel(model) ? model : model || "grok-4.6";
  const effort = isVariant(variant) ? variant : "high";

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
        aria-label="Model and effort"
        title="Model and reasoning effort"
        disabled={disabled}
      >
        model: {modelId} ({effort})
      </button>
      {open && !disabled ? (
        <div className="theme-menu" role="listbox" aria-label="Model and effort">
          <div className="theme-group">
            <div className="theme-group-label">model</div>
            {MODELS.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={modelId === id}
                className={"theme-option" + (modelId === id ? " selected" : "")}
                onClick={() => {
                  onChange({ model: id });
                  setOpen(false);
                }}
              >
                {id}
              </button>
            ))}
          </div>
          <div className="theme-group">
            <div className="theme-group-label">effort</div>
            {VARIANTS.map((id) => (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={effort === id}
                className={"theme-option" + (effort === id ? " selected" : "")}
                onClick={() => {
                  onChange({ variant: id });
                  setOpen(false);
                }}
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
