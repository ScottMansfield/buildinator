export type SessionStatus = "idle" | "running" | "error";

export type ToolCallStatus = "pending" | "running" | "completed" | "error";

export type ArtifactKind =
  | "file"
  | "diff"
  | "plan"
  | "tool_output"
  | "terminal"
  | "info";

export type AccessRole = "read" | "write" | "owner";

export type ShareRole = "read" | "write";

export type MessageRole = "user" | "assistant" | "system" | "action" | "thought";

export interface SessionUser {
  id: string;
  username: string;
}

export interface ProjectLink {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
}

export interface Project {
  id: string;
  ownerId: string;
  name: string;
  cwd: string;
  sandboxPath: string;
  owned: boolean;
  links: ProjectLink[];
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  projectName: string;
  projectCwd: string;
  ownerId: string;
  ownerUsername: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  model: string;
  variant: string;
  approval: string;
  tokenUsage?: TokenUsage;
  myRole: AccessRole;
  sharedBy?: string;
}

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  createdAt: string;
}

export interface ToolCall {
  id: string;
  name: string;
  status: ToolCallStatus;
  input: Record<string, string>;
  output?: string;
  createdAt: string;
}

export interface Artifact {
  id: string;
  sessionId: string;
  kind: ArtifactKind;
  title: string;
  content: string;
  createdAt: string;
}

export interface SessionShare {
  id: string;
  sessionId: string;
  userId: string;
  username: string;
  role: ShareRole;
  createdAt: string;
}

export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  artifacts: Artifact[];
  shares?: SessionShare[];
}

export type SessionStreamEvent =
  | { type: "message"; id: string; role: "assistant"; content: string }
  | { type: "thought"; id: string; content: string }
  | { type: "tool"; tool: ToolCall }
  | { type: "status"; status: SessionStatus }
  | { type: "title"; title: string }
  | { type: "done"; stopReason?: string }
  | { type: "error"; message: string };

export interface GrokBuildAdapter {
  listProjects(user: SessionUser): Promise<Project[]>;
  listOwnedProjects(user: SessionUser): Promise<Project[]>;
  createProject(user: SessionUser, name: string): Promise<Project>;
  listSessions(user: SessionUser, projectId?: string): Promise<SessionSummary[]>;
  getSession(user: SessionUser, id: string): Promise<SessionDetail | null>;
  createSession(
    user: SessionUser,
    projectId: string,
    title?: string,
  ): Promise<SessionDetail>;
  sendPrompt(
    user: SessionUser,
    sessionId: string,
    prompt: string,
  ): Promise<SessionDetail>;
  listArtifacts(user: SessionUser, sessionId: string): Promise<Artifact[]>;
  renameSession(
    user: SessionUser,
    sessionId: string,
    title: string,
  ): Promise<SessionSummary>;
  forkSession(user: SessionUser, sessionId: string): Promise<SessionDetail>;
  resumeSession(user: SessionUser, sessionId: string): Promise<SessionDetail>;
  compactSession(user: SessionUser, sessionId: string): Promise<SessionDetail>;
  rewindSession(user: SessionUser, sessionId: string): Promise<SessionDetail>;
  cancelSession(user: SessionUser, sessionId: string): Promise<SessionDetail>;
  shareSession(
    user: SessionUser,
    sessionId: string,
    username: string,
    role: ShareRole,
  ): Promise<SessionShare>;
  listShares(user: SessionUser, sessionId: string): Promise<SessionShare[]>;
  revokeShare(
    user: SessionUser,
    sessionId: string,
    shareId: string,
  ): Promise<void>;
  revokeAllShares(user: SessionUser, sessionId: string): Promise<void>;
  deleteSession(user: SessionUser, sessionId: string): Promise<void>;
  destroySandbox(user: SessionUser, projectId: string): Promise<void>;
}
