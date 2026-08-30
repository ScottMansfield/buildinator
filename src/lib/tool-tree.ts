import type { Artifact, ToolCall } from "./types";
import { isTaskSpawn } from "./acp-meta";

/** Nest only when parentId is set and the parent exists. Flat otherwise. */
export function nestTools(tools: ToolCall[]): {
  roots: ToolCall[];
  children: Map<string, ToolCall[]>;
} {
  const ids = new Set(tools.map((t) => t.id));
  const children = new Map<string, ToolCall[]>();
  const childIds = new Set<string>();
  for (const t of tools) {
    const pid = t.parentId;
    if (!pid || pid === t.id || !ids.has(pid)) continue;
    const list = children.get(pid) ?? [];
    list.push(t);
    children.set(pid, list);
    childIds.add(t.id);
  }
  return {
    roots: tools.filter((t) => !childIds.has(t.id)),
    children,
  };
}

export function toolLabel(tool: ToolCall): string {
  const path =
    tool.input.path ||
    tool.input.pattern ||
    tool.input.command ||
    tool.input.prompt ||
    tool.input.title ||
    "";
  const short = path.length > 36 ? `${path.slice(0, 34)}…` : path;
  const name = tool.name.replace(/_/g, " ");
  return short ? `${name} ${short}` : name;
}

export type TaskItem = {
  id: string;
  text: string;
  done: boolean;
};

const CHECK = /^\s*[-*]?\s*\[([xX ])\]\s*(.*)$/;

function isTodoTool(name: string): boolean {
  const n = name.trim().toLowerCase().replace(/[\s-]/g, "_");
  return n === "todo_write" || n === "todo_read" || n.includes("todo_write");
}

/** Plan artifact checkboxes and/or todo_write tools. Never every tool. */
export function selectTasks(artifacts: Artifact[], tools: ToolCall[]): TaskItem[] {
  const items: TaskItem[] = [];
  const seen = new Set<string>();
  const add = (id: string, text: string, done: boolean) => {
    const t = text.trim();
    if (!t) return;
    const key = t.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ id, text: t, done });
  };

  for (const a of artifacts) {
    if (a.kind !== "plan") continue;
    for (const [i, line] of a.content.split("\n").entries()) {
      const m = line.match(CHECK);
      if (m) add(`${a.id}-${i}`, m[2], m[1].toLowerCase() === "x");
    }
  }

  for (const tool of tools) {
    if (!isTodoTool(tool.name)) continue;
    const blob = [tool.output, tool.input.todos, tool.input.content, tool.input.prompt]
      .filter(Boolean)
      .join("\n");
    let found = false;
    for (const [i, line] of blob.split("\n").entries()) {
      const m = line.match(CHECK);
      if (!m) continue;
      found = true;
      add(`${tool.id}-${i}`, m[2], m[1].toLowerCase() === "x");
    }
    if (!found) {
      add(tool.id, tool.input.title || tool.input.prompt || toolLabel(tool), tool.status === "completed");
    }
  }
  return items;
}

/**
 * Only task-spawn tools plus children whose parentId points at those spawns.
 * Ordinary read/bash/search tools are omitted even as roots.
 */
export function selectSubagents(tools: ToolCall[]): {
  roots: ToolCall[];
  children: Map<string, ToolCall[]>;
} {
  const spawnIds = new Set(
    tools.filter((t) => isTaskSpawn(t.name, t.kind)).map((t) => t.id),
  );
  const roots = tools.filter((t) => spawnIds.has(t.id));
  const children = new Map<string, ToolCall[]>();
  for (const t of tools) {
    const pid = t.parentId;
    if (!pid || pid === t.id || !spawnIds.has(pid)) continue;
    const list = children.get(pid) ?? [];
    list.push(t);
    children.set(pid, list);
  }
  return { roots, children };
}
