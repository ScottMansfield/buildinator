"use client";

import { useMemo, useState } from "react";
import type { Project, SessionSummary } from "@/lib/types";
import { relativeTime } from "@/lib/format";

type Props = {
  projects: Project[];
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: (projectId: string) => void;
  search: string;
  onSearch: (q: string) => void;
};

export function Sidebar({
  projects,
  sessions,
  selectedId,
  onSelect,
  onNew,
  search,
  onSearch,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projects.map((project) => {
      const items = sessions.filter((s) => {
        if (s.projectId !== project.id) return false;
        if (!q) return true;
        return (
          s.title.toLowerCase().includes(q) ||
          project.cwd.toLowerCase().includes(q) ||
          project.name.toLowerCase().includes(q)
        );
      });
      return { project, items };
    });
  }, [projects, sessions, search]);

  return (
    <nav className="pane" aria-label="Sessions">
      <div className="pane-header">sessions</div>
      <div style={{ padding: 8 }}>
        <label className="sr-only" htmlFor="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          className="input"
          placeholder="Search sessions\u2026"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {grouped.map(({ project, items }) => {
          const isCollapsed = collapsed[project.id] === true;
          return (
            <div className="project-group" key={project.id}>
              <button
                type="button"
                className="project-toggle"
                aria-expanded={!isCollapsed}
                onClick={() =>
                  setCollapsed((c) => ({ ...c, [project.id]: !isCollapsed }))
                }
              >
                <span aria-hidden="true">{isCollapsed ? "\u25b8" : "\u25be"}</span>
                {project.name}
                <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                  {items.length}
                </span>
              </button>
              <div className="project-cwd">{project.cwd}</div>
              {!isCollapsed && (
                <>
                  {items.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={
                        "session-item" + (s.id === selectedId ? " active" : "")
                      }
                      onClick={() => onSelect(s.id)}
                    >
                      <span className="session-title">{s.title}</span>
                      <span className="session-meta">
                        <span className={"badge " + s.status}>{s.status}</span>
                        <span>{relativeTime(s.updatedAt)}</span>
                      </span>
                    </button>
                  ))}
                  <div style={{ padding: "4px 10px 10px" }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => onNew(project.id)}
                    >
                      + new session
                    </button>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
