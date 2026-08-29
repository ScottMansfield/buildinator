"use client";

import { useEffect, useState } from "react";
import type { AccessRole, Project, SessionDetail } from "@/lib/types";
import { contextMeter } from "@/lib/format";
import {
  formatElapsed,
  formatUpdatedAgo,
  resolveActivity,
  type SessionActivity,
} from "@/lib/activity";
import { toolsInFlight } from "@/lib/stream-merge";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

type Props = {
  session: SessionDetail | null;
  project: Project | undefined;
  draft: string;
  onDraft: (v: string) => void;
  onSend: (text: string) => void;
  onCancel?: () => void;
  sending: boolean;
  notice: string | null;
  role: AccessRole | null;
  onShare?: () => void;
  activity: SessionActivity;
};

export function ChatPane({
  session,
  project,
  draft,
  onDraft,
  onSend,
  onCancel,
  sending,
  notice,
  role,
  onShare,
  activity,
}: Props) {
  const readOnly = role === "read";
  const resolved = resolveActivity(session, sending, activity);
  const running = resolved.phase !== "idle";
  const canCancel = Boolean(onCancel && running && role && role !== "read");
  const cwd = session?.projectCwd ?? project?.cwd ?? "";
  const usedIn = session?.tokenUsage?.input ?? 0;
  const usedOut = session?.tokenUsage?.output ?? 0;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running
    ? formatElapsed(now - (resolved.phaseStartedAt || now))
    : null;
  const updated =
    running && resolved.lastEventAt
      ? formatUpdatedAgo(now - resolved.lastEventAt)
      : null;
  const chipClass =
    session?.status === "error" && !running
      ? "error"
      : resolved.phase;
  const chipLabel =
    session?.status === "error" && !running
      ? "error"
      : resolved.phase === "idle"
        ? "idle"
        : `${resolved.phase} ${elapsed}`;
  const liveThought =
    resolved.phase === "thinking"
      ? [...(session?.messages ?? [])].reverse().find((m) => m.role === "thought")?.id ??
        null
      : null;

  return (
    <section className="pane chat-pane" aria-label="Chat">
      <div className="pane-header chat-header">
        <span className="chat-path">
          {session ? `main ${cwd}` : "no session"}
        </span>
        {session ? (
          <span className={"activity-chip " + chipClass} title={updated ?? undefined}>
            {chipLabel}
            {updated ? <span className="activity-updated">{updated}</span> : null}
          </span>
        ) : null}
        {canCancel ? (
          <button type="button" className="btn btn-ghost composer-cancel" onClick={onCancel}>
            cancel
          </button>
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
        <MessageList
          messages={session.messages}
          toolCalls={session.toolCalls}
          inFlight={running || sending || toolsInFlight(session.toolCalls)}
          liveThoughtId={liveThought}
          now={now}
        />
      ) : (
        <div className="empty">Select a session or create one from the left.</div>
      )}
      <Composer
        value={draft}
        onChange={onDraft}
        onSend={onSend}
        onCancel={canCancel ? onCancel : undefined}
        disabled={!session}
        readOnly={Boolean(session) && readOnly}
        running={canCancel}
      />
    </section>
  );
}
