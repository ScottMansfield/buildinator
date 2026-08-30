"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Project, SessionSummary } from "@/lib/types";
import { relativeTime } from "@/lib/format";
import { can } from "@/lib/acl";

type Props = {
  projects: Project[];
  owned: Project[];
  sessions: SessionSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: (projectId: string) => void;
  onNewProject: (name: string) => void;
  onRename: (id: string, title: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
  canWrite: boolean;
};

function SessionRow({
  s,
  selected,
  onSelect,
  onRename,
  onResume,
  onFork,
  onShare,
  onDelete,
  canWrite,
}: {
  s: SessionSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
  canWrite: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [menu, setMenu] = useState(false);
  const write = canWrite && can(s.myRole, "write");
  const owner = canWrite && can(s.myRole, "owner");

  useEffect(() => {
    if (!editing) setTitle(s.title);
  }, [s.title, editing]);

  function submitRename(e?: FormEvent) {
    e?.preventDefault();
    const next = title.trim();
    setEditing(false);
    if (next && next !== s.title) onRename(s.id, next);
    else setTitle(s.title);
  }

  return (
    <div className={"session-row" + (selected ? " active" : "")}>
      {editing && write ? (
        <form onSubmit={submitRename} className="rename-form">
          <input
            className="input"
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => submitRename()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setTitle(s.title);
                setEditing(false);
              }
            }}
            aria-label="Rename session"
          />
        </form>
      ) : (
        <button
          type="button"
          className="session-item"
          data-session-id={s.id}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(s.id)}
          onDoubleClick={() => {
            if (write) {
              setTitle(s.title);
              setEditing(true);
            }
          }}
        >
          <span className="session-title">{s.title}</span>
          <span className="session-meta">
            <span className={"badge " + s.status}>{s.status}</span>
            {s.myRole !== "owner" ? (
              <span className="share-badge">
                {s.myRole === "write" ? "rw" : "ro"}
              </span>
            ) : null}
            <span>{relativeTime(s.updatedAt)}</span>
          </span>
        </button>
      )}
      <div className="session-menu-wrap">
        <button
          type="button"
          className="btn btn-ghost session-kebab"
          aria-label="Session actions"
          onClick={() => setMenu((m) => !m)}
        >
          ···
        </button>
        {menu ? (
          <div className="session-menu" role="menu">
            {write ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  setTitle(s.title);
                  setEditing(true);
                }}
              >
                rename
              </button>
            ) : null}
            {write ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onResume(s.id);
                }}
              >
                resume
              </button>
            ) : null}
            {write ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onFork(s.id);
                }}
              >
                fork
              </button>
            ) : null}
            {owner ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(false);
                  onShare(s.id);
                }}
              >
                share
              </button>
            ) : null}
            {owner ? (
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenu(false);
                  onDelete(s.id);
                }}
              >
                delete
              </button>
            ) : null}
            {!write ? <div className="muted">read only</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Sidebar({
  projects,
  owned,
  sessions,
  selectedId,
  onSelect,
  onNew,
  onNewProject,
  onRename,
  onResume,
  onFork,
  onShare,
  onDelete,
  search,
  onSearch,
  canWrite,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState(false);
  const [pickId, setPickId] = useState(owned[0]?.id ?? "");
  const [projectForm, setProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");

  const ownedIds = useMemo(() => new Set(owned.map((p) => p.id)), [owned]);

  useEffect(() => {
    if (!selectedId) return;
    const s = sessions.find((row) => row.id === selectedId);
    if (!s) return;
    setCollapsed((c) => (c[s.projectId] ? { ...c, [s.projectId]: false } : c));
  }, [selectedId, sessions]);

  const q = search.trim().toLowerCase();
  const match = (s: SessionSummary, projectName: string, cwd: string) => {
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      cwd.toLowerCase().includes(q) ||
      projectName.toLowerCase().includes(q)
    );
  };

  const ownedGroups = owned.map((project) => ({
    project,
    items: sessions.filter(
      (s) =>
        s.projectId === project.id &&
        s.myRole === "owner" &&
        match(s, project.name, project.cwd),
    ),
  }));

  const shared = sessions.filter(
    (s) => s.myRole !== "owner" && match(s, s.projectName, s.projectCwd),
  );

  const orphanOwned = sessions.filter(
    (s) =>
      s.myRole === "owner" &&
      !ownedIds.has(s.projectId) &&
      match(s, s.projectName, s.projectCwd),
  );

  return (
    <nav className="pane" aria-label="Sessions">
      <div className="pane-header">
        sessions
        <span style={{ marginLeft: "auto", display: "flex", gap: 4, flexShrink: 0 }}>
          {canWrite ? (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setProjectForm(true);
                setPicker(false);
              }}
            >
              + project
            </button>
          ) : null}
          {canWrite && owned.length > 0 ? (
            <button
              type="button"
              className="btn-quiet"
              onClick={() => {
                setPickId(owned[0]?.id ?? "");
                setPicker(true);
                setProjectForm(false);
              }}
            >
              + session
            </button>
          ) : null}
        </span>
      </div>
      <div style={{ padding: 8 }}>
        <label className="sr-only" htmlFor="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          className="input"
          placeholder="Search sessions…"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {canWrite && projectForm ? (
        <form
          className="new-session-picker"
          onSubmit={(e) => {
            e.preventDefault();
            const name = projectName.trim();
            if (!name) return;
            onNewProject(name);
            setProjectName("");
            setProjectForm(false);
          }}
        >
          <label className="sr-only" htmlFor="new-project-name">
            Project name
          </label>
          <input
            id="new-project-name"
            className="input"
            placeholder="project name"
            value={projectName}
            autoFocus
            maxLength={40}
            onChange={(e) => setProjectName(e.target.value)}
          />
          <button className="btn btn-accent" type="submit">
            create project
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setProjectForm(false);
              setProjectName("");
            }}
          >
            cancel
          </button>
        </form>
      ) : null}
      {canWrite && picker ? (
        <form
          className="new-session-picker"
          onSubmit={(e) => {
            e.preventDefault();
            if (pickId) onNew(pickId);
            setPicker(false);
          }}
        >
          <label className="sr-only" htmlFor="new-project">
            Project
          </label>
          <select
            id="new-project"
            className="input"
            value={pickId}
            onChange={(e) => setPickId(e.target.value)}
          >
            {owned.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.cwd}
              </option>
            ))}
          </select>
          <button className="btn btn-accent" type="submit">
            create session
          </button>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => setPicker(false)}
          >
            cancel
          </button>
        </form>
      ) : null}
      <div style={{ overflow: "auto", flex: 1 }}>
        {ownedGroups.map(({ project, items }) => {
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
                <span aria-hidden="true">{isCollapsed ? "▸" : "▾"}</span>
                {project.name}
                <span style={{ marginLeft: "auto", color: "var(--muted)" }}>
                  {items.length}
                </span>
              </button>
              <div className="project-cwd">{project.cwd}</div>
              {project.links.length > 0 ? (
                <div className="project-cwd">
                  deps/{project.links.map((l) => l.name).join(", ")}
                </div>
              ) : null}
              {!isCollapsed && (
                <>
                  {items.map((s) => (
                    <SessionRow
                      key={s.id}
                      s={s}
                      selected={s.id === selectedId}
                      onSelect={onSelect}
                      onRename={onRename}
                      onResume={onResume}
                      onFork={onFork}
                      onShare={onShare}
                      onDelete={onDelete}
                      canWrite={canWrite}
                    />
                  ))}
                  {canWrite ? (
                  <div style={{ padding: "4px 10px 10px" }}>
                    <button
                      type="button"
                      className="btn-quiet"
                      onClick={() => onNew(project.id)}
                    >
                      + session
                    </button>
                  </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
        {orphanOwned.length > 0 ? (
          <div className="project-group">
            <div className="project-toggle">your other sessions</div>
            {orphanOwned.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                selected={s.id === selectedId}
                onSelect={onSelect}
                onRename={onRename}
                onResume={onResume}
                onFork={onFork}
                onShare={onShare}
                onDelete={onDelete}
                canWrite={canWrite}
              />
            ))}
          </div>
        ) : null}
        {shared.length > 0 ? (
          <div className="project-group">
            <div className="project-toggle">shared with me</div>
            {shared.map((s) => (
              <SessionRow
                key={s.id}
                s={s}
                selected={s.id === selectedId}
                onSelect={onSelect}
                onRename={onRename}
                onResume={onResume}
                onFork={onFork}
                onShare={onShare}
                onDelete={onDelete}
                canWrite={canWrite}
              />
            ))}
          </div>
        ) : null}
        {projects.length === 0 && sessions.length === 0 ? (
          <div className="empty">No sessions yet.</div>
        ) : null}
      </div>
    </nav>
  );
}
