"use client";

import {
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type SlashCmd = {
  cmd: string;
  hint: string;
  send: boolean;
  insert?: string;
};

const SLASH_COMMANDS: SlashCmd[] = [
  { cmd: "/help", hint: "this list", send: true },
  { cmd: "/rename", hint: "<title>", send: false, insert: "/rename " },
  { cmd: "/compact", hint: "compact grok context", send: true },
  { cmd: "/rewind", hint: "rewind last turn", send: true },
];

function matchingSlash(value: string): SlashCmd[] {
  if (!value.startsWith("/") || value.includes("\n") || /\s/.test(value)) {
    return [];
  }
  const token = value.toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.cmd.startsWith(token));
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  onSend: (text: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  running?: boolean;
  placeholder?: string;
};

export function Composer({
  value,
  onChange,
  onSend,
  onCancel,
  disabled,
  readOnly,
  running,
  placeholder,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const matches = useMemo(() => matchingSlash(value), [value]);
  const showPalette = matches.length > 0 && !dismissed && !disabled && !readOnly;
  const selected = showPalette
    ? Math.min(selectedIdx, matches.length - 1)
    : 0;

  useEffect(() => {
    setSelectedIdx(0);
  }, [value]);

  useEffect(() => {
    if (!value.startsWith("/") || value.includes("\n") || /\s/.test(value)) {
      setDismissed(false);
    }
  }, [value]);

  function submit() {
    const text = value.trim();
    if (!text || disabled || readOnly) return;
    onSend(text);
  }

  function applySlash(item: SlashCmd) {
    if (item.send) {
      onSend(item.cmd);
      return;
    }
    onChange(item.insert ?? item.cmd + " ");
    setDismissed(true);
    requestAnimationFrame(() => ref.current?.focus());
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (showPalette && matches[selected]) {
      applySlash(matches[selected]);
      return;
    }
    submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (showPalette) {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
      if (running && onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      return;
    }
    if (showPalette && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = matches.length;
      setSelectedIdx((i) => {
        const cur = Math.min(i, n - 1);
        return e.key === "ArrowDown" ? (cur + 1) % n : (cur - 1 + n) % n;
      });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showPalette && matches[selected]) {
        applySlash(matches[selected]);
        return;
      }
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
      {showPalette ? (
        <div className="slash-palette" role="listbox" aria-label="Slash commands">
          {matches.map((item, i) => (
            <button
              key={item.cmd}
              type="button"
              role="option"
              aria-selected={i === selected}
              className={"slash-item" + (i === selected ? " selected" : "")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applySlash(item)}
            >
              <span className="slash-cmd">{item.cmd}</span>
              <span className="slash-hint">{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
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
          placeholder={placeholder ?? "Message grok…  /help"}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {!value && !disabled ? (
          <span className="block-cursor" aria-hidden />
        ) : null}
      </div>
      <div className={"composer-meta" + (running ? " composer-meta-running" : "")}>
        <span>
          {running
            ? "Enter queues · Shift+Enter newline · Esc cancel"
            : "Enter to send · Shift+Enter newline · Esc cancel · /help /compact /rewind"}
        </span>
        <span className="composer-actions">
          {running && onCancel ? (
            <button className="btn composer-cancel" type="button" onClick={onCancel}>
              cancel
            </button>
          ) : null}
          <button className="btn btn-accent composer-send" type="submit" disabled={disabled}>
            send
          </button>
        </span>
      </div>
    </form>
  );
}
