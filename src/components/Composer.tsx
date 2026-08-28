"use client";

import { FormEvent, KeyboardEvent, useRef } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  disabled,
  readOnly,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function submit() {
    const text = value.trim();
    if (!text || disabled || readOnly) return;
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

  if (readOnly) {
    return (
      <div className="composer composer-readonly" aria-live="polite">
        <span className="composer-gt" aria-hidden>
          &gt;
        </span>
        <span className="composer-readonly-label">read only</span>
      </div>
    );
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-line">
        <span className="composer-gt" aria-hidden>
          &gt;
        </span>
        <label className="sr-only" htmlFor="composer">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          className="textarea composer-input"
          rows={1}
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? "Message grok  /help"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {!value && !disabled ? (
          <span className="block-cursor" aria-hidden />
        ) : null}
      </div>
      <div className="composer-meta">
        <span>Enter to send · Shift+Enter newline · /help /compact /rewind</span>
        <button className="btn btn-accent composer-send" type="submit" disabled={disabled}>
          send
        </button>
      </div>
    </form>
  );
}
