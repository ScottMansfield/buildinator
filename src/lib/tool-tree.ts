import type { ToolCall } from "./types";

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
