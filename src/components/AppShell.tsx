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
import { mergeOneTool, mergeStreamDetail, stampLastThoughtEnd } from "@/lib/stream-merge";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { ArtifactsPane } from "./ArtifactsPane";
import { ThemeToggle } from "./ThemeToggle";
import { FontSizeToggle } from "./FontSizeToggle";
import { ApprovalToggle } from "./ApprovalToggle";
import { ModelToggle } from "./ModelToggle";
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
    "/find — find in this transcript",
    "Esc — cancel the in-flight turn (write); queued follow-ups still send",
    "resume / fork live on the session row, not as slashes",
    `keys: ${mod}+j/k sessions · ${mod}+n new · ${mod}+[ ] artifacts · ${mod}+t theme · ${mod}+f find · / composer · ? shortcuts · Esc cancel`,
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


type SessionUi = {
  draft: string;
  queue: string[];
  sending: boolean;
  activity: SessionActivity;
  findOpen: boolean;
  findQuery: string;
  notice: string | null;
};

function emptySessionUi(): SessionUi {
  return {
    draft: "",
    queue: [],
    sending: false,
    activity: { ...IDLE_ACTIVITY },
    findOpen: false,
    findQuery: "",
    notice: null,
  };
}

function cloneSessionUi(s: SessionUi): SessionUi {
  return {
    ...s,
    queue: s.queue.slice(),
    activity: { ...s.activity },
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
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<SessionUi>(() => emptySessionUi());
  const slotsRef = useRef(new Map<string, SessionUi>());
  const selectedRef = useRef<string | null>(null);
  const sendPromptRef = useRef<(sid: string, text: string, fromQueue?: boolean) => Promise<void>>(
    async () => {},
  );
  const onTurnEndedRef = useRef<(sid: string, reappend?: boolean) => void>(() => {});

  const draft = view.draft;
  const sending = view.sending;
  const queue = view.queue;
  const activity = view.activity;
  const findOpen = view.findOpen;
  const findQuery = view.findQuery;
  const notice = view.notice;

  function getSlot(sid: string): SessionUi {
    let s = slotsRef.current.get(sid);
    if (!s) {
      s = emptySessionUi();
      slotsRef.current.set(sid, s);
    }
    return s;
  }

  function flushView(sid: string | null) {
    if (!sid) {
      setView(emptySessionUi());
      return;
    }
    setView(cloneSessionUi(getSlot(sid)));
  }

  function mutateSlot(sid: string, fn: (s: SessionUi) => void) {
    fn(getSlot(sid));
    if (selectedRef.current === sid) flushView(sid);
  }

  function setNotice(msg: string | null) {
    const sid = selectedRef.current;
    if (!sid) {
      setView((v) => ({ ...v, notice: msg }));
      return;
    }
    mutateSlot(sid, (s) => {
      s.notice = msg;
    });
  }

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

  const loadSession = useCallback(async (id: string, opts?: { reconcile?: boolean }) => {
    selectedRef.current = id;
    setSelectedId(id);
    writeStoredSelectedId(id);
    const slot = slotsRef.current.get(id) ?? emptySessionUi();
    if (!slotsRef.current.has(id)) slotsRef.current.set(id, slot);
    setView(cloneSessionUi(slot));
    requestAnimationFrame(() => focusComposer());
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    if (selectedRef.current !== id) return data.session;
    setDetail(data.session);
    const live = slotsRef.current.get(id) ?? slot;
    const reconcile = opts?.reconcile !== false;
    if (reconcile && live.sending && data.session.status !== "running") {
      onTurnEndedRef.current(id, true);
    } else if (!live.sending && data.session.status !== "running") {
      live.activity = { ...IDLE_ACTIVITY };
      if (selectedRef.current === id) setView(cloneSessionUi(live));
    }
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
      mutateSlot(sid, (s) => {
        s.activity = bumpActivity(s.activity, phase);
      });
    };
    const handleEvent = (ev: MessageEvent) => {
      if (!ev.data || ev.data === ": connected") return;
      let event: SessionStreamEvent;
      try {
        event = JSON.parse(ev.data) as SessionStreamEvent;
      } catch {
        return;
      }
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
          if (idx >= 0) toolCalls[idx] = mergeOneTool(toolCalls[idx], event.tool);
          else toolCalls.push(mergeOneTool(undefined, event.tool));
          return { ...base, toolCalls };
        });
      } else if (event.type === "activity") {
        applyActivity(event.phase);
      } else if (event.type === "status") {
        if (event.status === "running") {
          mutateSlot(sid, (s) => {
            s.activity =
              s.activity.phase === "idle"
                ? bumpActivity(s.activity, "thinking")
                : { ...s.activity, lastEventAt: Date.now() };
          });
        } else {
          applyActivity("idle");
        }
        setSessions((list) =>
          list.map((row) => (row.id === sid ? { ...row, status: event.status } : row)),
        );
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
            if (selectedRef.current === sid) await loadSession(sid, { reconcile: false });
            await refreshLists();
          } catch {
            // keep live state if reconcile fails
          }
          if (getSlot(sid).sending) onTurnEndedRef.current(sid, true);
        })();
      } else if (event.type === "error") {
        applyActivity("idle");
        mutateSlot(sid, (s) => {
          s.notice = event.message;
        });
        setDetail((prev) => (prev && prev.id === sid ? { ...prev, status: "error" } : prev));
        void (async () => {
          try {
            if (selectedRef.current === sid) await loadSession(sid, { reconcile: false });
            await refreshLists();
          } catch {
            // keep live state if reconcile fails
          }
          if (getSlot(sid).sending) onTurnEndedRef.current(sid, true);
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
    selectedRef.current = data.session.id;
    setDetail(data.session);
    setSelectedId(data.session.id);
    writeStoredSelectedId(data.session.id);
    flushView(data.session.id);
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

  function syncQueue(sid: string, next: string[]) {
    mutateSlot(sid, (s) => {
      s.queue = next;
    });
  }

  async function patchPrefs(prefs: { approval?: string; model?: string; variant?: string }) {
    const sid = selectedRef.current;
    if (!sid) return;
    if (!accountWrite || !can(role, "write")) {
      setNotice("Read-only: cannot change session prefs.");
      return;
    }
    try {
      const data = await api<{ session: SessionSummary }>(`/api/sessions/${sid}`, {
        method: "PATCH",
        body: JSON.stringify(prefs),
      });
      const row = data.session;
      setDetail((prev) =>
        prev && prev.id === sid
          ? {
              ...prev,
              approval: row.approval,
              model: row.model,
              variant: row.variant,
              title: row.title,
            }
          : prev,
      );
      setSessions((list) =>
        list.map((s) =>
          s.id === sid
            ? { ...s, approval: row.approval, model: row.model, variant: row.variant, title: row.title }
            : s,
        ),
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "update failed");
    }
  }

  function drainQueue(sid: string, reappend = false) {
    const leftover = [...getSlot(sid).queue];
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
    const rest = leftover.slice();
    const next = rest.shift();
    mutateSlot(sid, (s) => {
      s.sending = false;
      s.queue = rest;
      if (!next) {
        s.activity = { ...IDLE_ACTIVITY };
        s.notice = null;
      }
    });
    if (next) void sendPromptRef.current(sid, next, true);
  }
  onTurnEndedRef.current = (sid: string, reappend = false) => drainQueue(sid, reappend);

  async function sendPrompt(sid: string, text: string, fromQueue = false) {
    if (!sid) return;
    const slot = getSlot(sid);
    if (slot.sending) {
      const queued = [...slot.queue, text];
      mutateSlot(sid, (s) => {
        s.queue = queued;
        s.notice = `queued (${queued.length})`;
      });
      appendLocal(sid, text, "queued");
      return;
    }
    mutateSlot(sid, (s) => {
      s.sending = true;
      s.activity = bumpActivity(s.activity, "thinking");
      s.notice = s.queue.length ? `grok running · ${s.queue.length} queued` : null;
    });
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
      const leftover = getSlot(sid).queue;
      const now = new Date().toISOString();
      setDetail((prev) => {
        if (prev && prev.id !== sid) return prev;
        return {
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
        };
      });
      await refreshLists();
    } catch (err) {
      mutateSlot(sid, (s) => {
        s.notice = err instanceof Error ? err.message : "send failed";
      });
    } finally {
      if (!waitForStream) {
        drainQueue(sid, false);
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
    selectedRef.current = data.session.id;
    setDetail(data.session);
    setSelectedId(data.session.id);
    writeStoredSelectedId(data.session.id);
    flushView(data.session.id);
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
    slotsRef.current.delete(id);
    const list = await refreshLists();
    if (selectedId === id) {
      const next = list[0];
      if (next) await loadSession(next.id);
      else {
        setDetail(null);
        setSelectedId(null);
        selectedRef.current = null;
        flushView(null);
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
      const sid = selectedRef.current;
      if (sid) {
        mutateSlot(sid, (s) => {
          s.draft = "";
        });
        await sendPrompt(sid, trimmed);
      }
      return;
    }
    const [cmd, ...rest] = trimmed.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    if (selectedRef.current) {
      mutateSlot(selectedRef.current, (s) => {
        s.draft = "";
      });
    }
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
      case "find":
        if (selectedRef.current) {
          mutateSlot(selectedRef.current, (s) => {
            s.findOpen = true;
          });
        }
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
    if (selectedRef.current) {
      mutateSlot(selectedRef.current, (s) => {
        s.draft = "";
      });
    }
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
        if (code === "KeyF") {
          e.preventDefault();
          e.stopPropagation();
          if (selectedRef.current) {
            mutateSlot(selectedRef.current, (s) => {
              s.findOpen = true;
            });
          }
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
      if (t.closest(".modal, .shortcuts-modal, .msg-log, [role='menu'], .find-bar")) return;
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
        <ApprovalToggle
          value={detail?.approval ?? "always-approve"}
          disabled={!detail || !accountWrite || !can(role, "write")}
          onChange={(approval) => void patchPrefs({ approval })}
        />
        <ModelToggle
          model={detail?.model ?? "grok-4.6"}
          variant={detail?.variant ?? "high"}
          disabled={!detail || !accountWrite || !can(role, "write")}
          onChange={(prefs) => void patchPrefs(prefs)}
        />
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
            onDraft={(v) => {
              if (selectedRef.current) {
                mutateSlot(selectedRef.current, (s) => {
                  s.draft = v;
                });
              }
            }}
            onSend={(t) => void onCommand(t)}
            onShell={(c) => void runShell(c)}
            onCancel={() => void cancelTurn()}
            sending={sending}
            notice={notice}
            role={accountWrite ? role : "read"}
            onShare={() => setShareOpen(true)}
            activity={activity}
            overlayOpen={shortcutsOpen}
            queue={queue}
            onDropQueued={(i) => {
              const sid = selectedRef.current;
              if (!sid) return;
              syncQueue(
                sid,
                getSlot(sid).queue.filter((_, idx) => idx !== i),
              );
            }}
            onClearQueue={() => {
              const sid = selectedRef.current;
              if (sid) syncQueue(sid, []);
            }}
            findOpen={findOpen}
            findQuery={findQuery}
            onFindQuery={(q) => {
              if (selectedRef.current) {
                mutateSlot(selectedRef.current, (s) => {
                  s.findQuery = q;
                });
              }
            }}
            onFindOpen={(open) => {
              if (selectedRef.current) {
                mutateSlot(selectedRef.current, (s) => {
                  s.findOpen = open;
                  if (!open) s.findQuery = "";
                });
              }
            }}
          />
          <ArtifactsPane
            artifacts={detail?.artifacts ?? []}
            tools={detail?.id === selectedId ? detail.toolCalls : []}
            sessionId={detail?.id}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        </div>
      )}
      <footer className="status-bar">
        <span>{altMod}+j/k/n/t/f/[ ] · ? shortcuts · Esc cancel · /help /find</span>
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
