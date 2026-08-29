"use client";

import type { Artifact } from "@/lib/types";

type Props = {
  artifacts: Artifact[];
  collapsed: boolean;
  onToggle: () => void;
};

export function ArtifactsPane({ artifacts, collapsed, onToggle }: Props) {
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
        {artifacts.length === 0 ? (
          <div className="empty">
            No artifacts for this session yet. Tool outputs, diffs, plans, and
            terminals land here.
          </div>
        ) : (
          artifacts.map((a) => (
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
