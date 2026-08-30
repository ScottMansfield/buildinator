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
  onShell?: (command: string) => void;
  onCancel?: () => void;
  disabled?: boolean;
  readOnly?: boolean;
  running?: boolean;
  placeholder?: string;
  history?: string[];
  historyKey?: string;
  overlayOpen?: boolean;
};

export function Composer({
  value,
  onChange,
  onSend,
  onShell,
  onCancel,
  disabled,
  readOnly,
  running,
  placeholder,
  history = [],
  historyKey,
  overlayOpen = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [dismissed, setDismissed] = useState(false);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [shellMode, setShellMode] = useState(false);
  const [histIdx, setHistIdx] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const draftRef = useRef("");
  const matches = useMemo(() => matchingSlash(value), [value]);
  const showPalette =
    matches.length > 0 && !dismissed && !disabled && !readOnly && !shellMode;
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

  useEffect(() => {
    setHistIdx(null);
    setShellMode(false);
  }, [historyKey]);

  function submit() {
    const text = value.trim();
    if (disabled || readOnly) return;
    if (shellMode) {
      if (!text || !onShell) return;
      onShell(text);
      onChange("");
      setHistIdx(null);
      return;
    }
    if (!text) return;
    onSend(text);
    setHistIdx(null);
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

  function typeValue(next: string) {
    setHistIdx(null);
    onChange(next);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") {
      if (showPalette) {
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        return;
      }
      if (shellMode && !value) {
        e.preventDefault();
        e.stopPropagation();
        setShellMode(false);
        return;
      }
      if (running && onCancel) {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
      return;
    }
    if (e.key === "!" && !value && !shellMode && !showPalette && !overlayOpen) {
      e.preventDefault();
      setShellMode(true);
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
    if (overlayOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      return;
    }
    if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !showPalette) {
      const el = ref.current;
      const atStart =
        !value ||
        (el != null && el.selectionStart === 0 && el.selectionEnd === 0);
      if (e.key === "ArrowUp") {
        if (!atStart || history.length === 0) return;
        e.preventDefault();
        if (histIdx === null) {
          draftRef.current = value;
          const i = history.length - 1;
          setHistIdx(i);
          onChange(history[i]);
        } else if (histIdx > 0) {
          const i = histIdx - 1;
          setHistIdx(i);
          onChange(history[i]);
        }
        return;
      }
      if (histIdx === null) return;
      e.preventDefault();
      if (histIdx < history.length - 1) {
        const i = histIdx + 1;
        setHistIdx(i);
        onChange(history[i]);
      } else {
        setHistIdx(null);
        onChange(draftRef.current);
      }
      return;
    }
    if (e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      if (showPalette && matches[selected]) {
        applySlash(matches[selected]);
        return;
      }
      submit();
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
        <span className={"composer-gt" + (shellMode ? " shell" : "")} aria-hidden>
          {shellMode ? "!" : ">"}
        </span>
        <label className="sr-only" htmlFor="composer">
          Message
        </label>
        <textarea
          id="composer"
          ref={ref}
          className="textarea composer-input"
          rows={1}
          autoFocus
          value={value}
          disabled={disabled}
          placeholder={
            placeholder ??
            (shellMode ? "shell command in sandbox" : "Message grok…  /help")
          }
          onChange={(e) => typeValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {!value && !disabled && focused ? (
          <span className="block-cursor" aria-hidden />
        ) : null}
      </div>
      <div className={"composer-meta" + (running ? " composer-meta-running" : "")}>
        <span>
          {shellMode
            ? "Enter runs in sandbox · Esc exits shell"
            : running
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
