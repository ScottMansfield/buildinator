"use client";

import type { Project, SessionDetail } from "@/lib/types";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

type Props = {
  session: SessionDetail | null;
  project: Project | undefined;
  draft: string;
  onDraft: (v: string) => void;
  onSend: (text: string) => void;
  sending: boolean;
  notice: string | null;
};

export function ChatPane({
  session,
  project,
  draft,
  onDraft,
  onSend,
  sending,
  notice,
}: Props) {
  return (
    <section className="pane" aria-label="Chat">
      <div className="pane-header">
        <span style={{ color: "var(--text)" }}>
          {session?.title ?? "no session"}
        </span>
        {session ? (
          <span className={"badge " + session.status} style={{ marginLeft: 8 }}>
            {session.status}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)" }}>
          {project?.cwd ?? ""}
        </span>
      </div>
      {notice ? (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border)",
            color: "var(--accent-2)",
            fontFamily: "var(--mono)",
            fontSize: 12,
          }}
        >
          {notice}
        </div>
      ) : null}
      {session ? (
        <MessageList messages={session.messages} toolCalls={session.toolCalls} />
      ) : (
        <div className="empty">Select a session or create one from the left.</div>
      )}
      <Composer
        value={draft}
        onChange={onDraft}
        onSend={onSend}
        disabled={!session || sending}
      />
    </section>
  );
}
