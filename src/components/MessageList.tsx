"use client";

import type { ChatMessage, ToolCall } from "@/lib/types";

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
    <div style={{ overflow: "auto", flex: 1 }} role="log" aria-live="polite">
      {items.map((item) =>
        item.kind === "msg" ? (
          <article key={item.msg.id} className={"msg " + item.msg.role}>
            <div className="msg-role">{item.msg.role}</div>
            <RichText text={item.msg.content} />
          </article>
        ) : (
          <div key={item.tool.id} className="tool-card">
            <header>
              <span>tool \u00b7 {item.tool.name}</span>
              <span className={"badge " + item.tool.status}>
                {item.tool.status}
              </span>
            </header>
            <div>
              {Object.entries(item.tool.input).map(([k, v]) => (
                <div key={k}>
                  {k}: {v}
                </div>
              ))}
              {item.tool.output ? (
                <div style={{ marginTop: 6, color: "var(--muted)" }}>
                  {item.tool.output}
                </div>
              ) : null}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
