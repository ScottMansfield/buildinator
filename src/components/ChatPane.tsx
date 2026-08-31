"use client";

import { useEffect, useRef, useState } from "react";
import type { AccessRole, Project, SessionDetail } from "@/lib/types";
import { contextMeter } from "@/lib/format";
import {
  formatElapsed,
  formatUpdatedAgo,
  resolveActivity,
  type ActivityPhase,
  type PhaseCrumb,
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
  onShell?: (command: string) => void;
  onCancel?: () => void;
  sending: boolean;
  notice: string | null;
  role: AccessRole | null;
  onShare?: () => void;
  activity: SessionActivity;
  overlayOpen?: boolean;
  queue?: string[];
  onDropQueued?: (index: number) => void;
  onClearQueue?: () => void;
  findOpen?: boolean;
  findQuery?: string;
  onFindQuery?: (q: string) => void;
  onFindOpen?: (open: boolean) => void;
};

function lastUserMessageId(session: SessionDetail | null): string | null {
  if (!session) return null;
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === "user") return session.messages[i].id;
  }
  return null;
}

export function ChatPane({
  session,
  project,
  draft,
  onDraft,
  onSend,
  onShell,
  onCancel,
  sending,
  notice,
  role,
  onShare,
  activity,
  overlayOpen,
  queue = [],
  onDropQueued,
  onClearQueue,
  findOpen = false,
  findQuery = "",
  onFindQuery,
  onFindOpen,
}: Props) {
  const readOnly = role === "read";
  const resolved = resolveActivity(session, sending, activity);
  const running = resolved.phase !== "idle";
  const canCancel = Boolean(onCancel && running && role && role !== "read");
  const cwd = session?.projectCwd ?? project?.cwd ?? "";
  const usedIn = session?.tokenUsage?.input ?? 0;
  const usedOut = session?.tokenUsage?.output ?? 0;
  const [now, setNow] = useState(() => Date.now());
  const [crumbs, setCrumbs] = useState<PhaseCrumb[]>([]);
  const prevPhaseRef = useRef(resolved.phase);
  const prevStartRef = useRef(resolved.phaseStartedAt);
  const crumbKeyRef = useRef("");
  const lastUserId = lastUserMessageId(session);
  const [outputOnly, setOutputOnly] = useState(false);
  const [findIndex, setFindIndex] = useState(0);

  useEffect(() => {
    try {
      setOutputOnly(localStorage.getItem("buildinator-output-only") === "1");
    } catch {
      // ignore
    }
  }, []);

  function toggleOutputOnly() {
    setOutputOnly((v) => {
      const next = !v;
      try {
        localStorage.setItem("buildinator-output-only", next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  }

  useEffect(() => {
    setFindIndex(0);
  }, [session?.id]);

  useEffect(() => {
    if (!findOpen) return;
    const el = document.getElementById("find-query");
    if (el instanceof HTMLInputElement) {
      requestAnimationFrame(() => el.focus());
    }
  }, [findOpen]);

  useEffect(() => {
    setCrumbs([]);
    crumbKeyRef.current = "";
    prevPhaseRef.current = resolved.phase;
    prevStartRef.current = resolved.phaseStartedAt;
    // Reset history on session or new user turn — not on every phase tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- lastUserId/session id only
  }, [session?.id, lastUserId]);

  useEffect(() => {
    const prev = prevPhaseRef.current;
    const prevStart = prevStartRef.current;
    if (prev !== "idle" && prev !== resolved.phase) {
      const key = `${prev}:${prevStart}`;
      if (crumbKeyRef.current !== key) {
        crumbKeyRef.current = key;
        const ms = Math.max(0, Date.now() - (prevStart || Date.now()));
        if (ms >= 150) {
          setCrumbs((c) => [...c, { id: key, phase: prev as ActivityPhase, ms }]);
        }
      }
    }
    prevPhaseRef.current = resolved.phase;
    prevStartRef.current = resolved.phaseStartedAt;
  }, [resolved.phase, resolved.phaseStartedAt]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  const elapsed = running
    ? formatElapsed(now - (resolved.phaseStartedAt || now))
    : null;
  const updated =
    running && resolved.lastEventAt
      ? formatUpdatedAgo(now - resolved.lastEventAt)
      : null;
  const chipClass = resolved.phase;
  const chipLabel =
    resolved.phase === "idle" ? "idle" : `${resolved.phase} ${elapsed}`;
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
          <button
            type="button"
            className="btn btn-ghost"
            onClick={toggleOutputOnly}
            aria-pressed={outputOnly}
            title={outputOnly ? "Showing user + assistant output only" : "Showing all transcript lines"}
          >
            {outputOnly ? "output only" : "all messages"}
          </button>
        ) : null}
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
        <>
          {findOpen ? (
            <FindBar
              query={findQuery}
              onQuery={(q) => {
                onFindQuery?.(q);
                setFindIndex(0);
              }}
              matchIndex={findIndex}
              onMatchIndex={setFindIndex}
              messages={session.messages}
              toolCalls={outputOnly ? [] : session.toolCalls}
              includeTools={!outputOnly}
              onClose={() => {
                onFindOpen?.(false);
                onFindQuery?.("");
                setFindIndex(0);
                requestAnimationFrame(() => {
                  const el = document.getElementById("composer");
                  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
                });
              }}
            />
          ) : null}
          <MessageList
            messages={
              outputOnly
                ? session.messages.filter((m) => m.role === "user" || m.role === "assistant")
                : session.messages
            }
            toolCalls={outputOnly ? [] : session.toolCalls}
            inFlight={running || sending || toolsInFlight(session.toolCalls)}
            liveThoughtId={liveThought}
            now={now}
            crumbs={outputOnly ? [] : crumbs}
            activity={activity}
            findQuery={findOpen ? findQuery : ""}
            findIndex={findIndex}
          />
          <div className={"live-status " + chipClass} role="status" aria-live="polite">
            <span className="action-diamond" aria-hidden>
              ◆
            </span>
            <span className="live-status-label">{chipLabel}</span>
            {updated ? <span className="activity-updated">{updated}</span> : null}
          </div>
        </>
      ) : (
        <div className="empty">Select a session or create one from the left.</div>
      )}
      {queue.length > 0 ? (
        <div className="prompt-queue" aria-label="Queued prompts">
          <div className="prompt-queue-head">
            queued {queue.length}
            {onClearQueue ? (
              <button type="button" className="btn-quiet" onClick={onClearQueue}>
                clear
              </button>
            ) : null}
          </div>
          {queue.map((item, i) => (
            <div key={`${i}-${item.slice(0, 24)}`} className="prompt-queue-item">
              <span className="prompt-queue-text">{item}</span>
              {onDropQueued ? (
                <button
                  type="button"
                  className="btn-quiet"
                  aria-label="Drop queued prompt"
                  onClick={() => onDropQueued(i)}
                >
                  drop
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <Composer
        value={draft}
        onChange={onDraft}
        onSend={onSend}
        onShell={onShell}
        onCancel={canCancel ? onCancel : undefined}
        disabled={!session}
        readOnly={Boolean(session) && readOnly}
        running={canCancel}
        history={(session?.messages ?? []).filter((m) => m.role === "user").map((m) => m.content)}
        historyKey={session?.id}
        overlayOpen={overlayOpen}
      />
    </section>
  );
}


function countMatches(hay: string, needle: string): number {
  if (!needle) return 0;
  const q = needle.toLowerCase();
  const h = hay.toLowerCase();
  let n = 0;
  let from = 0;
  while (from <= h.length) {
    const i = h.indexOf(q, from);
    if (i < 0) break;
    n += 1;
    from = i + Math.max(q.length, 1);
  }
  return n;
}

function FindBar({
  query,
  onQuery,
  matchIndex,
  onMatchIndex,
  messages,
  toolCalls,
  includeTools,
  onClose,
}: {
  query: string;
  onQuery: (q: string) => void;
  matchIndex: number;
  onMatchIndex: (n: number) => void;
  messages: SessionDetail["messages"];
  toolCalls: SessionDetail["toolCalls"];
  includeTools: boolean;
  onClose: () => void;
}) {
  const total =
    messages.reduce((n, m) => n + countMatches(m.content, query), 0) +
    (includeTools
      ? toolCalls.reduce(
          (n, t) => n + countMatches(`${t.name} ${t.output ?? ""}`, query),
          0,
        )
      : 0);
  const idx = total === 0 ? 0 : ((matchIndex % total) + total) % total;

  function next(dir: number) {
    if (total === 0) return;
    onMatchIndex(idx + dir);
  }

  return (
    <div className="find-bar">
      <label className="sr-only" htmlFor="find-query">
        Find in transcript
      </label>
      <input
        id="find-query"
        className="input"
        value={query}
        placeholder="find in transcript"
        autoComplete="off"
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            onClose();
            return;
          }
          if (e.key === "Enter") {
            e.preventDefault();
            next(e.shiftKey ? -1 : 1);
          }
        }}
      />
      <span className="find-count">
        {query ? (total ? `${idx + 1}/${total}` : "0/0") : ""}
      </span>
      <button type="button" className="btn btn-ghost" onClick={() => next(-1)} disabled={!total}>
        prev
      </button>
      <button type="button" className="btn btn-ghost" onClick={() => next(1)} disabled={!total}>
        next
      </button>
      <button type="button" className="btn btn-ghost" onClick={onClose}>
        close
      </button>
    </div>
  );
}
