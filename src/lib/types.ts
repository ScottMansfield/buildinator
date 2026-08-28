export type SessionStatus = "idle" | "running" | "error";

export type ToolCallStatus = "pending" | "running" | "completed" | "error";

export type ArtifactKind =
  | "file"
  | "diff"
  | "plan"
  | "tool_output"
  | "terminal"
  | "info";

export interface Project {
  id: string;
  cwd: string;
  name: string;
}

export interface TokenUsage {
  input: number;
  output: number;
}

export interface SessionSummary {
  id: string;
  projectId: string;
  title: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  model: string;
  tokenUsage?: TokenUsage;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
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

export interface SessionDetail extends SessionSummary {
  messages: ChatMessage[];
  toolCalls: ToolCall[];
  artifacts: Artifact[];
}

export interface GrokBuildAdapter {
  listProjects(): Promise<Project[]>;
  listSessions(projectId?: string): Promise<SessionSummary[]>;
  getSession(id: string): Promise<SessionDetail | null>;
  createSession(projectId: string, title?: string): Promise<SessionDetail>;
  sendPrompt(sessionId: string, prompt: string): Promise<SessionDetail>;
  listArtifacts(sessionId: string): Promise<Artifact[]>;
  renameSession(sessionId: string, title: string): Promise<SessionSummary>;
}
