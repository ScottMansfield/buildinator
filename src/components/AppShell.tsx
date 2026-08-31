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

function placeholderSession(
  id: string,
  hint?: Partial<SessionDetail> | SessionSummary | null,
): SessionDetail {
  const now = new Date().toISOString();
  return {
    id,
    projectId: hint?.projectId ?? "",
    projectName: hint?.projectName ?? "",
    projectCwd: hint?.projectCwd ?? "",
    ownerId: hint?.ownerId ?? "",
    ownerUsername: hint?.ownerUsername ?? "",
    title: hint?.title ?? "New session",
    status: hint?.status ?? "idle",
    createdAt: hint?.createdAt ?? now,
    updatedAt: hint?.updatedAt ?? now,
    model: hint?.model ?? "grok-4.6",
    variant: hint?.variant ?? "high",
    approval: hint?.approval ?? "always-approve",
    tokenUsage: hint?.tokenUsage,
    myRole: hint?.myRole ?? "owner",
    sharedBy: hint && "sharedBy" in hint ? hint.sharedBy : undefined,
    messages: [],
    artifacts: [],
    toolCalls: [],
    shares: [],
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
  const selectGen = useRef(0);
  const creatingRef = useRef<Promise<string | null> | null>(null);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
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

  function selectionStale(gen: number, id?: string | null): boolean {
    if (selectGen.current !== gen) return true;
    if (id !== undefined && selectedRef.current !== id) return true;
    return false;
  }

  const selectSession = useCallback((id: string | null, snapshot?: SessionDetail | null): number => {
    selectGen.current += 1;
    selectedRef.current = id;
    setSelectedId(id);
    writeStoredSelectedId(id);
    if (!id) {
      setDetail(null);
      flushView(null);
      return selectGen.current;
    }
    if (snapshot && snapshot.id === id) {
      setDetail(snapshot);
    } else {
      const hint = sessionsRef.current.find((s) => s.id === id) ?? snapshot ?? null;
      setDetail(placeholderSession(id, hint));
    }
    flushView(id);
    requestAnimationFrame(() => focusComposer());
    return selectGen.current;
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

  const loadSession = useCallback(async (id: string, opts?: { reconcile?: boolean; gen?: number }) => {
    const gen = opts?.gen ?? selectGen.current;
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    if (selectionStale(gen, id)) return data.session;
    setDetail(data.session);
    const live = slotsRef.current.get(id) ?? emptySessionUi();
    if (!slotsRef.current.has(id)) slotsRef.current.set(id, live);
    const reconcile = opts?.reconcile !== false;
    if (reconcile && live.sending && data.session.status !== "running") {
      onTurnEndedRef.current(id, true);
    } else if (!live.sending && data.session.status !== "running") {
      live.activity = { ...IDLE_ACTIVITY };
      if (!selectionStale(gen, id)) setView(cloneSessionUi(live));
    }
    if (!selectionStale(gen, id)) requestAnimationFrame(() => focusComposer());
    return data.session;
  }, []);

  const switchTo = useCallback(
    async (id: string) => {
      const gen = selectSession(id);
      return loadSession(id, { gen });
    },
    [selectSession, loadSession],
  );

  return (
    <div className="shell">
      <header className="chrome">
        <div className="chrome-title">buildinator</div>
        <ThemeToggle />
        <FontSizeToggle />
        <span>{user.username}</span>
      </header>
      <div className="panes">
        <Sidebar
          projects={projects}
          owned={owned}
          sessions={sessions}
          selectedId={selectedId}
          onSelect={(id) => void switchTo(id)}
          onNew={(id) => void createSession(id)}
          onNewProject={(name) => void createProject(name)}
          onRename={(id, title) => void rename(id, title)}
          onResume={(id) => void runAction(id, "resume")}
          onFork={(id) => void runAction(id, "fork")}
          onShare={(id) => { void switchTo(id).then(() => setShareOpen(true)); }}
          onDelete={(id) => void deleteSession(id)}
          search={search}
          onSearch={setSearch}
          canWrite={accountWrite}
        />
        <ChatPane
          key={selectedId ?? "none"}
          session={detail}
          project={selectedProject}
          draft={draft}
          onDraft={(v) => { if (selectedRef.current) mutateSlot(selectedRef.current, (s) => { s.draft = v; }); }}
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
          onDropQueued={(i) => { const sid = selectedRef.current; if (!sid) return; syncQueue(sid, getSlot(sid).queue.filter((_, idx) => idx !== i)); }}
          onClearQueue={() => { const sid = selectedRef.current; if (sid) syncQueue(sid, []); }}
          findOpen={findOpen}
          findQuery={findQuery}
          onFindQuery={(q) => { if (selectedRef.current) mutateSlot(selectedRef.current, (s) => { s.findQuery = q; }); }}
          onFindOpen={(open) => { if (selectedRef.current) mutateSlot(selectedRef.current, (s) => { s.findOpen = open; if (!open) s.findQuery = ""; }); }}
        />
        <ArtifactsPane
          key={"art-" + (selectedId ?? "none")}
          artifacts={detail?.artifacts ?? []}
          tools={detail?.id === selectedId ? detail.toolCalls : []}
          sessionId={selectedId}
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
        />
      </div>
    </div>
  );
}
