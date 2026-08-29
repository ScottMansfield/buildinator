import type { ChatMessage, SessionDetail, ToolCall } from "./types";

export function toolsInFlight(tools: ToolCall[]): boolean {
  return tools.some((t) => t.status === "pending" || t.status === "running");
}

function mergeMessages(prev: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map<string, ChatMessage>();
  for (const m of prev) byId.set(m.id, m);
  for (const m of incoming) {
    const old = byId.get(m.id);
    if (!old) {
      byId.set(m.id, m);
      continue;
    }
    byId.set(m.id, {
      ...old,
      ...m,
      content: m.content.length >= old.content.length ? m.content : old.content,
      endedAt: m.endedAt ?? old.endedAt,
    });
  }
  const serverUser = new Set(
    incoming.filter((m) => m.role === "user").map((m) => m.content),
  );
  const out: ChatMessage[] = [];
  const seen = new Set<string>();
  for (const m of prev) {
    if (
      m.role === "user" &&
      serverUser.has(m.content) &&
      !incoming.some((x) => x.id === m.id)
    ) {
      continue;
    }
    const merged = byId.get(m.id);
    if (!merged || seen.has(m.id)) continue;
    out.push(merged);
    seen.add(m.id);
  }
  for (const m of incoming) {
    if (seen.has(m.id)) continue;
    const merged = byId.get(m.id);
    if (merged) {
      out.push(merged);
      seen.add(m.id);
    }
  }
  return out;
}

function mergeTools(prev: ToolCall[], incoming: ToolCall[]): ToolCall[] {
  const byId = new Map<string, ToolCall>();
  for (const t of prev) byId.set(t.id, t);
  for (const t of incoming) {
    const old = byId.get(t.id);
    if (!old) {
      byId.set(t.id, { ...t, input: { ...t.input } });
      continue;
    }
    byId.set(t.id, {
      ...old,
      ...t,
      input: { ...old.input, ...t.input },
      output: t.output ?? old.output,
    });
  }
  const out: ToolCall[] = [];
  const seen = new Set<string>();
  for (const t of prev) {
    const merged = byId.get(t.id);
    if (!merged || seen.has(t.id)) continue;
    out.push(merged);
    seen.add(t.id);
  }
  for (const t of incoming) {
    if (seen.has(t.id)) continue;
    const merged = byId.get(t.id);
    if (merged) {
      out.push(merged);
      seen.add(t.id);
    }
  }
  return out;
}

/** Merge a GET /api/sessions/:id snapshot into live SSE state without dropping in-flight chunks. */
export function mergeStreamDetail(
  prev: SessionDetail | null,
  incoming: SessionDetail,
): SessionDetail {
  if (!prev || prev.id !== incoming.id) return incoming;
  const messages = mergeMessages(prev.messages, incoming.messages);
  const toolCalls = mergeTools(prev.toolCalls, incoming.toolCalls);
  const artifacts =
    incoming.artifacts.length >= prev.artifacts.length ? incoming.artifacts : prev.artifacts;
  let status = incoming.status;
  if (incoming.status === "error") status = "error";
  else if (
    incoming.status === "idle" &&
    (prev.status === "running" || toolsInFlight(toolCalls))
  ) {
    status = "running";
  }
  return { ...incoming, messages, toolCalls, artifacts, status };
}

export function stampLastThoughtEnd(
  prev: SessionDetail | null,
  sid: string,
): SessionDetail | null {
  if (!prev || prev.id !== sid) return prev;
  const now = new Date().toISOString();
  let idx = -1;
  for (let i = prev.messages.length - 1; i >= 0; i--) {
    if (prev.messages[i].role === "thought" && !prev.messages[i].endedAt) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return prev;
  const messages = prev.messages.slice();
  messages[idx] = { ...messages[idx], endedAt: now };
  return { ...prev, messages };
}
