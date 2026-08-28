"use client";

import type { AccessRole, Project, SessionDetail } from "@/lib/types";
import { contextMeter } from "@/lib/format";
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
  role: AccessRole | null;
  onShare?: () => void;
};

export function ChatPane({
  session,
  project,
  draft,
  onDraft,
  onSend,
  sending,
  notice,
  role,
  onShare,
}: Props) {
  const readOnly = role === "read";
  const cwd = session?.projectCwd ?? project?.cwd ?? "";
  const usedIn = session?.tokenUsage?.input ?? 0;
  const usedOut = session?.tokenUsage?.output ?? 0;

  return (
    <section className="pane chat-pane" aria-label="Chat">
      <div className="pane-header chat-header">
        <span className="chat-path">
          {session ? `main ${cwd}` : "no session"}
        </span>
        {session ? (
          <span className={"badge " + session.status}>{session.status}</span>
        ) : null}
        {role && role !== "owner" ? (
          <span className="share-badge">{role === "write" ? "read-write" : "read-only"}</span>
        ) : null}
        {role === "owner" && onShare ? (
          <button type="button" className="btn btn-ghost" onClick={onShare}>
            share
          </button>
        ) : null}
        <span className="chat-meter">
          {session ? `${contextMeter(usedIn, usedOut)} | 4/4 ✓` : ""}
        </span>
      </div>
      {notice ? (
        <div className="notice" role="status">
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
        readOnly={Boolean(session) && readOnly}
      />
    </section>
  );
}
