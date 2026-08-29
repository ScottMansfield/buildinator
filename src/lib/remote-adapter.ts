import type {
  Artifact,
  GrokBuildAdapter,
  Project,
  SessionDetail,
  SessionShare,
  SessionSummary,
  SessionUser,
  ShareRole,
} from "./types";

/**
 * Remote grok ACP stub.
 *
 * Grok / ACP MUST bind loopback only:
 *   GROK_ACP_URL=http://127.0.0.1:<port>
 * Never publish that port. The HTTPS web UI is the only internet-facing
 * socket. Local IPC can stay ACP-on-loopback; this adapter will speak
 * session/new, session/load, session/prompt, session/update plus xAI
 * extensions (rename, rewind, compact, fork) once spawn is wired.
 *
 * GROK_REMOTE_URL is accepted as a fallback alias.
 */
export class RemoteGrokAdapter implements GrokBuildAdapter {
  constructor(private readonly acpUrl?: string) {}

  private fail(): never {
    const where = this.acpUrl ?? "(no GROK_ACP_URL)";
    throw new Error(
      `RemoteGrokAdapter is not implemented. Grok ACP is a loopback sidecar ` +
        `(${where}) and is not spawned yet. Set GROK_ADAPTER=mock.`,
    );
  }

  listProjects(_user: SessionUser): Promise<Project[]> {
    return this.fail();
  }
  listOwnedProjects(_user: SessionUser): Promise<Project[]> {
    return this.fail();
  }
  createProject(_user: SessionUser, _name: string): Promise<Project> {
    return this.fail();
  }
  listSessions(_user: SessionUser, _projectId?: string): Promise<SessionSummary[]> {
    return this.fail();
  }
  getSession(_user: SessionUser, _id: string): Promise<SessionDetail | null> {
    return this.fail();
  }
  createSession(
    _user: SessionUser,
    _projectId: string,
    _title?: string,
  ): Promise<SessionDetail> {
    return this.fail();
  }
  sendPrompt(
    _user: SessionUser,
    _sessionId: string,
    _prompt: string,
  ): Promise<SessionDetail> {
    return this.fail();
  }
  listArtifacts(_user: SessionUser, _sessionId: string): Promise<Artifact[]> {
    return this.fail();
  }
  renameSession(
    _user: SessionUser,
    _sessionId: string,
    _title: string,
  ): Promise<SessionSummary> {
    return this.fail();
  }
  forkSession(_user: SessionUser, _sessionId: string): Promise<SessionDetail> {
    return this.fail();
  }
  resumeSession(_user: SessionUser, _sessionId: string): Promise<SessionDetail> {
    return this.fail();
  }
  compactSession(_user: SessionUser, _sessionId: string): Promise<SessionDetail> {
    return this.fail();
  }
  rewindSession(_user: SessionUser, _sessionId: string): Promise<SessionDetail> {
    return this.fail();
  }
  shareSession(
    _user: SessionUser,
    _sessionId: string,
    _username: string,
    _role: ShareRole,
  ): Promise<SessionShare> {
    return this.fail();
  }
  listShares(_user: SessionUser, _sessionId: string): Promise<SessionShare[]> {
    return this.fail();
  }
  revokeShare(
    _user: SessionUser,
    _sessionId: string,
    _shareId: string,
  ): Promise<void> {
    return this.fail();
  }
  revokeAllShares(_user: SessionUser, _sessionId: string): Promise<void> {
    return this.fail();
  }
  deleteSession(_user: SessionUser, _sessionId: string): Promise<void> {
    return this.fail();
  }
  destroySandbox(_user: SessionUser, _projectId: string): Promise<void> {
    return this.fail();
  }
}
