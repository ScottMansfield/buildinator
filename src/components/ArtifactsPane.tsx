"use client";

import type { Artifact, ToolCall } from "@/lib/types";
import { isTaskSpawn } from "@/lib/acp-meta";
import { selectSubagents, selectTasks, toolLabel } from "@/lib/tool-tree";

type Props = {
  artifacts: Artifact[];
  tools?: ToolCall[];
  sessionId?: string | null;
  collapsed: boolean;
  onToggle: () => void;
};

/** Drop redundant `kind · title` when title already names the kind. */
function cardHeading(kind: string, title: string): string {
  const k = kind.trim();
  const t = title.trim();
  if (!t) return k;
  const kl = k.toLowerCase();
  const tl = t.toLowerCase();
  if (tl === kl || tl.includes(kl)) return t;
  return `${k} · ${t}`;
}

function statusDotClass(status: ToolCall["status"]): string {
  if (status === "completed") return "done";
  if (status === "running") return "running";
  if (status === "pending") return "pending";
  return "error";
}

function AgentNode({ tool, depth }: { tool: ToolCall; depth: number }) {
  const spawn = isTaskSpawn(tool.name, tool.kind);
  return (
    <div
      className={"agent-node" + (spawn ? " spawn" : "")}
      style={{ paddingLeft: 10 + depth * 12 }}
      title={tool.status}
    >
      <span
        className={"status-dot " + statusDotClass(tool.status)}
        aria-label={tool.status}
      />
      <span className="agent-label">{toolLabel(tool)}</span>
    </div>
  );
}

export function ArtifactsPane({
  artifacts,
  tools = [],
  sessionId,
  collapsed,
  onToggle,
}: Props) {
  const files = artifacts.filter((a) => a.kind === "file");
  const cards = artifacts.filter((a) => a.kind !== "file" && a.kind !== "plan");
  const tasks = selectTasks(artifacts, tools);
  const { roots: subagentRoots, children: subagentChildren } = selectSubagents(tools);

  if (collapsed) {
    return (
      <button
        type="button"
        className="rail"
        onClick={onToggle}
        aria-expanded={false}
        title="Show artifacts (])"
      >
        artifacts
      </button>
    );
  }

  return (
    <aside className="pane" aria-label="Artifacts">
      <div className="pane-header">
        artifacts
        <button
          type="button"
          className="btn btn-ghost"
          style={{ marginLeft: "auto", padding: "2px 8px" }}
          onClick={onToggle}
          aria-expanded={true}
          title="Collapse artifacts ([)"
        >
          collapse
        </button>
      </div>
      <div style={{ overflow: "auto", flex: 1 }}>
        {tasks.length > 0 ? (
          <section className="agents-tree" aria-label="Tasks">
            <div className="agents-head">tasks</div>
            {tasks.map((t) => (
              <div key={t.id} className="agent-node" title={t.done ? "done" : "open"}>
                <span
                  className={"status-dot " + (t.done ? "done" : "pending")}
                  aria-label={t.done ? "done" : "open"}
                />
                <span className="agent-label">
                  {t.done ? "[x] " : "[ ] "}
                  {t.text}
                </span>
              </div>
            ))}
          </section>
        ) : null}
        {subagentRoots.length > 0 ? (
          <section className="agents-tree" aria-label="Subagents">
            <div className="agents-head">subagents</div>
            {subagentRoots.map((tool) => (
              <div key={tool.id}>
                <AgentNode tool={tool} depth={0} />
                {(subagentChildren.get(tool.id) ?? []).map((child) => (
                  <AgentNode key={child.id} tool={child} depth={1} />
                ))}
              </div>
            ))}
          </section>
        ) : null}
        <section className="artifact-files" aria-label="Files">
          <header className="artifact-files-head">files</header>
          {files.length === 0 ? (
            <div className="empty artifact-files-empty">No files in this session sandbox yet.</div>
          ) : (
            <ul className="file-list">
              {files.map((a) => {
                const href = sessionId
                  ? `/api/sessions/${encodeURIComponent(sessionId)}/files?path=${encodeURIComponent(a.title)}`
                  : undefined;
                return (
                  <li key={a.id} className="file-row">
                    <span className="file-path" title={a.title}>
                      {a.title}
                    </span>
                    {href ? (
                      <a className="file-download" href={href} download>
                        download
                      </a>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {cards.length === 0 && files.length === 0 && tasks.length === 0 && subagentRoots.length === 0 ? null : (
          cards.map((a) => (
            <article key={a.id} className="artifact">
              <header>
                {cardHeading(a.kind, a.title)}
              </header>
              <pre>{a.content}</pre>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
