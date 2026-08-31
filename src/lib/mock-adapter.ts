import { accessOf, requireAccountWrite, requireRole } from "./acl";
import {
  deleteAllShares,
  deleteSessionRow,
  deleteShare,
  findUserByUsername,
  getAccessibleSummary,
  findOwnedProjectByName,
  getProjectRow,
  getSessionRow,
  sessionIdForAcpSession,
  insertProject,
  insertSession,
  insertShare,
  listProjectRowsForOwner,
  listSessionSummaries,
  listShareRows,
  shareRoleFor,
  toProject,
  updateSessionMeta,
  visibleProjects,
} from "./db";
import { AclError, NotFoundError } from "./errors";
import { newId } from "./ids";
import { grokAcpEnabled, grokCliEnabled, runGrokPrompt } from "./grok-cli";
import { formatBytes, isUntitled, titleFromPrompt } from "./format";
import {
  getAcpClient,
  isSessionNotFoundError,
  type AcpUpdate,
} from "./acp-client";
import { parentIdFromAcpMeta } from "./acp-meta";
import { emit } from "./session-events";
import {
  destroySandbox,
  displayCwd,
  ensureSandbox,
  ensureSessionSandbox,
  listSandboxFiles,
  relativeSandboxPath,
} from "./sandbox";
import {
  cloneTranscript,
  emptyTranscript,
  seedTranscripts,
  type Transcript,
} from "./seed-transcripts";
import { deleteTranscript, loadTranscript, saveTranscript } from "./transcript-store";
import type {
  Artifact,
  ChatMessage,
  GrokBuildAdapter,
  Project,
  SessionDetail,
  SessionShare,
  SessionSummary,
  SessionUser,
  ShareRole,
  ToolCall,
  ToolCallStatus,
} from "./types";

const REPLIES = [
  "I'll take a look at the current session layout and sketch a three-pane shell around it.",
  "Mock adapter accepted the prompt. In v1 this would go out as ACP session/prompt.",
  "Noted. I would grep the repo, then propose a patch — here is a plausible next step.",
  "Done in the mock. Artifacts pane should pick up any tool output I just invented.",
];


function dropLastUserTurn(t: Transcript): void {
  let last = -1;
  for (let i = t.messages.length - 1; i >= 0; i--) {
    if (t.messages[i].role === "user") {
      last = i;
      break;
    }
  }
  if (last >= 0) t.messages.splice(last);
}

function acpText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (typeof content === "number" || typeof content === "boolean") return String(content);
  if (Array.isArray(content)) return content.map(acpText).join("");
  if (typeof content === "object") {
    const o = content as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.text === "object") return acpText(o.text);
    if (typeof o.content === "string") return o.content;
    if (Array.isArray(o.content) || (o.content && typeof o.content === "object")) {
      return acpText(o.content);
    }
  }
  return "";
}

function mapToolStatus(status?: string): ToolCallStatus {
  if (status === "pending") return "pending";
  if (status === "in_progress" || status === "running") return "running";
  if (status === "completed") return "completed";
  if (status === "failed" || status === "error" || status === "cancelled") return "error";
  return "pending";
}

function mapToolInput(rawInput: unknown, title?: string): Record<string, string> {
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    const out: Record<string, string> = {};
    let allStrings = true;
    for (const [k, v] of Object.entries(rawInput as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
      else {
        allStrings = false;
        break;
      }
    }
    if (allStrings && Object.keys(out).length > 0) return out;
  }
  return { title: title || "tool" };
}

function toolOutputFrom(update: AcpUpdate): string | undefined {
  if (typeof update.rawOutput === "string" && update.rawOutput) return update.rawOutput;
  const content = update.content;
  if (!Array.isArray(content)) {
    const t = acpText(content);
    return t || undefined;
  }
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    if (it.type === "content") {
      const t = acpText(it.content);
      if (t) parts.push(t);
    } else if (it.type === "diff") {
      const path = typeof it.path === "string" ? it.path : "file";
      parts.push(`diff ${path}`);
    } else if (it.type === "terminal") {
      parts.push("terminal");
    }
  }
  return parts.length ? parts.join("\n") : undefined;
}

function usageTokens(update: AcpUpdate): { input?: number; output?: number } {
  const num = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const used =
    update.used && typeof update.used === "object"
      ? (update.used as Record<string, unknown>)
      : undefined;
  const tokens =
    update.tokens && typeof update.tokens === "object"
      ? (update.tokens as Record<string, unknown>)
      : undefined;
  return {
    input: num(update.inputTokens) ?? num(used?.input) ?? num(tokens?.input) ?? num(update.input),
    output:
      num(update.outputTokens) ?? num(used?.output) ?? num(tokens?.output) ?? num(update.output),
  };
}


function closeTurnThoughts(
  t: Transcript,
  thoughtIds: Map<string, string>,
  now: string,
): void {
  for (const id of thoughtIds.values()) {
    const msg = t.messages.find((m) => m.id === id);
    if (msg && msg.role === "thought" && !msg.endedAt) {
      msg.endedAt = now;
    }
  }
}

function throttleSave(sessionId: string, t: Transcript): () => void {
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    last = Date.now();
    timer = null;
    saveTranscript(sessionId, t);
  };
  return () => {
    const now = Date.now();
    if (now - last >= 300) {
      flush();
      return;
    }
    if (!timer) timer = setTimeout(flush, 300 - (now - last));
  };
}

type Store = { transcripts: Map<string, Transcript> };

function touchInfo(t: Transcript, session: SessionSummary): void {
  const info = t.artifacts.find((a) => a.kind === "info");
  const line = `model: ${session.model} (${session.variant})\ncwd: ${session.projectCwd}\ntokens: ${session.tokenUsage?.input ?? 0} in / ${session.tokenUsage?.output ?? 0} out\nstatus: ${session.status}`;
  if (info) {
    info.content = line;
    info.createdAt = session.updatedAt;
  } else {
    t.artifacts.push({
      id: newId(),
      sessionId: session.id,
      kind: "info",
      title: "Session info",
      createdAt: session.updatedAt,
      content: line,
    });
  }
}

function withTranscript(summary: SessionSummary, t: Transcript): SessionDetail {
  syncSandboxFileArtifacts(summary.id, t);
  const clone = cloneTranscript(t);
  return {
    ...summary,
    messages: clone.messages,
    toolCalls: clone.toolCalls,
    artifacts: clone.artifacts,
  };
}


const TITLE_BANNER = /\/rename to set a title\.?$/i;

function stripTitleBanner(t: Transcript): boolean {
  const before = t.messages.length;
  t.messages = t.messages.filter(
    (m) => !(m.role === "system" && TITLE_BANNER.test(m.content)),
  );
  return t.messages.length !== before;
}

function maybeAutotitle(sessionId: string, currentTitle: string, prompt: string): string | null {
  if (!isUntitled(currentTitle)) return null;
  const next = titleFromPrompt(prompt);
  if (!next) return null;
  updateSessionMeta(sessionId, { title: next, updatedAt: new Date().toISOString() });
  emit(sessionId, { type: "title", title: next });
  return next;
}

function trimId(value: string | null | undefined): string | undefined {
  const s = value?.trim();
  return s ? s : undefined;
}

/** Transcript JSON is chat source of truth; sqlite is the resume index. */
function resolveAcpSessionId(sessionId: string, t: Transcript): string | undefined {
  const fromTranscript = trimId(t.acpSessionId);
  const fromDb = trimId(getSessionRow(sessionId)?.acp_session_id);
  const id = fromTranscript || fromDb;
  if (!id) return undefined;
  const stolen = sessionIdForAcpSession(id, sessionId);
  if (stolen) {
    console.error("[acp] refusing shared acp_session_id", id, "owned by", stolen, "not", sessionId);
    delete t.acpSessionId;
    if (fromDb) updateSessionMeta(sessionId, { acpSessionId: null });
    return undefined;
  }
  if (t.acpSessionId !== id) t.acpSessionId = id;
  if (fromDb !== id) {
    updateSessionMeta(sessionId, { acpSessionId: id });
  }
  return id;
}

function persistAcpSessionId(sessionId: string, t: Transcript, acpId: string | null): void {
  if (acpId) {
    const stolen = sessionIdForAcpSession(acpId, sessionId);
    if (stolen) {
      console.error("[acp] persist skipped, acp_session_id already bound", acpId, stolen);
      return;
    }
    t.acpSessionId = acpId;
  } else {
    delete t.acpSessionId;
  }
  updateSessionMeta(sessionId, { acpSessionId: acpId });
}

const SEED_MAX_TURNS = 20;
const SEED_MAX_CHARS = 20_000;
const SEED_MSG_CHARS = 2_000;

/** Compact user/assistant transcript for rehydrating a replacement ACP session. */
function compactTranscriptSeed(t: Transcript, currentPrompt: string): string {
  const msgs = t.messages.filter((m) => m.role === "user" || m.role === "assistant");
  if (
    msgs.length &&
    msgs[msgs.length - 1].role === "user" &&
    msgs[msgs.length - 1].content === currentPrompt
  ) {
    msgs.pop();
  }
  const recent = msgs.slice(-SEED_MAX_TURNS);
  const blocks: string[] = [];
  for (const m of recent) {
    let text = m.content.trim();
    if (text.length > SEED_MSG_CHARS) text = text.slice(0, SEED_MSG_CHARS) + "\u2026";
    blocks.push(`${m.role === "user" ? "USER" : "ASSISTANT"}: ${text}`);
  }
  let body = blocks.join("\n\n");
  if (body.length > SEED_MAX_CHARS) {
    body = body.slice(body.length - SEED_MAX_CHARS);
    const nl = body.indexOf("\n");
    if (nl >= 0) body = body.slice(nl + 1);
  }
  const preface =
    "The previous grok ACP session was lost. Here is a compact transcript of recent " +
    "user/assistant messages so you have context. Ignore thoughts and tool payloads. " +
    "Do not treat this block as a new request except for the last user message after the transcript.";
  if (!body.trim()) {
    return `${preface}\n\nThe user's current request:\n${currentPrompt}`;
  }
  return (
    `${preface}\n\n=== conversation so far ===\n${body}\n=== end transcript ===\n\n` +
    `The user's current request:\n${currentPrompt}`
  );
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? "unknown error");
}

function sandboxAbsForSession(sessionId: string): string | null {
  const row = getSessionRow(sessionId);
  if (!row) return null;
  const project = getProjectRow(row.project_id);
  if (!project) return null;
  try {
    return ensureSessionSandbox(project.owner_id, project.id, sessionId);
  } catch {
    return null;
  }
}

function isWriteLikeTool(name: string): boolean {
  const n = name.trim().toLowerCase();
  const compact = n.replace(/\s+/g, "_");
  if (compact === "write_file" || compact === "edit_file") return true;
  if (n === "write" || n === "edit") return true;
  if (/^wrote\b/.test(n) || /^edited\b/.test(n)) return true;
  return false;
}

function writePathFromTool(name: string, input: Record<string, string>): string | undefined {
  const fromInput = input.path?.trim();
  if (fromInput) return fromInput;
  const m = name.trim().match(/^(?:Wrote|Edited)\s+(\S+)/i);
  return m?.[1];
}

function upsertFileArtifact(
  sessionId: string,
  t: Transcript,
  relPath: string,
  bytes: number | undefined,
  persist: () => void,
): void {
  const now = new Date().toISOString();
  const content = bytes != null ? formatBytes(bytes) : "";
  const existing = t.artifacts.find((a) => a.kind === "file" && a.title === relPath);
  if (existing) {
    existing.createdAt = now;
    if (content) existing.content = content;
    emit(sessionId, { type: "artifact", artifact: { ...existing } });
  } else {
    const artifact = {
      id: newId(),
      sessionId,
      kind: "file" as const,
      title: relPath,
      createdAt: now,
      content,
    };
    t.artifacts.push(artifact);
    emit(sessionId, { type: "artifact", artifact: { ...artifact } });
  }
  persist();
}

function recordSandboxWrite(
  sessionId: string,
  t: Transcript,
  candidate: string,
  bytes: number | undefined,
  persist: () => void,
): void {
  const sandbox = sandboxAbsForSession(sessionId);
  if (!sandbox) return;
  const rel = relativeSandboxPath(sandbox, candidate);
  if (!rel) return;
  upsertFileArtifact(sessionId, t, rel, bytes, persist);
}

/** Disk is source of truth for kind=file artifacts. Does not parse the transcript. */
function syncSandboxFileArtifacts(sessionId: string, t: Transcript): void {
  const others = t.artifacts.filter((a) => a.kind !== "file");
  const prevFiles = t.artifacts.filter((a) => a.kind === "file");
  const sandbox = sandboxAbsForSession(sessionId);
  if (!sandbox) {
    t.artifacts = others;
    return;
  }
  const listed = listSandboxFiles(sandbox);
  const byTitle = new Map(prevFiles.map((a) => [a.title, a]));
  const nextFiles: Artifact[] = [];
  for (const f of listed) {
    const existing = byTitle.get(f.rel);
    const content = formatBytes(f.size);
    const createdAt = new Date(f.mtimeMs).toISOString();
    if (existing) {
      existing.content = content;
      existing.createdAt = createdAt;
      nextFiles.push(existing);
    } else {
      nextFiles.push({
        id: newId(),
        sessionId,
        kind: "file",
        title: f.rel,
        createdAt,
        content,
      });
    }
  }
  t.artifacts = [...others, ...nextFiles];
}

export class MockGrokBuildAdapter implements GrokBuildAdapter {
  private store: Store;
  private replyAt = 0;
  private acpTurns = new Map<string, Promise<void>>();
  private turnSeq = new Map<string, number>();
  private cancelRequested = new Map<string, number>();
  private mockSleepers = new Map<string, Array<() => void>>();

  constructor() {
    const transcripts = seedTranscripts();
    for (const id of transcripts.keys()) {
      const persisted = loadTranscript(id);
      if (persisted) transcripts.set(id, persisted);
    }
    this.store = { transcripts };
  }

  private transcript(id: string, cwd: string): Transcript {
    let t = this.store.transcripts.get(id);
    if (!t) {
      t = loadTranscript(id) ?? emptyTranscript(id, cwd, new Date().toISOString());
      this.store.transcripts.set(id, t);
    }
    if (stripTitleBanner(t)) saveTranscript(id, t);
    return t;
  }

  private applyAcpUpdate(
    user: SessionUser,
    sessionId: string,
    t: Transcript,
    update: AcpUpdate,
    assistantIds: Map<string, string>,
    thoughtIds: Map<string, string>,
    persist: () => void,
  ): void {
    const now = new Date().toISOString();
    const kind = update.sessionUpdate;

    if (kind === "agent_message_chunk" || kind === "agent_message" || kind === "message") {
      closeTurnThoughts(t, thoughtIds, now);
      const key = update.messageId || "default";
      let id = assistantIds.get(key);
      const chunk = acpText(update.content) || acpText(update.text);
      if (!chunk && kind === "agent_message_chunk") return;
      const replace = kind !== "agent_message_chunk";
      if (!id) {
        id = newId();
        assistantIds.set(key, id);
        t.messages.push({ id, role: "assistant", content: chunk, createdAt: now });
      } else {
        const msg = t.messages.find((m) => m.id === id);
        if (msg) msg.content = replace ? chunk || msg.content : msg.content + chunk;
      }
      const msg = t.messages.find((m) => m.id === id);
      emit(sessionId, { type: "activity", phase: "writing" });
      emit(sessionId, { type: "message", id, role: "assistant", content: msg?.content ?? chunk });
      persist();
      return;
    }

    if (kind === "agent_thought_chunk") {
      const key = update.messageId || "default";
      let id = thoughtIds.get(key);
      const existing = id ? t.messages.find((m) => m.id === id) : undefined;
      if (existing?.endedAt) {
        id = undefined;
        thoughtIds.delete(key);
      }
      const chunk = acpText(update.content);
      if (!id) {
        id = newId();
        thoughtIds.set(key, id);
        t.messages.push({ id, role: "thought", content: chunk, createdAt: now });
      } else {
        const msg = t.messages.find((m) => m.id === id);
        if (msg) msg.content += chunk;
      }
      const msg = t.messages.find((m) => m.id === id);
      emit(sessionId, { type: "activity", phase: "thinking" });
      emit(sessionId, { type: "thought", id, content: msg?.content ?? chunk });
      persist();
      return;
    }

    if (kind === "tool_call" || kind === "tool_call_update") {
      closeTurnThoughts(t, thoughtIds, now);
      const toolCallId = typeof update.toolCallId === "string" ? update.toolCallId : newId();
      const title = typeof update.title === "string" ? update.title : undefined;
      const existing = t.toolCalls.find((c) => c.id === toolCallId);
      const name = title || existing?.name || (typeof update.kind === "string" ? update.kind : "tool");
      const input =
        update.rawInput !== undefined
          ? mapToolInput(update.rawInput, title || name)
          : existing?.input ?? mapToolInput(undefined, title || name);
      const output = toolOutputFrom(update) ?? existing?.output;
      const status = update.status ? mapToolStatus(String(update.status)) : existing?.status ?? "pending";
      const parentId = parentIdFromAcpMeta(update._meta) ?? existing?.parentId;
      const kind =
        typeof update.kind === "string" && update.kind
          ? update.kind
          : existing?.kind;
      const tool: ToolCall = {
        id: toolCallId,
        name,
        status,
        input,
        output,
        createdAt: existing?.createdAt ?? now,
        ...(parentId ? { parentId } : {}),
        ...(kind ? { kind } : {}),
      };
      if (existing) {
        existing.name = tool.name;
        existing.status = tool.status;
        existing.input = tool.input;
        existing.output = tool.output;
        if (tool.parentId) existing.parentId = tool.parentId;
        if (tool.kind) existing.kind = tool.kind;
      } else {
        t.toolCalls.push(tool);
      }
      emit(sessionId, { type: "activity", phase: "working" });
      emit(sessionId, { type: "tool", tool: { ...tool, input: { ...tool.input } } });
      persist();
      if (isWriteLikeTool(tool.name)) {
        const raw = writePathFromTool(tool.name, tool.input);
        if (raw) recordSandboxWrite(sessionId, t, raw, undefined, persist);
      }
      return;
    }

    if (kind === "plan") {
      const entries = Array.isArray(update.entries) ? update.entries : [];
      const lines = entries.map((entry) => {
        if (!entry || typeof entry !== "object") return "";
        const e = entry as { content?: unknown; status?: unknown };
        const done = e.status === "completed" || e.status === "done";
        const content = typeof e.content === "string" ? e.content : "";
        return `[${done ? "x" : " "}] ${content}`;
      }).filter(Boolean);
      if (lines.length === 0) return;
      emit(sessionId, { type: "activity", phase: "working" });
      const content = lines.join("\n");
      const existing = t.artifacts.find((a) => a.kind === "plan" && a.title === "Plan");
      let artifact;
      if (existing) {
        existing.content = content;
        existing.createdAt = now;
        artifact = existing;
      } else {
        artifact = {
          id: newId(),
          sessionId,
          kind: "plan" as const,
          title: "Plan",
          createdAt: now,
          content,
        };
        t.artifacts.push(artifact);
      }
      emit(sessionId, { type: "artifact", artifact: { ...artifact } });
      persist();
      return;
    }

    if (kind === "usage_update") {
      const u = usageTokens(update);
      if (u.input == null && u.output == null) return;
      updateSessionMeta(sessionId, {
        updatedAt: now,
        ...(u.input != null ? { tokenInput: u.input } : {}),
        ...(u.output != null ? { tokenOutput: u.output } : {}),
      });
      const updated = getAccessibleSummary(user.id, sessionId);
      if (updated) touchInfo(t, updated);
      persist();
      return;
    }

    if (
      (kind === "session_info_update" || kind === "session_title") &&
      typeof update.title === "string" &&
      update.title.trim()
    ) {
      const summary = getAccessibleSummary(user.id, sessionId);
      if (summary && isUntitled(summary.title)) {
        const next = update.title.trim().slice(0, 80);
        updateSessionMeta(sessionId, { title: next, updatedAt: now });
        emit(sessionId, { type: "title", title: next });
        persist();
      }
    }
  }

  private sleepInterruptible(sessionId: string, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      let wake: () => void = () => {};
      const timer = setTimeout(() => {
        const list = this.mockSleepers.get(sessionId);
        if (list) {
          const next = list.filter((fn) => fn !== wake);
          if (next.length) this.mockSleepers.set(sessionId, next);
          else this.mockSleepers.delete(sessionId);
        }
        resolve(false);
      }, ms);
      wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const list = this.mockSleepers.get(sessionId) ?? [];
      list.push(wake);
      this.mockSleepers.set(sessionId, list);
    });
  }

  private interruptMockSleep(sessionId: string): void {
    const list = this.mockSleepers.get(sessionId);
    if (!list) return;
    this.mockSleepers.delete(sessionId);
    for (const wake of list) wake();
  }

  private settleCancelled(
    user: SessionUser,
    sessionId: string,
    t: Transcript,
  ): SessionDetail {
    const now = new Date().toISOString();
    t.messages.push({
      id: newId(),
      role: "action",
      content: "Cancelled turn",
      createdAt: now,
    });
    updateSessionMeta(sessionId, { status: "idle", updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    touchInfo(t, updated);
    saveTranscript(sessionId, t);
    emit(sessionId, { type: "status", status: "idle" });
    emit(sessionId, { type: "done", stopReason: "cancelled" });
    return withTranscript(updated, t);
  }

  private async runAcpTurn(
    user: SessionUser,
    sessionId: string,
    t: Transcript,
    prompt: string,
    cwd: string,
    seq: number,
  ): Promise<void> {
    const persist = throttleSave(sessionId, t);
    const cancelled = () => this.cancelRequested.get(sessionId) === seq;
    const stillThisTurn = () => this.turnSeq.get(sessionId) === seq;
    try {
      const client = getAcpClient();
      await client.ensureProcess();
      if (cancelled()) {
        persist();
        return;
      }
      const previousId = resolveAcpSessionId(sessionId, t);
      let acpId = previousId;
      let mintedNew = false;
      if (previousId && client.hasLoaded(previousId)) {
        persistAcpSessionId(sessionId, t, previousId);
        client.bindSandbox(previousId, cwd);
      } else if (previousId) {
        let loadErr: unknown;
        try {
          await client.sessionLoad(previousId, cwd);
        } catch (err) {
          loadErr = err;
          console.error("[acp] session/load failed", previousId, err);
          t.messages.push({
            id: newId(),
            role: "action",
            content: `ACP session/load failed: ${errText(err)}`,
            createdAt: new Date().toISOString(),
          });
          persist();
          try {
            await client.ensureProcess();
            await client.sessionLoad(previousId, cwd);
            loadErr = undefined;
          } catch (err2) {
            loadErr = err2;
            console.error("[acp] session/load retry failed", previousId, err2);
          }
        }
        if (loadErr) {
          if (isSessionNotFoundError(loadErr)) {
            const created = await client.sessionNew(cwd, getAccessibleSummary(user.id, sessionId)?.approval ?? "always-approve");
            persistAcpSessionId(sessionId, t, created);
            mintedNew = true;
            acpId = created;
            t.messages.push({
              id: newId(),
              role: "action",
              content: `ACP session reset (new ${created.slice(0, 8)})`,
              createdAt: new Date().toISOString(),
            });
            saveTranscript(sessionId, t);
          } else {
            throw loadErr instanceof Error ? loadErr : new Error(errText(loadErr));
          }
        } else {
          persistAcpSessionId(sessionId, t, previousId);
        }
      } else {
        const created = await client.sessionNew(cwd, getAccessibleSummary(user.id, sessionId)?.approval ?? "always-approve");
        persistAcpSessionId(sessionId, t, created);
        mintedNew = true;
        acpId = created;
        saveTranscript(sessionId, t);
      }
      if (cancelled()) {
        persist();
        return;
      }
      if (!acpId) throw new Error("ACP session id missing");
      if (cancelled()) {
        client.sessionCancel(acpId);
        persist();
        return;
      }

      const promptText =
        mintedNew && previousId ? compactTranscriptSeed(t, prompt) : prompt;

      const assistantIds = new Map<string, string>();
      const thoughtIds = new Map<string, string>();
      const unregWrite = client.onFsWrite((absPath, bytes) => {
        recordSandboxWrite(sessionId, t, absPath, bytes, persist);
      });
      let result: { stopReason?: string };
      try {
        result = await client.sessionPrompt(acpId, promptText, (update) => {
          this.applyAcpUpdate(user, sessionId, t, update, assistantIds, thoughtIds, persist);
        });
      } finally {
        unregWrite();
      }

      persist();
      saveTranscript(sessionId, t);
      if (cancelled()) {
        this.cancelRequested.delete(sessionId);
        return;
      }
      if (!stillThisTurn()) return;

      const doneAt = new Date().toISOString();
      closeTurnThoughts(t, thoughtIds, doneAt);
      const stillTools = t.toolCalls.some(
        (c) => c.status === "pending" || c.status === "running",
      );
      updateSessionMeta(sessionId, {
        status: stillTools ? "running" : "idle",
        updatedAt: doneAt,
      });
      const updated = getAccessibleSummary(user.id, sessionId);
      if (updated) touchInfo(t, updated);
      saveTranscript(sessionId, t);
      emit(sessionId, { type: "status", status: stillTools ? "running" : "idle" });
      emit(sessionId, { type: "done", stopReason: result.stopReason });
    } catch (err) {
      if (cancelled()) {
        this.cancelRequested.delete(sessionId);
        saveTranscript(sessionId, t);
        return;
      }
      if (!stillThisTurn()) {
        saveTranscript(sessionId, t);
        return;
      }
      const message = err instanceof Error ? err.message : "ACP turn failed";
      const now = new Date().toISOString();
      t.messages.push({
        id: newId(),
        role: "action",
        content: message,
        createdAt: now,
      });
      const hasOutput = t.messages.some((m) => m.role === "assistant" && m.content.trim());
      // Sticky sqlite "error" paints the bottom chip forever. If grok already
      // streamed a reply, treat a trailing RPC failure as idle + a notice.
      const status = hasOutput ? "idle" : "error";
      updateSessionMeta(sessionId, { status, updatedAt: now });
      const updated = getAccessibleSummary(user.id, sessionId);
      if (updated) touchInfo(t, updated);
      saveTranscript(sessionId, t);
      emit(sessionId, { type: "status", status });
      if (hasOutput) emit(sessionId, { type: "done", stopReason: "error" });
      else emit(sessionId, { type: "error", message });
    }
  }

  async listProjects(user: SessionUser): Promise<Project[]> {
    return visibleProjects(user.id);
  }

  async listOwnedProjects(user: SessionUser): Promise<Project[]> {
    return listProjectRowsForOwner(user.id).map((row) => toProject(row, user.id));
  }


  async createProject(user: SessionUser, name: string): Promise<Project> {
    requireAccountWrite(user.role);
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 40) {
      throw new AclError(400, "project name must be 1\u201340 characters");
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/.test(trimmed)) {
      throw new AclError(400, "project name: letters, numbers, space, . _ -");
    }
    if (findOwnedProjectByName(user.id, trimmed)) {
      throw new AclError(409, "you already have a project with that name");
    }
    const id = `p-${newId()}`;
    const now = new Date().toISOString();
    const row = insertProject({
      id,
      ownerId: user.id,
      name: trimmed,
      createdAt: now,
    });
    ensureSandbox(user.id, id);
    return toProject(row, user.id);
  }


  async listSessions(user: SessionUser, projectId?: string): Promise<SessionSummary[]> {
    const list = listSessionSummaries(user.id, projectId);
    let changed = false;
    for (const s of list) {
      if (!isUntitled(s.title)) continue;
      const t = this.store.transcripts.get(s.id) ?? loadTranscript(s.id);
      const first = t?.messages.find((m) => m.role === "user");
      if (!first) continue;
      if (maybeAutotitle(s.id, s.title, first.content)) changed = true;
    }
    return changed ? listSessionSummaries(user.id, projectId) : list;
  }

  async getSession(user: SessionUser, id: string): Promise<SessionDetail | null> {
    const summary = getAccessibleSummary(user.id, id);
    if (!summary) return null;
    requireRole(summary.myRole, "read");
    const t = this.transcript(id, summary.projectCwd);
    if (isUntitled(summary.title)) {
      const first = t.messages.find((m) => m.role === "user");
      if (first) maybeAutotitle(id, summary.title, first.content);
    }
    const latest = getAccessibleSummary(user.id, id) ?? summary;
    const detail = withTranscript(latest, t);
    if (summary.myRole === "owner") {
      detail.shares = listShareRows(id);
    }
    return detail;
  }

  async createSession(
    user: SessionUser,
    projectId: string,
    title?: string,
  ): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const project = getProjectRow(projectId);
    if (!project) throw new NotFoundError("unknown project");
    if (project.owner_id !== user.id) {
      throw new AclError(403, "can only create sessions in a project you own");
    }
    const cwd = displayCwd(project.name);
    ensureSandbox(project.owner_id, project.id);
    const now = new Date().toISOString();
    const id = newId();
    ensureSessionSandbox(project.owner_id, project.id, id);
    insertSession({
      id,
      projectId,
      ownerId: user.id,
      title: title?.trim() || "New session",
      createdAt: now,
      updatedAt: now,
    });
    const t = emptyTranscript(id, cwd, now);
    this.store.transcripts.set(id, t);
    const summary = getAccessibleSummary(user.id, id);
    if (!summary) throw new Error("failed to load created session");
    return withTranscript(summary, t);
  }

  async renameSession(
    user: SessionUser,
    sessionId: string,
    title: string,
  ): Promise<SessionSummary> {
    return this.patchSession(user, sessionId, { title });
  }

  async patchSession(
    user: SessionUser,
    sessionId: string,
    prefs: { title?: string; approval?: string; model?: string; variant?: string },
  ): Promise<SessionSummary> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const now = new Date().toISOString();
    const title =
      prefs.title != null ? prefs.title.trim() || summary.title : undefined;
    updateSessionMeta(sessionId, {
      updatedAt: now,
      ...(title != null ? { title } : {}),
      ...(prefs.approval ? { approval: prefs.approval } : {}),
      ...(prefs.model ? { model: prefs.model } : {}),
      ...(prefs.variant ? { variant: prefs.variant } : {}),
    });
    const acpId = resolveAcpSessionId(sessionId, this.transcript(sessionId, summary.projectCwd));
    if (grokAcpEnabled() && acpId) {
      const client = getAcpClient();
      if (prefs.model) {
        try {
          await client.sessionSetModel(acpId, prefs.model);
        } catch (err) {
          console.error("[acp] session/set_model failed", err);
        }
      }
      if (prefs.variant) {
        try {
          await client.sessionSetMode(acpId, prefs.variant);
        } catch (err) {
          console.error("[acp] session/set_mode failed", err);
        }
      }
      // No per-session ACP permission method. sqlite/UI persist; the shared
      // grok child keeps process-level --always-approve.
    }
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    return updated;
  }

  async listArtifacts(user: SessionUser, sessionId: string): Promise<Artifact[]> {
    const detail = await this.getSession(user, sessionId);
    if (!detail) throw new NotFoundError("session not found");
    return detail.artifacts;
  }

  async sendPrompt(
    user: SessionUser,
    sessionId: string,
    prompt: string,
  ): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    t.messages.push({
      id: newId(),
      role: "user",
      content: prompt,
      createdAt: now,
    });
    maybeAutotitle(sessionId, summary.title, prompt);
    updateSessionMeta(sessionId, { status: "running", updatedAt: now });
    const seq = (this.turnSeq.get(sessionId) ?? 0) + 1;
    this.turnSeq.set(sessionId, seq);

    if (grokAcpEnabled()) {
      saveTranscript(sessionId, t);
      emit(sessionId, { type: "status", status: "running" });
      emit(sessionId, { type: "activity", phase: "thinking" });
      const project = getProjectRow(summary.projectId);
      if (!project) throw new NotFoundError("unknown project");
      const cwd = ensureSessionSandbox(project.owner_id, project.id, sessionId);
      setImmediate(() => {
        const prev = this.acpTurns.get(sessionId) ?? Promise.resolve();
        const run = prev.then(
          () => this.runAcpTurn(user, sessionId, t, prompt, cwd, seq),
          () => this.runAcpTurn(user, sessionId, t, prompt, cwd, seq),
        );
        this.acpTurns.set(sessionId, run);
      });
      const updated = getAccessibleSummary(user.id, sessionId);
      if (!updated) throw new NotFoundError("session not found");
      return withTranscript(updated, t);
    }

    let reply: string;
    let status: "idle" | "error" = "idle";

    if (grokCliEnabled()) {
      t.messages.push({
        id: newId(),
        role: "action",
        content: "grok -p (always-approve)",
        createdAt: new Date().toISOString(),
      });
      const project = getProjectRow(summary.projectId);
      if (!project) throw new NotFoundError("unknown project");
      const cwd = ensureSessionSandbox(project.owner_id, project.id, sessionId);
      try {
        const result = await runGrokPrompt(prompt, cwd);
        reply = result.text;
        if (result.code !== 0) status = "error";
      } catch (err) {
        reply = err instanceof Error ? err.message : "grok spawn failed";
        status = "error";
      }
      t.messages.push({
        id: newId(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
      });
    } else {
      const interrupted = await this.sleepInterruptible(sessionId, 450);
      if (interrupted || this.cancelRequested.get(sessionId) === seq) {
        const updated = getAccessibleSummary(user.id, sessionId);
        if (!updated) throw new NotFoundError("session not found");
        return withTranscript(updated, t);
      }

      t.messages.push({
        id: newId(),
        role: "action",
        content: "Thought for 0.6s",
        createdAt: new Date().toISOString(),
      });

      reply = REPLIES[this.replyAt % REPLIES.length];
      this.replyAt += 1;
      t.messages.push({
        id: newId(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
      });

      if (this.replyAt % 2 === 0) {
        const tool: ToolCall = {
          id: newId(),
          name: "read_file",
          status: "completed",
          createdAt: new Date().toISOString(),
          input: { path: "README.md" },
          output: "# buildinator\nmock read of README.md",
        };
        t.toolCalls.push(tool);
        t.artifacts.push({
          id: newId(),
          sessionId,
          kind: "tool_output",
          title: "read_file README.md",
          createdAt: tool.createdAt,
          content: tool.output ?? "",
        });
      }
    }

    const doneAt = new Date().toISOString();
    const tokenInput = (summary.tokenUsage?.input ?? 0) + Math.min(prompt.length, 400);
    const tokenOutput = (summary.tokenUsage?.output ?? 0) + reply.length;
    updateSessionMeta(sessionId, {
      status,
      updatedAt: doneAt,
      tokenInput,
      tokenOutput,
    });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    touchInfo(t, updated);
    saveTranscript(sessionId, t);
    return withTranscript(updated, t);
  }

  async forkSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const src = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    const id = newId();
    const ownedProjects = listProjectRowsForOwner(user.id);
    const sameProject = ownedProjects.find((p) => p.id === summary.projectId);
    const target = sameProject ?? ownedProjects[0];
    if (!target) {
      throw new AclError(403, "fork needs a project you own");
    }
    ensureSandbox(target.owner_id, target.id);
    ensureSessionSandbox(target.owner_id, target.id, id);
    insertSession({
      id,
      projectId: target.id,
      ownerId: user.id,
      title: `Fork of ${summary.title}`,
      model: summary.model,
      variant: summary.variant,
      approval: summary.approval,
      createdAt: now,
      updatedAt: now,
      tokenInput: summary.tokenUsage?.input ?? 0,
      tokenOutput: summary.tokenUsage?.output ?? 0,
      acpSessionId: null,
    });
    const copied = cloneTranscript(src);
    delete copied.acpSessionId;
    copied.messages.push({
      id: newId(),
      role: "action",
      content: `Forked from ${summary.id.slice(0, 8)}`,
      createdAt: now,
    });
    this.store.transcripts.set(id, copied);
    saveTranscript(id, copied);
    const created = getAccessibleSummary(user.id, id);
    if (!created) throw new Error("failed to load fork");
    return withTranscript(created, copied);
  }

  async resumeSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    let action = "Resumed session";
    const acpId = resolveAcpSessionId(sessionId, t);
    if (grokAcpEnabled() && acpId) {
      try {
        const client = getAcpClient();
        await client.ensureProcess();
        const project = getProjectRow(summary.projectId);
        const sandbox = project
          ? ensureSessionSandbox(project.owner_id, project.id, sessionId)
          : undefined;
        if (!client.hasLoaded(acpId)) {
          await client.sessionLoad(acpId, sandbox);
        } else if (sandbox) {
          client.bindSandbox(acpId, sandbox);
        }
        action = "Resumed ACP session";
      } catch (err) {
        console.error("[acp] resume session/load failed", acpId, err);
        action = `ACP session/load failed: ${errText(err)}`;
      }
    }
    t.messages.push({
      id: newId(),
      role: "action",
      content: action,
      createdAt: now,
    });
    updateSessionMeta(sessionId, { status: "idle", updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    saveTranscript(sessionId, t);
    return withTranscript(updated, t);
  }

  async compactSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    let action = "No live grok session to compact";
    const compactId = resolveAcpSessionId(sessionId, t);
    if (grokAcpEnabled() && compactId) {
      try {
        const client = getAcpClient();
        await client.compactConversation(compactId);
        action = "Compacted grok context";
      } catch (err) {
        action = err instanceof Error ? err.message : "Compact failed";
      }
    }
    t.messages.push({
      id: newId(),
      role: "action",
      content: action,
      createdAt: now,
    });
    updateSessionMeta(sessionId, { updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    saveTranscript(sessionId, t);
    return withTranscript(updated, t);
  }

  async rewindSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    let action = "Rewound last turn";
    let applyLocal = true;
    const rewindId = resolveAcpSessionId(sessionId, t);
    if (grokAcpEnabled() && rewindId) {
      try {
        const client = getAcpClient();
        await client.rewindLastTurn(rewindId);
      } catch (err) {
        applyLocal = false;
        action = err instanceof Error ? err.message : "Rewind failed";
      }
    }
    if (applyLocal) dropLastUserTurn(t);
    t.messages.push({
      id: newId(),
      role: "action",
      content: action,
      createdAt: now,
    });
    updateSessionMeta(sessionId, { updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    saveTranscript(sessionId, t);
    return withTranscript(updated, t);
  }

  async cancelSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    if (summary.status !== "running") {
      throw new AclError(409, "session is not running");
    }
    if (grokCliEnabled()) {
      throw new AclError(409, "cannot cancel a one-shot grok -p turn");
    }
    const t = this.transcript(sessionId, summary.projectCwd);
    const seq = this.turnSeq.get(sessionId) ?? 0;
    this.cancelRequested.set(sessionId, seq);
    this.interruptMockSleep(sessionId);
    const cancelId = resolveAcpSessionId(sessionId, t);
    if (grokAcpEnabled() && cancelId) {
      getAcpClient().sessionCancel(cancelId);
    }
    return this.settleCancelled(user, sessionId, t);
  }

  async shareSession(
    user: SessionUser,
    sessionId: string,
    username: string,
    role: ShareRole,
  ): Promise<SessionShare> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    if (role !== "read" && role !== "write") {
      throw new AclError(400, "role must be read or write");
    }
    const target = findUserByUsername(username.trim());
    if (!target) throw new NotFoundError("user not found");
    if (target.id === summary.ownerId) {
      throw new AclError(400, "owner already has access");
    }
    const now = new Date().toISOString();
    const id = newId();
    insertShare({
      id,
      sessionId,
      userId: target.id,
      role,
      createdAt: now,
    });
    const shares = listShareRows(sessionId);
    const found = shares.find((s) => s.userId === target.id);
    if (!found) throw new Error("failed to load share");
    return found;
  }

  async listShares(user: SessionUser, sessionId: string): Promise<SessionShare[]> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    return listShareRows(sessionId);
  }

  async revokeShare(
    user: SessionUser,
    sessionId: string,
    shareId: string,
  ): Promise<void> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    if (!deleteShare(sessionId, shareId)) {
      throw new NotFoundError("share not found");
    }
  }

  async revokeAllShares(user: SessionUser, sessionId: string): Promise<void> {
    requireAccountWrite(user.role);
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    deleteAllShares(sessionId);
  }

  async deleteSession(user: SessionUser, sessionId: string): Promise<void> {
    requireAccountWrite(user.role);
    const row = getSessionRow(sessionId);
    if (!row) throw new NotFoundError("session not found");
    const have = accessOf(row.owner_id, user.id, shareRoleFor(sessionId, user.id));
    requireRole(have, "owner");
    deleteSessionRow(sessionId);
    this.store.transcripts.delete(sessionId);
    deleteTranscript(sessionId);
  }

  async destroySandbox(user: SessionUser, projectId: string): Promise<void> {
    requireAccountWrite(user.role);
    const project = getProjectRow(projectId);
    if (!project) throw new NotFoundError("unknown project");
    if (project.owner_id !== user.id) {
      throw new AclError(403, "only the project owner can destroy the sandbox");
    }
    destroySandbox(project.owner_id, project.id);
  }
}

const globalForGrok = globalThis as unknown as {
  __buildinatorMock?: MockGrokBuildAdapter;
};

export function getMockAdapter(): MockGrokBuildAdapter {
  if (!globalForGrok.__buildinatorMock) {
    globalForGrok.__buildinatorMock = new MockGrokBuildAdapter();
  }
  return globalForGrok.__buildinatorMock;
}

export type { ChatMessage };
