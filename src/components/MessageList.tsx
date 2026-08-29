"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ChatMessage, ToolCall } from "@/lib/types";
import { clockTime } from "@/lib/format";
import { formatElapsed } from "@/lib/activity";
import { MarkdownBody } from "./MarkdownBody";

function RichText({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <div className="msg-body">
      {parts.map((part, i) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={i}>{part.slice(1, -1)}</code>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </div>
  );
}

function toolActionLabel(tool: ToolCall): string {
  const path = tool.input.path || tool.input.pattern || tool.input.command || "";
  switch (tool.name) {
    case "glob_search":
    case "web_search":
      return path ? `Searched ${path}` : "Searched 10 websites";
    case "read_file":
      return path ? `Read ${path}` : "Read file";
    case "write_file":
      return path ? `Wrote ${path}` : "Wrote file";
    case "edit_file":
      return path ? `Edited ${path}` : "Edited file";
    case "bash":
      return path ? `Ran ${path}` : "Ran command";
    default:
      return tool.name.replace(/_/g, " ");
  }
}

function thoughtDurationMs(
  msg: ChatMessage,
  live: boolean,
  now: number,
  fallbackEnd?: number,
): number {
  const start = new Date(msg.createdAt).getTime();
  if (Number.isNaN(start)) return 0;
  let end: number;
  if (msg.endedAt) {
    end = new Date(msg.endedAt).getTime();
  } else if (live) {
    end = now;
  } else if (fallbackEnd && fallbackEnd > start) {
    end = fallbackEnd;
  } else {
    return 0;
  }
  if (Number.isNaN(end) || end < start) return 0;
  return end - start;
}

function ThoughtMessage({
  msg,
  live,
  now,
  fallbackEnd,
}: {
  msg: ChatMessage;
  live: boolean;
  now: number;
  fallbackEnd?: number;
}) {
  const [open, setOpen] = useState(live);
  useEffect(() => {
    setOpen(live);
  }, [live]);
  const ms = thoughtDurationMs(msg, live, now, fallbackEnd);
  const label = live
    ? `Thinking ${formatElapsed(ms)}`
    : ms > 0
      ? `Thought for ${formatElapsed(ms)}`
      : "Thought";
  return (
    <details
      className="thought-block"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="thought-summary">
        <span className="action-diamond" aria-hidden>
          ◆
        </span>
        <span>{label}</span>
      </summary>
      <div className="thought-body">
        <MarkdownBody text={msg.content} />
      </div>
    </details>
  );
}

type Item =
  | { kind: "msg"; at: string; msg: ChatMessage }
  | { kind: "tool"; at: string; tool: ToolCall };

export function MessageList({
  messages,
  toolCalls,
  inFlight = false,
  liveThoughtId = null,
  now = Date.now(),
}: {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  inFlight?: boolean;
  liveThoughtId?: string | null;
  now?: number;
}) {
  const toolsByTime = [...toolCalls].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const items: Item[] = [
    ...messages.map((msg) => ({ kind: "msg" as const, at: msg.createdAt, msg })),
    ...toolsByTime.map((tool) => ({
      kind: "tool" as const,
      at: tool.createdAt,
      tool,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (items.length === 0) {
    return (
      <div className="msg-log">
        <div className="empty">No messages yet. Type below or try /help.</div>
      </div>
    );
  }

  let lastUserIdx = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "msg" && it.msg.role === "user") {
      lastUserIdx = i;
      break;
    }
  }

  function turnWorkedMs(endIdx: number): number | null {
    let userAt: number | null = null;
    for (let i = endIdx; i >= 0; i--) {
      const it = items[i];
      if (it.kind === "msg" && it.msg.role === "user") {
        userAt = new Date(it.msg.createdAt).getTime();
        break;
      }
    }
    if (userAt == null || Number.isNaN(userAt)) return null;
    const endAt = new Date(items[endIdx].at).getTime();
    if (Number.isNaN(endAt) || endAt < userAt) return null;
    return endAt - userAt;
  }

  function nextIsUser(idx: number): boolean {
    const n = items[idx + 1];
    return Boolean(n && n.kind === "msg" && n.msg.role === "user");
  }

  return (
    <div className="msg-log" role="log" aria-live="polite">
      {items.map((item, idx) => {
        const prev = items[idx - 1];
        const showSep =
          item.kind === "msg" &&
          item.msg.role === "user" &&
          idx > 0 &&
          !(prev?.kind === "msg" && prev.msg.role === "user");
        const lastOfThisTurn = idx === items.length - 1 || nextIsUser(idx);
        const thisTurnLive = inFlight && lastUserIdx >= 0 && idx >= lastUserIdx;
        const worked =
          lastOfThisTurn && !thisTurnLive ? turnWorkedMs(idx) : null;

        let body: ReactNode = null;
        if (item.kind === "msg") {
          if (item.msg.role === "system" && /\/rename to set a title/i.test(item.msg.content)) {
            return null;
          }
          if (item.msg.role === "action") {
            body = (
              <div className="action-line">
                <span className="action-diamond" aria-hidden>
                  ◆
                </span>
                {item.msg.content}
              </div>
            );
          } else if (item.msg.role === "thought") {
            const nextAt = items[idx + 1]
              ? new Date(items[idx + 1].at).getTime()
              : undefined;
            const live =
              inFlight &&
              (liveThoughtId === item.msg.id ||
                (!item.msg.endedAt && liveThoughtId === item.msg.id) ||
                (liveThoughtId == null && !item.msg.endedAt && idx === lastThoughtIndex(items)));
            body = (
              <ThoughtMessage
                msg={item.msg}
                live={live}
                now={now}
                fallbackEnd={nextAt}
              />
            );
          } else {
            body = (
              <article className={"msg " + item.msg.role}>
                {showSep ? <div className="turn-sep" /> : null}
                {item.msg.role === "user" ? (
                  <div className="msg-user-row">
                    <span className="msg-gt" aria-hidden>
                      &gt;
                    </span>
                    <RichText text={item.msg.content} />
                    <span className="msg-time">{clockTime(item.msg.createdAt)}</span>
                  </div>
                ) : (
                  <>
                    <div className="msg-role">{item.msg.role}</div>
                    <MarkdownBody text={item.msg.content} />
                  </>
                )}
              </article>
            );
          }
        } else {
          body = (
            <div className="tool-card">
              <div className="action-line">
                <span className="action-diamond" aria-hidden>
                  ◆
                </span>
                {toolActionLabel(item.tool)}
                <span className={"badge " + item.tool.status}>{item.tool.status}</span>
              </div>
              {item.tool.output ? (
                <div className="tool-output">{item.tool.output}</div>
              ) : null}
            </div>
          );
        }

        const key = item.kind === "msg" ? item.msg.id : item.tool.id;
        return (
          <div key={key}>
            {body}
            {worked != null && worked >= 500 ? (
              <div className="worked-line">Worked for {formatElapsed(worked)}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function lastThoughtIndex(items: Item[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.kind === "msg" && it.msg.role === "thought") return i;
  }
  return -1;
}
