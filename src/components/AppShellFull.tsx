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
      if (s.projectId === project.id && s.myRole === "owner" && match(s, project.name, project.cwd)) {
        ordered.push(s);
      }
    }
  }
  for (const s of sessions) {
    if (s.myRole === "owner" && !ownedIds.has(s.projectId) && match(s, s.projectName, s.projectCwd)) {
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
  const el = document.querySelector(`.session-item[data-session-id="${CSS.escape(id)}"]`);
  if (el instanceof HTMLElement) el.focus();
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
  const selectedProject = useMemo(() => projects.find((p) => p.id === detail?.projectId), [projects, detail]);
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
