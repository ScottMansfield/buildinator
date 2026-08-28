"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import type { Project, SessionDetail, SessionSummary } from "@/lib/types";
import { Sidebar } from "./Sidebar";
import { ChatPane } from "./ChatPane";
import { ArtifactsPane } from "./ArtifactsPane";
import { ThemeToggle } from "./ThemeToggle";
import { useTheme } from "./ThemeProvider";

const HELP = [
  "/help — this list",
  "/new — create a session in the current project",
  "/rename <title> — rename the current session",
  "/resume — stub (v1: session/load)",
  "/fork — stub (v1: fork ACP session)",
  "/rewind — stub (v1: rewind)",
  "/compact — stub (v1: compact)",
  "keys: j/k sessions · n new · [ ] artifacts · t theme · / composer",
].join("\n");

type Props = { username: string };

export function AppShell({ username }: Props) {
  const { toggle: toggleTheme } = useTheme();
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === detail?.projectId),
    [projects, detail],
  );

  const refreshLists = useCallback(async () => {
    const [p, s] = await Promise.all([
      api<{ projects: Project[] }>("/api/projects"),
      api<{ sessions: SessionSummary[] }>("/api/sessions"),
    ]);
    setProjects(p.projects);
    setSessions(s.sessions);
    return s.sessions;
  }, []);

  const loadSession = useCallback(async (id: string) => {
    const data = await api<{ session: SessionDetail }>(`/api/sessions/${id}`);
    setDetail(data.session);
    setSelectedId(id);
  }, []);

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

  async function createSession(projectId: string) {
    const data = await api<{ session: SessionDetail }>("/api/sessions", {
      method: "POST",
      body: JSON.stringify({ projectId }),
    });
    await refreshLists();
    setDetail(data.session);
    setSelectedId(data.session.id);
    setNotice("Created new mock session.");
  }

  async function rename(title: string) {
    if (!selectedId) return;
    await api(`/api/sessions/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await refreshLists();
    await loadSession(selectedId);
    setNotice(`Renamed to ${title}`);
  }

  async function sendPrompt(text: string) {
    if (!selectedId) return;
    setSending(true);
    setNotice(null);
    try {
      const data = await api<{ session: SessionDetail }>(
        `/api/sessions/${selectedId}/prompt`,
        { method: "POST", body: JSON.stringify({ prompt: text }) },
      );
      setDetail(data.session);
      await refreshLists();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "send failed");
    } finally {
      setSending(false);
    }
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
      case "new": {
        const projectId = detail?.projectId ?? projects[0]?.id;
        if (projectId) await createSession(projectId);
        else setNotice("No project to attach a session to.");
        break;
      }
      case "rename":
        if (!arg) setNotice("Usage: /rename <title>");
        else await rename(arg);
        break;
      case "resume":
        setNotice("Mock: /resume is a stub. v1 will call session/load.");
        break;
      case "fork":
        setNotice("Mock: /fork is a stub. v1 will fork the ACP session.");
        break;
      case "rewind":
        setNotice("Mock: /rewind is a stub.");
        break;
      case "compact":
        setNotice("Mock: /compact is a stub.");
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
        const projectId = detail?.projectId ?? projects[0]?.id;
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
  }, [sessions, selectedId, detail, projects, loadSession, toggleTheme]);

  return (
    <div className="shell">
      <header className="chrome">
        <div className="chrome-title">buildinator</div>
        <span style={{ color: "var(--muted)", fontFamily: "var(--mono)" }}>
          grok session manager
        </span>
        <div className="chrome-spacer" />
        <ThemeToggle />
        <span style={{ color: "var(--muted)" }}>{username}</span>
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
            sessions={sessions}
            selectedId={selectedId}
            onSelect={(id) => void loadSession(id)}
            onNew={(id) => void createSession(id)}
            search={search}
            onSearch={setSearch}
          />
          <ChatPane
            session={detail}
            project={selectedProject}
            draft={draft}
            onDraft={setDraft}
            onSend={(t) => void onCommand(t)}
            sending={sending}
            notice={notice}
          />
          <ArtifactsPane
            artifacts={detail?.artifacts ?? []}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        </div>
      )}
      <footer className="status-bar">
        <span>{detail?.model ?? "grok-4"}</span>
        <span>{selectedProject?.cwd ?? "no cwd"}</span>
        <span>
          tok {detail?.tokenUsage?.input ?? 0}/{detail?.tokenUsage?.output ?? 0}
        </span>
        <span style={{ marginLeft: "auto" }}>
          j/k n [/] t /help · mock adapter
        </span>
      </footer>
    </div>
  );
}
