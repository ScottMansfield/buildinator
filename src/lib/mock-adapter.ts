import { accessOf, requireRole } from "./acl";
import {
  deleteAllShares,
  deleteSessionRow,
  deleteShare,
  findUserByUsername,
  getAccessibleSummary,
  getProjectRow,
  getSessionRow,
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
import { destroySandbox, displayCwd, ensureSandbox } from "./sandbox";
import {
  cloneTranscript,
  emptyTranscript,
  seedTranscripts,
  type Transcript,
} from "./seed-transcripts";
import type {
  Artifact,
  GrokBuildAdapter,
  Project,
  SessionDetail,
  SessionShare,
  SessionSummary,
  SessionUser,
  ShareRole,
  ToolCall,
} from "./types";

const REPLIES = [
  "I'll take a look at the current session layout and sketch a three-pane shell around it.",
  "Mock adapter accepted the prompt. In v1 this would go out as ACP session/prompt.",
  "Noted. I would grep the repo, then propose a patch — here is a plausible next step.",
  "Done in the mock. Artifacts pane should pick up any tool output I just invented.",
];

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
  const clone = cloneTranscript(t);
  return {
    ...summary,
    messages: clone.messages,
    toolCalls: clone.toolCalls,
    artifacts: clone.artifacts,
  };
}

export class MockGrokBuildAdapter implements GrokBuildAdapter {
  private store: Store;
  private replyAt = 0;

  constructor() {
    this.store = { transcripts: seedTranscripts() };
  }

  private transcript(id: string, cwd: string): Transcript {
    let t = this.store.transcripts.get(id);
    if (!t) {
      t = emptyTranscript(id, cwd, new Date().toISOString());
      this.store.transcripts.set(id, t);
    }
    return t;
  }

  async listProjects(user: SessionUser): Promise<Project[]> {
    return visibleProjects(user.id);
  }

  async listOwnedProjects(user: SessionUser): Promise<Project[]> {
    return listProjectRowsForOwner(user.id).map((row) => toProject(row, user.id));
  }

  async listSessions(user: SessionUser, projectId?: string): Promise<SessionSummary[]> {
    return listSessionSummaries(user.id, projectId);
  }

  async getSession(user: SessionUser, id: string): Promise<SessionDetail | null> {
    const summary = getAccessibleSummary(user.id, id);
    if (!summary) return null;
    requireRole(summary.myRole, "read");
    const t = this.transcript(id, summary.projectCwd);
    const detail = withTranscript(summary, t);
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
    const project = getProjectRow(projectId);
    if (!project) throw new NotFoundError("unknown project");
    if (project.owner_id !== user.id) {
      throw new AclError(403, "can only create sessions in a project you own");
    }
    const cwd = displayCwd(project.name);
    ensureSandbox(project.owner_id, project.id);
    const now = new Date().toISOString();
    const id = newId();
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
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const next = title.trim() || summary.title;
    updateSessionMeta(sessionId, { title: next, updatedAt: new Date().toISOString() });
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
    updateSessionMeta(sessionId, { status: "running", updatedAt: now });

    await new Promise((r) => setTimeout(r, 450));

    t.messages.push({
      id: newId(),
      role: "action",
      content: "Thought for 0.6s",
      createdAt: new Date().toISOString(),
    });

    const reply = REPLIES[this.replyAt % REPLIES.length];
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

    const doneAt = new Date().toISOString();
    const tokenInput = (summary.tokenUsage?.input ?? 0) + Math.min(prompt.length, 400);
    const tokenOutput = (summary.tokenUsage?.output ?? 0) + reply.length;
    updateSessionMeta(sessionId, {
      status: "idle",
      updatedAt: doneAt,
      tokenInput,
      tokenOutput,
    });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    touchInfo(t, updated);
    return withTranscript(updated, t);
  }

  async forkSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
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
    });
    const copied = cloneTranscript(src);
    copied.messages.push({
      id: newId(),
      role: "action",
      content: `Forked from ${summary.id.slice(0, 8)}`,
      createdAt: now,
    });
    this.store.transcripts.set(id, copied);
    const created = getAccessibleSummary(user.id, id);
    if (!created) throw new Error("failed to load fork");
    return withTranscript(created, copied);
  }

  async resumeSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    t.messages.push({
      id: newId(),
      role: "action",
      content: "Resumed session",
      createdAt: now,
    });
    updateSessionMeta(sessionId, { status: "idle", updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    return withTranscript(updated, t);
  }

  async compactSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    t.messages.push({
      id: newId(),
      role: "action",
      content: "Compacted transcript (stub)",
      createdAt: now,
    });
    updateSessionMeta(sessionId, { updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    return withTranscript(updated, t);
  }

  async rewindSession(user: SessionUser, sessionId: string): Promise<SessionDetail> {
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "write");
    const t = this.transcript(sessionId, summary.projectCwd);
    const now = new Date().toISOString();
    let removed = 0;
    for (let i = t.messages.length - 1; i >= 0 && removed < 2; i--) {
      if (t.messages[i].role === "user" || t.messages[i].role === "assistant") {
        t.messages.splice(i, 1);
        removed += 1;
      }
    }
    t.messages.push({
      id: newId(),
      role: "action",
      content: "Rewound to previous user turn (stub)",
      createdAt: now,
    });
    updateSessionMeta(sessionId, { updatedAt: now });
    const updated = getAccessibleSummary(user.id, sessionId);
    if (!updated) throw new NotFoundError("session not found");
    return withTranscript(updated, t);
  }

  async shareSession(
    user: SessionUser,
    sessionId: string,
    username: string,
    role: ShareRole,
  ): Promise<SessionShare> {
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
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    if (!deleteShare(sessionId, shareId)) {
      throw new NotFoundError("share not found");
    }
  }

  async revokeAllShares(user: SessionUser, sessionId: string): Promise<void> {
    const summary = getAccessibleSummary(user.id, sessionId);
    if (!summary) throw new NotFoundError("session not found");
    requireRole(summary.myRole, "owner");
    deleteAllShares(sessionId);
  }

  async deleteSession(user: SessionUser, sessionId: string): Promise<void> {
    const row = getSessionRow(sessionId);
    if (!row) throw new NotFoundError("session not found");
    const have = accessOf(row.owner_id, user.id, shareRoleFor(sessionId, user.id));
    requireRole(have, "owner");
    deleteSessionRow(sessionId);
    this.store.transcripts.delete(sessionId);
  }

  async destroySandbox(user: SessionUser, projectId: string): Promise<void> {
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
