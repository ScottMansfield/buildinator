"use client";

import type { Artifact } from "@/lib/types";

type Props = {
  artifacts: Artifact[];
  sessionId?: string | null;
  collapsed: boolean;
  onToggle: () => void;
};

export function ArtifactsPane({ artifacts, sessionId, collapsed, onToggle }: Props) {
  const files = artifacts.filter((a) => a.kind === "file");
  const cards = artifacts.filter((a) => a.kind !== "file");

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
        <section className="artifact-files" aria-label="Files">
          <header className="artifact-files-head">files</header>
          {files.length === 0 ? (
            <div className="empty artifact-files-empty">No files in this project sandbox yet.</div>
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
        {cards.length === 0 && files.length === 0 ? null : (
          cards.map((a) => (
            <article key={a.id} className="artifact">
              <header>
                {a.kind} · {a.title}
              </header>
              <pre>{a.content}</pre>
            </article>
          ))
        )}
      </div>
    </aside>
  );
}
