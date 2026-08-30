"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiResult } from "@/lib/client";
import { can, canAccountWrite, isAdmin } from "@/lib/acl";
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
import {
  IDLE_ACTIVITY,
  bumpActivity,
  type SessionActivity,
} from "@/lib/activity";
import { mergeStreamDetail, stampLastThoughtEnd } from "@/lib/stream-merge";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { ArtifactsPane } from "./ArtifactsPane";
import { ThemeToggle } from "./ThemeToggle";
import { FontSizeToggle } from "./FontSizeToggle";
import { ShortcutsOverlay } from "./ShortcutsOverlay";
import { useTheme } from "./ThemeProvider";
import { SharePanel } from "./SharePanel";
import { UsersPanel } from "./UsersPanel";

const SELECTED_SESSION_KEY = "buildinator:selectedSession";

function readStoredSelectedId(): string | null {
  try {
    const v = localStorage.getItem(SELECTED_SESSION_KEY);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

function writeStoredSelectedId(id: string | null): void {
  try {
    if (id) localStorage.setItem(SELECTED_SESSION_KEY, id);
    else localStorage.removeItem(SELECTED_SESSION_KEY);
  } catch {
    // private mode / quota
  }
}

function helpText(mod: string) {
  return [
    "/help — this list",
    "/rename <title> — rename the current session (write)",
    "/rewind — rewind last turn (write)",
    "/compact — compact grok context (write)",
    "Esc — cancel the in-flight turn (write); queued follow-ups still send",
    "resume / fork live on the session row, not as slashes",
    `keys: ${mod}+j/k sessions · ${mod}+n new · ${mod}+[ ] artifacts · ${mod}+t theme · / composer · ? shortcuts · Esc cancel`,
  ].join("\n");
}


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


function visualSidebarSessions(
  owned: Project[],
  sessions: SessionSummary[],
  search: string,
): SessionSummary[] {
  const q = search.trim().toLowerCase();
  const match = (s: SessionSummary, projectName: string, cwd: string) => {
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      cwd.toLowerCase().includes(q) ||
      projectName.toLowerCase().includes(q)
    );
  };
  const ownedIds = new Set(owned.map((p) => p.id));
  const ordered: SessionSummary[] = [];
  for (const project of owned) {
    for (const s of sessions) {
      if (
        s.projectId === project.id &&
        s.myRole === "owner" &&
        match(s, project.name, project.cwd)
      ) {
        ordered.push(s);
      }
    }
  }
  for (const s of sessions) {
    if (
      s.myRole === "owner" &&
      !ownedIds.has(s.projectId) &&
      match(s, s.projectName, s.projectCwd)
    ) {
      ordered.push(s);
    }
  }
  for (const s of sessions) {
    if (s.myRole !== "owner" && match(s, s.projectName, s.projectCwd)) {
      ordered.push(s);
    }
  }
  return ordered;
}

function isProtectedField(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.id === "composer") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function focusComposer() {
  if (isProtectedField(document.activeElement)) return;
  const el = document.getElementById("composer");
  if (el instanceof HTMLElement) el.focus({ preventScroll: true });
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
  const [activity, setActivity] = useState<SessionActivity>(IDLE_ACTIVITY);
  const queueRef = useRef<string[]>([]);
  const selectedRef = useRef<string | null>(null);
  const sendPromptRef = useRef<(text: string, fromQueue?: boolean) => Promise<void>>(async () => {});
  const onTurnEndedRef = useRef<(sid: string, reappend?: boolean) => void>(() => {});
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [usersOpen, setUsersOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [altMod, setAltMod] = useState("Alt");
  const accountWrite = canAccountWrite(user.role);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === detail?.projectId),
    [projects, detail],
  );
  selectedRef.current = selectedId;

  useEffect(() => {
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    const platform = nav.userAgentData?.platform || navigator.platform || "";
    if (/Mac|iPhone|iPad|iPod/i.test(platform)) setAltMod("Option");
  }, []);

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
    selectedRef.current = id;
    setSelectedId(id);
    writeStoredSelectedId(id);
    requestAnimationFrame(() => focusComposer());
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    if (selectedRef.current !== id) return data.session;
    setDetail(data.session);
    requestAnimationFrame(() => focusComposer());
    return data.session;
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const sid = selectedId;
    let closed = false;
    let es: EventSource | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const applyActivity = (phase: SessionActivity["phase"]) => {
      setActivity((prev) => bumpActivity(prev, phase));
    };
    const handleEvent = (ev: MessageEvent) => {
      if (!ev.data || ev.data === ": connected") return;
      let event: SessionStreamEvent;
      try {
        event = JSON.parse(ev.data) as SessionStreamEvent;
      } catch {
        return;
      }
      if (selectedRef.current !== sid) return;
      if (event.type === "message") {
        applyActivity("writing");
        setDetail((prev) => {
          const stamped = stampLastThoughtEnd(prev, sid);
          return upsertStreamMessage(stamped, sid, event);
        });
      } else if (event.type === "thought") {
        applyActivity("thinking");
        setDetail((prev) =>
          upsertStreamMessage(prev, sid, { id: event.id, role: "thought", content: event.content }),
        );
      } else if (event.type === "tool") {
        applyActivity("working");
        setDetail((prev) => {
          const base = stampLastThoughtEnd(prev, sid);
          if (!base || base.id !== sid) return base;
          const idx = base.toolCalls.findIndex((t) => t.id === event.tool.id);
          const toolCalls = base.toolCalls.slice();
          if (idx >= 0) toolCalls[idx] = event.tool;
          else toolCalls.push(event.tool);
          return { ...base, toolCalls };
        });
      } else if (event.type === "activity") {
        applyActivity(event.phase);
      } else if (event.type === "status") {
        if (event.status === "running") {
          setActivity((prev) =>
            prev.phase === "idle" ? bumpActivity(prev, "thinking") : { ...prev, lastEventAt: Date.now() },
          );
        } else {
          applyActivity("idle");
        }
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, status: event.status } : prev));
      } else if (event.type === "artifact") {
        setDetail((prev) => {
          if (!prev || prev.id !== sid) return prev;
          const a = event.artifact;
          const idx = prev.artifacts.findIndex(
            (x) =>
              x.id === a.id ||
              (x.kind === "file" && a.kind === "file" && x.title === a.title),
          );
          const artifacts = prev.artifacts.slice();
          if (idx >= 0) artifacts[idx] = a;
          else artifacts.push(a);
          return { ...prev, artifacts };
        });
      } else if (event.type === "title") {
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, title: event.title } : prev));
        setSessions((list) =>
          list.map((s) => (s.id === sid ? { ...s, title: event.title } : s)),
        );
      } else if (event.type === "done") {
        applyActivity("idle");
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
        applyActivity("idle");
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
    const refetch = async () => {
      try {
        const data = await api<{ session: SessionDetail }>(`/api/sessions/${sid}`);
        if (selectedRef.current !== sid) return;
        setDetail((prev) => mergeStreamDetail(prev, data.session));
      } catch {
        // live stream still authoritative
      }
    };
    const connect = () => {
      if (closed) return;
      es = new EventSource(`/api/sessions/${sid}/events`);
      es.addEventListener("message", handleEvent);
      es.onopen = () => {
        retry = 0;
        void refetch();
      };
      es.onerror = () => {
        es?.close();
        es = null;
        if (closed) return;
        const delay = Math.min(8000, 500 * 2 ** retry);
        retry += 1;
        retryTimer = setTimeout(connect, delay);
      };
    };
    setActivity(IDLE_ACTIVITY);
    connect();
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [selectedId, loadSession, refreshLists]);


  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await refreshLists();
        if (cancelled) return;
        const stored = readStoredSelectedId();
        const pick =
          stored && list.some((s) => s.id === stored) ? stored : list[0]?.id;
        if (pick) await loadSession(pick);
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
    writeStoredSelectedId(data.session.id);
    setNotice("Created session.");
    requestAnimationFrame(() => focusComposer());
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
    else {
      setActivity(IDLE_ACTIVITY);
      setNotice(null);
    }
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
    setActivity((prev) => bumpActivity(prev, "thinking"));
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
        const titled = data.session.title;
        const statusNext = data.session.status;
        setDetail((prev) =>
          prev && prev.id === sid
            ? { ...prev, title: titled || prev.title, status: statusNext || prev.status }
            : prev,
        );
        setSessions((list) =>
          list.map((row) =>
            row.id === sid
              ? { ...row, title: titled || row.title, status: statusNext || row.status }
              : row,
          ),
        );
        await refreshLists();
        // Prompt response is source of truth if list refresh is still stale.
        if (titled) {
          setDetail((prev) => (prev && prev.id === sid ? { ...prev, title: titled } : prev));
          setSessions((list) =>
            list.map((row) => (row.id === sid ? { ...row, title: titled } : row)),
          );
        }
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
        else {
          setActivity(IDLE_ACTIVITY);
          setNotice(null);
        }
      }
    }
  }
  sendPromptRef.current = sendPrompt;

  async function cancelTurn() {
    const sid = selectedRef.current;
    if (!sid) return;
    if (!accountWrite || !can(role, "write")) return;
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
    writeStoredSelectedId(data.session.id);
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
        setNotice(helpText(altMod));
        break;
      case "rename":
        if (!accountWrite || !can(role, "write")) {
          setNotice("Read-only: cannot rename.");
        } else if (!arg) {
          setNotice("Usage: /rename <title>");
        } else if (selectedId) {
          await rename(selectedId, arg);
        }
        break;
      case "rewind":
        if (!accountWrite || !can(role, "write") || !selectedId) setNotice("Read-only.");
        else await runAction(selectedId, "rewind");
        break;
      case "compact":
        if (!accountWrite || !can(role, "write") || !selectedId) setNotice("Read-only.");
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

  async function runShell(command: string) {
    if (!selectedId) return;
    if (!accountWrite || !can(role, "write")) {
      setNotice("Read-only: cannot run shell.");
      return;
    }
    setDraft("");
    try {
      const data = await api<{ session: SessionDetail }>(`/api/sessions/${selectedId}/shell`, {
        method: "POST",
        body: JSON.stringify({ command }),
      });
      setDetail(data.session);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "shell failed");
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (e.key === "Escape" && shortcutsOpen) {
        e.preventDefault();
        setShortcutsOpen(false);
        requestAnimationFrame(() => focusComposer());
        return;
      }
      if (e.key === "F2" || (e.key === "." && e.ctrlKey && !e.metaKey && !e.altKey)) {
        e.preventDefault();
        setShortcutsOpen((o) => {
          if (o) requestAnimationFrame(() => focusComposer());
          return !o;
        });
        return;
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const composerEmpty =
          !draft.trim() &&
          (target?.id === "composer" || !typing);
        if (typing && target?.id === "composer" && draft) {
          return;
        }
        if (composerEmpty || !typing) {
          e.preventDefault();
          setShortcutsOpen(true);
          return;
        }
      }
      if (e.key === "PageUp" || e.key === "PageDown") {
        const log = document.querySelector(".msg-log");
        if (log instanceof HTMLElement) {
          e.preventDefault();
          const dir = e.key === "PageDown" ? 1 : -1;
          log.scrollBy({ top: dir * Math.max(120, log.clientHeight * 0.9) });
        }
        return;
      }
      if (shortcutsOpen) return;
      const altOnly = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
      if (altOnly) {
        const code = e.code;
        if (code === "KeyJ" || code === "KeyK") {
          e.preventDefault();
          e.stopPropagation();
          const list = visualSidebarSessions(owned, sessions, search);
          if (list.length === 0) return;
          const currentId = selectedRef.current;
          const idx = list.findIndex((s) => s.id === currentId);
          const next =
            code === "KeyJ"
              ? list[Math.min(list.length - 1, idx + 1)]
              : list[Math.max(0, idx <= 0 ? 0 : idx - 1)];
          if (next && next.id !== currentId) {
            void loadSession(next.id);
          }
          return;
        }
        if (code === "KeyN") {
          e.preventDefault();
          e.stopPropagation();
          if (!accountWrite) return;
          const projectId =
            (detail?.myRole === "owner" ? detail.projectId : undefined) ??
            owned[0]?.id;
          if (projectId) void createSession(projectId);
          return;
        }
        if (code === "KeyT") {
          e.preventDefault();
          e.stopPropagation();
          toggleTheme();
          return;
        }
        if (code === "BracketLeft") {
          e.preventDefault();
          e.stopPropagation();
          setCollapsed(true);
          return;
        }
        if (code === "BracketRight") {
          e.preventDefault();
          e.stopPropagation();
          setCollapsed(false);
          return;
        }
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        focusComposer();
        return;
      }
      if (e.key === "Escape") {
        if (typing) return;
        if ((detail?.status === "running" || sending) && accountWrite && can(detail?.myRole, "write")) {
          e.preventDefault();
          void cancelTurn();
        }
        return;
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    sessions,
    selectedId,
    detail,
    owned,
    search,
    sending,
    loadSession,
    toggleTheme,
    accountWrite,
    shortcutsOpen,
    draft,
  ]);

  useEffect(() => {
    function onMouseUp(e: MouseEvent) {
      if (shareOpen || usersOpen || shortcutsOpen) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest("input, textarea:not(#composer), select, [contenteditable='true']")) {
        return;
      }
      if (t.closest(".modal, .shortcuts-modal, .msg-log, [role='menu']")) return;
      if (t.closest(".session-item")) {
        focusComposer();
        return;
      }
      if (t.closest("a, select")) return;
      focusComposer();
    }
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [shareOpen, usersOpen, shortcutsOpen]);

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
        <FontSizeToggle />
        {isAdmin(user.role) ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setUsersOpen(true)}
          >
            users
          </button>
        ) : null}
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
            canWrite={accountWrite}
          />
          <ChatPane
            session={detail}
            project={selectedProject}
            draft={draft}
            onDraft={setDraft}
            onSend={(t) => void onCommand(t)}
            onShell={(c) => void runShell(c)}
            onCancel={() => void cancelTurn()}
            sending={sending}
            notice={notice}
            role={accountWrite ? role : "read"}
            onShare={() => setShareOpen(true)}
            activity={activity}
            overlayOpen={shortcutsOpen}
          />
          <ArtifactsPane
            artifacts={detail?.artifacts ?? []}
            sessionId={detail?.id}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        </div>
      )}
      <footer className="status-bar">
        <span>{altMod}+j/k/n/t/[ ] · ? shortcuts · Esc cancel · /help</span>
        <span className="status-model">
          {detail
            ? modelStatusLine(detail.model, detail.variant, detail.approval)
            : "Grok 4.6 (high) · always-approve"}
        </span>
      </footer>
      <ShortcutsOverlay
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
          requestAnimationFrame(() => focusComposer());
        }}
      />
      <UsersPanel
        open={usersOpen}
        onClose={() => {
          setUsersOpen(false);
          requestAnimationFrame(() => focusComposer());
        }}
      />
      <SharePanel
        open={shareOpen && accountWrite && role === "owner"}
        shares={shares}
        onClose={() => {
          setShareOpen(false);
          requestAnimationFrame(() => focusComposer());
        }}
        onAdd={addShare}
        onRevoke={revokeShare}
        onRevokeAll={revokeAll}
      />
    </div>
  );
}
