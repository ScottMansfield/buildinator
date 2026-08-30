import type { Artifact, ChatMessage, SessionDetail, ToolCall } from "./types";

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

export function mergeOneTool(prev: ToolCall | undefined, incoming: ToolCall): ToolCall {
  if (!prev) return { ...incoming, input: { ...incoming.input } };
  return {
    ...prev,
    ...incoming,
    input: { ...prev.input, ...incoming.input },
    output: incoming.output ?? prev.output,
    parentId: incoming.parentId ?? prev.parentId,
    kind: incoming.kind ?? prev.kind,
  };
}

function mergeTools(prev: ToolCall[], incoming: ToolCall[]): ToolCall[] {
  const byId = new Map<string, ToolCall>();
  for (const t of prev) byId.set(t.id, t);
  for (const t of incoming) {
    byId.set(t.id, mergeOneTool(byId.get(t.id), t));
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


function mergeArtifacts(prev: Artifact[], incoming: Artifact[]): Artifact[] {
  const prevFiles = prev.filter((a) => a.kind === "file");
  const incomingFiles = incoming.filter((a) => a.kind === "file");
  const othersIn = incoming.filter((a) => a.kind !== "file");
  const othersPrev = prev.filter((a) => a.kind !== "file");
  const others = othersIn.length >= othersPrev.length ? othersIn : othersPrev;

  const byTitle = new Map<string, Artifact>();
  for (const a of prevFiles) byTitle.set(a.title, a);
  for (const a of incomingFiles) byTitle.set(a.title, a);
  const files = [...byTitle.values()].sort((a, b) => {
    const tb = Date.parse(b.createdAt) || 0;
    const ta = Date.parse(a.createdAt) || 0;
    if (tb !== ta) return tb - ta;
    return a.title.localeCompare(b.title);
  });
  return [...others, ...files];
}

/** Merge a GET /api/sessions/:id snapshot into live SSE state without dropping in-flight chunks. */
export function mergeStreamDetail(
  prev: SessionDetail | null,
  incoming: SessionDetail,
): SessionDetail {
  if (!prev || prev.id !== incoming.id) return incoming;
  const messages = mergeMessages(prev.messages, incoming.messages);
  const toolCalls = mergeTools(prev.toolCalls, incoming.toolCalls);
  const artifacts = mergeArtifacts(prev.artifacts, incoming.artifacts);
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
