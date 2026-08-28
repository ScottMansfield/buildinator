"use client";

import type { ChatMessage, ToolCall } from "@/lib/types";
import { clockTime } from "@/lib/format";

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

export function MessageList({
  messages,
  toolCalls,
}: {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
}) {
  const toolsByTime = [...toolCalls].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  const items: Array<
    | { kind: "msg"; at: string; msg: ChatMessage }
    | { kind: "tool"; at: string; tool: ToolCall }
  > = [
    ...messages.map((msg) => ({ kind: "msg" as const, at: msg.createdAt, msg })),
    ...toolsByTime.map((tool) => ({
      kind: "tool" as const,
      at: tool.createdAt,
      tool,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (items.length === 0) {
    return (
      <div className="empty">No messages yet. Type below or try /help.</div>
    );
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
        if (item.kind === "msg") {
          if (item.msg.role === "action") {
            return (
              <div key={item.msg.id} className="action-line">
                <span className="action-diamond" aria-hidden>
                  ◆
                </span>
                {item.msg.content}
              </div>
            );
          }
          return (
            <article key={item.msg.id} className={"msg " + item.msg.role}>
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
                  <RichText text={item.msg.content} />
                </>
              )}
            </article>
          );
        }
        return (
          <div key={item.tool.id} className="tool-card">
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
      })}
    </div>
  );
}
