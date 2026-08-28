import type {
  Artifact,
  GrokBuildAdapter,
  Project,
  SessionDetail,
  SessionSummary,
} from "./types";

/**
 * v1 stub. Will speak Agent Client Protocol to a remote grok host:
 *   session/new, session/load, session/prompt, session/update
 * plus xAI extensions (rename, rewind, compact, fork).
 *
 * Transport is still open (stdio ACP vs HTTP grok server vs scanning
 * the remote session directory). See QUESTIONS.md.
 */
export class RemoteGrokAdapter implements GrokBuildAdapter {
  constructor(private readonly remoteUrl?: string) {}

  private fail(): never {
    const where = this.remoteUrl ?? "(no GROK_REMOTE_URL)";
    throw new Error(
      `RemoteGrokAdapter is not implemented in v0. ` +
        `Set GROK_ADAPTER=mock or implement ACP against ${where}.`,
    );
  }

  listProjects(): Promise<Project[]> {
    return this.fail();
  }
  listSessions(_projectId?: string): Promise<SessionSummary[]> {
    return this.fail();
  }
  getSession(_id: string): Promise<SessionDetail | null> {
    return this.fail();
  }
  createSession(_projectId: string, _title?: string): Promise<SessionDetail> {
    return this.fail();
  }
  sendPrompt(_sessionId: string, _prompt: string): Promise<SessionDetail> {
    return this.fail();
  }
  listArtifacts(_sessionId: string): Promise<Artifact[]> {
    return this.fail();
  }
  renameSession(_sessionId: string, _title: string): Promise<SessionSummary> {
    return this.fail();
  }
}
