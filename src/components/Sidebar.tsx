"use client";

import { FormEvent, useMemo, useState } from "react";
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
  onRename: (id: string, title: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
  search: string;
  onSearch: (q: string) => void;
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
}: {
  s: SessionSummary;
  selected: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onResume: (id: string) => void;
  onFork: (id: string) => void;
  onShare: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(s.title);
  const [menu, setMenu] = useState(false);
  const write = can(s.myRole, "write");
  const owner = can(s.myRole, "owner");

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
  onRename,
  onResume,
  onFork,
  onShare,
  onDelete,
  search,
  onSearch,
}: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [picker, setPicker] = useState(false);
  const [pickId, setPickId] = useState(owned[0]?.id ?? "");

  const ownedIds = useMemo(() => new Set(owned.map((p) => p.id)), [owned]);

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
        {owned.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost"
            style={{ marginLeft: "auto", padding: "2px 8px" }}
            onClick={() => {
              setPickId(owned[0]?.id ?? "");
              setPicker(true);
            }}
          >
            + new
          </button>
        ) : null}
      </div>
      <div style={{ padding: 8 }}>
        <label className="sr-only" htmlFor="session-search">
          Search sessions
        </label>
        <input
          id="session-search"
          className="input"
          placeholder="Search sessions"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>
      {picker ? (
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
                <span aria-hidden="true">{isCollapsed ? ">" : "v"}</span>
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
                    />
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
