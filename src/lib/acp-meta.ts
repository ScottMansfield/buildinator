/** Parent links from ACP tool_call `_meta` only. Never infer from timing. */

export function parentIdFromAcpMeta(meta: unknown): string | undefined {
  if (!meta || typeof meta !== "object") return undefined;
  const o = meta as Record<string, unknown>;
  if (typeof o.parentToolCallId === "string" && o.parentToolCallId.trim()) {
    return o.parentToolCallId.trim();
  }
  const claude = o.claudeCode;
  if (claude && typeof claude === "object") {
    const id = (claude as Record<string, unknown>).parentToolUseId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  const xai = o["x.ai/tool"];
  if (xai && typeof xai === "object") {
    const id = (xai as Record<string, unknown>).parentToolCallId;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

export function isTaskSpawn(name: string, kind?: string): boolean {
  const n = name.trim().toLowerCase();
  const k = (kind ?? "").trim().toLowerCase();
  return n === "task" || k === "task";
}
