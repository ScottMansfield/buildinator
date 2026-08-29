"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiResult } from "@/lib/client";
import { can } from "@/lib/acl";
import { modelStatusLine } from "@/lib/format";
import type {
  Project,
  SessionDetail,
  SessionShare,
  SessionStreamEvent,
  SessionSummary,
  SessionUser,
  ShareRole,
} from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { ArtifactsPane } from "./ArtifactsPane";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./ThemeProvider";
import { SharePanel } from "./SharePanel";

const HELP = [
  "/help — this list",
  "/rename <title> — rename the current session (write)",
  "/rewind — rewind last turn (write)",
  "/compact — compact grok context (write)",
  "Esc — cancel the in-flight turn (write); queued follow-ups still send",
  "resume / fork live on the session row, not as slashes",
  "keys: j/k sessions · n new · [ ] artifacts · t theme · / composer · Esc cancel",
].join("\n");


function upsertStreamMessage(
  prev: SessionDetail | null,
  sid: string,
  msg: { id: string; role: "assistant" | "thought"; content: string },
): SessionDetail | null {
  if (!prev || prev.id !== sid) return prev;
  const idx = prev.messages.findIndex((m) => m.id === msg.id);
  if (idx >= 0) {
    const messages = prev.messages.slice();
    messages[idx] = { ...messages[idx], content: msg.content };
    return { ...prev, messages };
  }
  return {
    ...prev,
    messages: [
      ...prev.messages,
      {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

type Props = { user: SessionUser };

export function AppShell({ user }: Props) {
  const { toggle: toggleTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [owned, setOwned] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const queueRef = useRef<string[]>([]);
  const selectedRef = useRef<string | null>(null);
  const sendPromptRef = useRef<(text: string, fromQueue?: boolean) => Promise<void>>(async () => {});
  const onTurnEndedRef = useRef<(sid: string, reappend?: boolean) => void>(() => {});
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === detail?.projectId),
    [projects, detail],
  );
  selectedRef.current = selectedId;

  const role = detail?.myRole ?? null;

  const refreshLists = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<{ projects: Project[]; owned: Project[] }>("/api/projects"),
      api<{ sessions: SessionSummary[] }>("/api/sessions"),
    ]);
    setProjects(p.projects);
    setOwned(p.owned);
    setSessions(s.sessions);
    return s.sessions;
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    setDetail(data.session);
    setSelectedId(id);
    return data.session;
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const sid = selectedId;
    const es = new EventSource(`/api/sessions/${sid}/events`);
    es.onmessage = (ev) => {
      if (!ev.data) return;
      let event: SessionStreamEvent;
      try {
        event = JSON.parse(ev.data) as SessionStreamEvent;
      } catch {
        return;
      }
      if (selectedRef.current !== sid) return;
      if (event.type === "message") {
        setDetail((prev) => upsertStreamMessage(prev, sid, event));
      } else if (event.type === "thought") {
        setDetail((prev) =>
          upsertStreamMessage(prev, sid, { id: event.id, role: "thought", content: event.content }),
        );
      } else if (event.type === "tool") {
        setDetail((prev) => {
          if (!prev || prev.id !== sid) return prev;
          const idx = prev.toolCalls.findIndex((t) => t.id === event.tool.id);
          const toolCalls = prev.toolCalls.slice();
          if (idx >= 0) toolCalls[idx] = event.tool;
          else toolCalls.push(event.tool);
          return { ...prev, toolCalls };
        });
      } else if (event.type === "status") {
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, status: event.status } : prev));
      } else if (event.type === "title") {
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, title: event.title } : prev));
        setSessions((list) =>
          list.map((s) => (s.id === sid ? { ...s, title: event.title } : s)),
        );
      } else if (event.type === "done") {
        void (async () => {
          try {
            await loadSession(sid);
            await refreshLists();
          } catch {
            // keep live state if reconcile fails
          }
          if (sendingRef.current) onTurnEndedRef.current(sid, true);
        })();
      } else if (event.type === "error") {
        setNotice(event.message);
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, status: "error" } : prev));
        void (async () => {
          try {
            await loadSession(sid);
            await refreshLists();
          } catch {
            // keep live state if reconcile fails
          }
          if (sendingRef.current) onTurnEndedRef.current(sid, true);
        })();
      }
    };
    return () => {
      es.close();
    };
  }, [selectedId, loadSession, refreshLists]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await refreshLists();
        if (cancelled) return;
        const first = list[0];
        if (first) await loadSession(first.id);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "load failed");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshLists, loadSession]);

  async function createProject(name: string) {
    try {
      const data = await api<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await refreshLists();
      await createSession(data.project.id);
      setNotice(`Created project ${data.project.name}`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "create project failed");
    }
  }

  async function createSession(projectId: string) {
    const data = await api<{ session: SessionDetail }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    await refreshLists();
    setDetail(data.session);
    setSelectedId(data.session.id);
    setNotice("Created session.");
  }

  async function rename(id: string, title: string) {
    await api(`/api/sessions/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await refreshLists();
    if (selectedId === id) await loadSession(id);
    setNotice(`Renamed to ${title}`);
  }

  function appendLocal(sid: string, text: string, label: string) {
    const now = new Date().toISOString();
    setDetail((prev) => {
      if (!prev || prev.id !== sid) return prev;
      return {
        ...prev,
        status: "running",
        messages: [
          ...prev.messages,
          { id: crypto.randomUUID(), role: "user", content: text, createdAt: now },
          { id: crypto.randomUUID(), role: "action", content: label, createdAt: now },
        ],
      };
    });
  }

  function drainQueue(sid: string, reappend = false) {
    const leftover = [...queueRef.current];
    if (reappend && leftover.length && selectedRef.current === sid) {
      const now = new Date().toISOString();
      setDetail((prev) => {
        if (!prev || prev.id !== sid) return prev;
        return {
          ...prev,
          messages: [
            ...prev.messages,
            ...leftover.flatMap((q) => [
              { id: crypto.randomUUID(), role: "user" as const, content: q, createdAt: now },
              { id: crypto.randomUUID(), role: "action" as const, content: "queued", createdAt: now },
            ]),
          ],
        };
      });
    }
    sendingRef.current = false;
    setSending(false);
    const next = queueRef.current.shift();
    if (next) void sendPromptRef.current(next, true);
    else setNotice(null);
  }
  onTurnEndedRef.current = (sid: string, reappend = false) => drainQueue(sid, reappend);

  async function sendPrompt(text: string, fromQueue = false) {
    const sid = selectedRef.current;
    if (!sid) return;
    if (sendingRef.current) {
      queueRef.current.push(text);
      appendLocal(sid, text, "queued");
      setNotice(`queued (${queueRef.current.length})`);
      return;
    }
    sendingRef.current = true;
    setSending(true);
    if (!fromQueue) appendLocal(sid, text, "grok is running…");
    else {
      setDetail((prev) => {
        if (!prev || prev.id !== sid) return prev;
        const msgs = prev.messages.map((m) =>
          m.role === "action" && m.content === "queued" && prev.messages[prev.messages.indexOf(m) - 1]?.content === text
            ? { ...m, content: "grok is running…" }
            : m,
        );
        return { ...prev, status: "running", messages: msgs };
      });
    }
    setNotice(queueRef.current.length ? `grok running · ${queueRef.current.length} queued` : null);
    let waitForStream = false;
    try {
      const { status, data } = await apiResult<{ session: SessionDetail }>(
        `/api/sessions/${sid}/prompt`,
        { method: "POST", body: JSON.stringify({ prompt: text }) },
      );
      if (status === 202) {
        waitForStream = true;
        await refreshLists();
        return;
      }
      const leftover = queueRef.current;
      const now = new Date().toISOString();
      setDetail({
        ...data.session,
        messages: leftover.length
          ? [
              ...data.session.messages,
              ...leftover.flatMap((q) => [
                { id: crypto.randomUUID(), role: "user" as const, content: q, createdAt: now },
                { id: crypto.randomUUID(), role: "action" as const, content: "queued", createdAt: now },
              ]),
            ]
          : data.session.messages,
      });
      await refreshLists();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "send failed");
    } finally {
      if (!waitForStream) {
        sendingRef.current = false;
        setSending(false);
        const next = queueRef.current.shift();
        if (next) void sendPrompt(next, true);
        else setNotice(null);
      }
    }
  }
  sendPromptRef.current = sendPrompt;

  async function cancelTurn() {
    const sid = selectedRef.current;
    if (!sid) return;
    if (!can(role, "write")) return;
    try {
      await api(`/api/sessions/${sid}/actions`, {
        method: "POST",
        body: JSON.stringify({ type: "cancel" }),
      });
      setNotice("Cancelled turn");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "cancel failed");
    }
  }

  async function runAction(id: string, type: "fork" | "resume" | "compact" | "rewind") {
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}/actions`, {
      method: "POST",
      body: JSON.stringify({ type }),
    });
    await refreshLists();
    setDetail(data.session);
    setSelectedId(data.session.id);
    setNotice(
      type === "fork"
        ? `Forked as ${data.session.title}`
        : type === "resume"
          ? "Resumed session."
          : type === "compact"
            ? "Compacted grok context."
            : "Rewound last turn.",
    );
  }

  async function deleteSession(id: string) {
    await api(`/api/sessions/${id}`, { method: "DELETE" });
    const list = await refreshLists();
    if (selectedId === id) {
      const next = list[0];
      if (next) await loadSession(next.id);
      else {
        setDetail(null);
        setSelectedId(null);
      }
    }
    setNotice("Deleted session.");
  }

  async function addShare(username: string, shareRole: ShareRole) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/shares`, {
      method: "POST",
      body: JSON.stringify({ username, role: shareRole }),
    });
    await loadSession(selectedId);
    await refreshLists();
  }

  async function revokeShare(shareId: string) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/shares`, {
      method: "DELETE",
      body: JSON.stringify({ shareId }),
    });
    await loadSession(selectedId);
  }

  async function revokeAll() {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}/shares`, {
      method: "POST",
      body: JSON.stringify({ revokeAll: true }),
    });
    await loadSession(selectedId);
  }

  async function onCommand(text: string) {
    const trimmed = text.trim();
    if (!trimmed.startsWith("/")) {
      setDraft("");
      await sendPrompt(trimmed);
      return;
    }
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    setDraft("");
    switch (cmd) {
      case "help":
        setNotice(HELP);
        break;
      case "rename":
        if (!can(role, "write")) {
          setNotice("Read-only: cannot rename.");
        } else if (!arg) {
          setNotice("Usage: /rename <title>");
        } else if (selectedId) {
          await rename(selectedId, arg);
        }
        break;
      case "rewind":
        if (!can(role, "write") || !selectedId) setNotice("Read-only.");
        else await runAction(selectedId, "rewind");
        break;
      case "compact":
        if (!can(role, "write") || !selectedId) setNotice("Read-only.");
        else await runAction(selectedId, "compact");
        break;
      case "resume":
      case "fork":
        setNotice(`/${cmd} lives on the session row, not in the composer.`);
        break;
      case "new":
        setNotice("Use the New session button and pick a project you own.");
        break;
      default:
        setNotice(`Unknown command /${cmd}. Try /help.`);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (e.key === "t" && !typing) {
        e.preventDefault();
        toggleTheme();
        return;
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        document.getElementById("composer")?.focus();
        return;
      }
      if (e.key === "Escape") {
        if (typing) return;
        if ((detail?.status === "running" || sending) && can(detail?.myRole, "write")) {
          e.preventDefault();
          void cancelTurn();
        }
        return;
      }
      if (typing) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        if (sessions.length === 0) return;
        const idx = sessions.findIndex((s) => s.id === selectedId);
        const next =
          e.key === "j"
            ? sessions[Math.min(sessions.length - 1, idx + 1)]
            : sessions[Math.max(0, idx <= 0 ? 0 : idx - 1)];
        if (next) void loadSession(next.id);
      }
      if (e.key === "n") {
        e.preventDefault();
        const projectId =
          (detail?.myRole === "owner" ? detail.projectId : undefined) ??
          owned[0]?.id;
        if (projectId) void createSession(projectId);
      }
      if (e.key === "[") {
        e.preventDefault();
        setCollapsed(true);
      }
      if (e.key === "]") {
        e.preventDefault();
        setCollapsed(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    sessions,
    selectedId,
    detail,
    owned,
    sending,
    loadSession,
    toggleTheme,
  ]);

  const shares: SessionShare[] = detail?.shares ?? [];

  return (
    <div className="shell">
      <header className="chrome">
        <div className="chrome-title">buildinator</div>
        <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>
          grok session manager
        </span>
        <div className="chrome-spacer" />
        <ThemeToggle />
        <span style={{ color: "var(--muted)" }}>{user.username}</span>
        <button type="button" className="btn btn-ghost" onClick={() => void logout()}>
          log out
        </button>
      </header>
      {loadError ? (
        <div className="empty" role="alert">
          {loadError}
        </div>
      ) : (
        <div className={"panes" + (collapsed ? " artifacts-collapsed" : "")}>
          <Sidebar
            projects={projects}
            owned={owned}
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => void loadSession(id)}
            onNew={(id) => void createSession(id)}
            onNewProject={(name) => void createProject(name)}
            onRename={(id, title) => void rename(id, title)}
            onResume={(id) => void runAction(id, "resume")}
            onFork={(id) => void runAction(id, "fork")}
            onShare={(id) => {
              void loadSession(id).then(() => setShareOpen(true));
            }}
            onDelete={(id) => void deleteSession(id)}
            search={search}
            onSearch={setSearch}
          />
          <ChatPane
            session={detail}
            project={selectedProject}
            draft={draft}
            onDraft={setDraft}
            onSend={(t) => void onCommand(t)}
            onCancel={() => void cancelTurn()}
            sending={sending}
            notice={notice}
            role={role}
            onShare={() => setShareOpen(true)}
          />
          <ArtifactsPane
            artifacts={detail?.artifacts ?? []}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        </div>
      )}
      <footer className="status-bar">
        <span>j/k n [ ] t · Esc cancel · /help</span>
        <span className="status-model">
          {detail
            ? modelStatusLine(detail.model, detail.variant, detail.approval)
            : "Grok 4.6 (high) · always-approve"}
        </span>
      </footer>
      <SharePanel
        open={shareOpen && role === "owner"}
        shares={shares}
        onClose={() => setShareOpen(false)}
        onAdd={addShare}
        onRevoke={revokeShare}
        onRevokeAll={revokeAll}
      />
    </div>
  );
}
