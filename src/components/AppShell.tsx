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

function focusSessionItem(id: string) {
  const el = document.querySelector(
    `.session-item[data-session-id="${CSS.escape(id)}"]`,
  );
  if (el instanceof HTMLElement) el.focus();
  else if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
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
  const focusNavRef = useRef(false);
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
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    if (selectedRef.current !== id) return data.session;
    setDetail(data.session);
    return data.session;
  }, []);

  useEffect(() => {
    if (!selectedId || !focusNavRef.current) return;
    focusNavRef.current = false;
    focusSessionItem(selectedId);
  }, [selectedId]);

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
