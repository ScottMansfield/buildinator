"use client";

import { FormEvent, KeyboardEvent, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      style={{
        padding: 10,
        borderTop: "1px solid var(--border)",
        background: "var(--bg-elev)",
      }}
    >
      <label className="sr-only" htmlFor="composer">
        Message
      </label>
      <textarea
        id="composer"
        ref={ref}
        className="textarea"
        rows={3}
        value={value}
        disabled={disabled}
        placeholder={placeholder ?? "Message grok\u2026  /help"}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 8,
          color: "var(--muted)",
          fontSize: 12,
        }}
      >
        <span>Enter to send \u00b7 Shift+Enter newline \u00b7 / for commands</span>
        <button className="btn btn-accent" type="submit" disabled={disabled}>
          send
        </button>
      </div>
    </form>
  );
}
