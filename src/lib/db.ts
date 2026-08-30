import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { hashPassword } from "./passwords";
import {
  dataRoot,
  displayCwd,
  ensurePersistenceDirs,
  ensureSandbox,
  linkDep,
  sandboxPath,
  setProjectLinkLister,
} from "./sandbox";
import { parseUserRole } from "./acl";
import { AclError, NotFoundError } from "./errors";
import type {
  AccessRole,
  ManagedUser,
  Project,
  SessionShare,
  SessionSummary,
  SessionUser,
  ShareRole,
  UserRole,
} from "./types";

export const USER_SCOTT = "u-scott";
export const USER_CRAIG = "u-craig";
export const PROJ_BUILD = "p-buildinator";
export const PROJ_INFRA = "p-infra";

export const SESSION_RICH = "0193b8e0-4a11-7c00-8000-000000000001";
export const SESSION_AUTH = "0193b8e0-4a11-7c00-8000-000000000002";
export const SESSION_TUI = "0193b8e0-4a11-7c00-8000-000000000003";
export const SESSION_FLY = "0193b8e0-4a11-7c00-8000-000000000011";
export const SESSION_NGINX = "0193b8e0-4a11-7c00-8000-000000000012";
export const SESSION_TAIL = "0193b8e0-4a11-7c00-8000-000000000013";

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  disabled: number;
  created_at: string;
};

export type ProjectRow = {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
};

export type SessionRow = {
  id: string;
  project_id: string;
  owner_id: string;
  title: string;
  status: string;
  model: string;
  variant: string;
  approval: string;
  created_at: string;
  updated_at: string;
  token_input: number;
  token_output: number;
  acp_session_id: string | null;
};

export type ShareRow = {
  id: string;
  session_id: string;
  user_id: string;
  role: ShareRole;
  created_at: string;
};

type SessionListRow = SessionRow & {
  project_name: string;
  owner_username: string;
  my_role: AccessRole;
  shared_by: string | null;
};

const globalForDb = globalThis as unknown as { __buildinatorDb?: InstanceType<typeof Database> };

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function migrate(db: InstanceType<typeof Database>) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'write' CHECK(role IN ('admin','write','read')),
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS project_links (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      linked_project_id TEXT NOT NULL REFERENCES projects(id),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(project_id, name)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL REFERENCES projects(id),
      owner_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'idle',
      model TEXT NOT NULL DEFAULT 'grok-4.6',
      variant TEXT NOT NULL DEFAULT 'high',
      approval TEXT NOT NULL DEFAULT 'always-approve',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      token_input INTEGER NOT NULL DEFAULT 0,
      token_output INTEGER NOT NULL DEFAULT 0,
      acp_session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS session_shares (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('read','write')),
      created_at TEXT NOT NULL,
      UNIQUE(session_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_owner ON sessions(owner_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
    CREATE INDEX IF NOT EXISTS idx_shares_user ON session_shares(user_id);
  `);

  // Existing WAL DBs were created without acp_session_id. ALTER is a no-op
  // once the column exists (CREATE TABLE IF NOT EXISTS does not add columns).
  const sessionCols = db.prepare("PRAGMA table_info(sessions)").all() as Array<{ name: string }>;
  if (!sessionCols.some((c) => c.name === "acp_session_id")) {
    db.exec("ALTER TABLE sessions ADD COLUMN acp_session_id TEXT");
  }

  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "role")) {
    db.exec(
      "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'write' CHECK(role IN ('admin','write','read'))",
    );
  }
  if (!userCols.some((c) => c.name === "disabled")) {
    db.exec("ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  }
  db.prepare(
    "UPDATE users SET role = 'admin' WHERE username = 'scott' COLLATE NOCASE",
  ).run();

  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) {
    deleteGuestUser(db);
  }
}

function ensureCraigUser(db: InstanceType<typeof Database>) {
  const existing = db
    .prepare("SELECT id FROM users WHERE username = 'craig' COLLATE NOCASE")
    .get() as { id: string } | undefined;
  if (existing) return;
  db.prepare(
    "INSERT INTO users (id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, 'write', 0, ?)",
  ).run(USER_CRAIG, "craig", hashPassword("buildinator"), new Date().toISOString());
}

function deleteGuestUser(db: InstanceType<typeof Database>) {
  const guests = db
    .prepare("SELECT id FROM users WHERE username = 'guest' COLLATE NOCASE")
    .all() as Array<{ id: string }>;
  if (guests.length === 0) return;
  const run = db.transaction(() => {
    for (const g of guests) {
      db.prepare("DELETE FROM session_shares WHERE user_id = ?").run(g.id);
      const sessions = db
        .prepare("SELECT id FROM sessions WHERE owner_id = ?")
        .all(g.id) as Array<{ id: string }>;
      for (const s of sessions) {
        db.prepare("DELETE FROM session_shares WHERE session_id = ?").run(s.id);
        db.prepare("DELETE FROM sessions WHERE id = ?").run(s.id);
      }
      const projects = db
        .prepare("SELECT id FROM projects WHERE owner_id = ?")
        .all(g.id) as Array<{ id: string }>;
      for (const p of projects) {
        db.prepare(
          "DELETE FROM project_links WHERE project_id = ? OR linked_project_id = ?",
        ).run(p.id, p.id);
        db.prepare("DELETE FROM projects WHERE id = ?").run(p.id);
      }
      db.prepare("DELETE FROM users WHERE id = ?").run(g.id);
    }
  });
  run();
}

function seed(db: InstanceType<typeof Database>) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number };
  if (count.n > 0) {
    ensureCraigUser(db);
    ensureSandbox(USER_SCOTT, PROJ_BUILD);
    ensureSandbox(USER_SCOTT, PROJ_INFRA);
    try {
      linkDep(USER_SCOTT, PROJ_BUILD, "infra", USER_SCOTT, PROJ_INFRA);
    } catch {
      // symlink may already exist
    }
    return;
  }

  const now = new Date().toISOString();
  const insertUser = db.prepare(
    "INSERT INTO users (id, username, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  insertUser.run(USER_SCOTT, "scott", hashPassword("buildinator"), "admin", now);
  insertUser.run(USER_CRAIG, "craig", hashPassword("buildinator"), "write", now);

  const insertProject = db.prepare(
    "INSERT INTO projects (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)",
  );
  insertProject.run(PROJ_BUILD, USER_SCOTT, "buildinator", now);
  insertProject.run(PROJ_INFRA, USER_SCOTT, "infra", now);

  db.prepare(
    "INSERT INTO project_links (id, project_id, linked_project_id, name, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run("pl-build-infra", PROJ_BUILD, PROJ_INFRA, "infra", now);

  const insertSession = db.prepare(`
    INSERT INTO sessions (
      id, project_id, owner_id, title, status, model, variant, approval,
      created_at, updated_at, token_input, token_output
    ) VALUES (?, ?, ?, ?, ?, 'grok-4.6', 'high', 'always-approve', ?, ?, ?, ?)
  `);

  insertSession.run(
    SESSION_RICH, PROJ_BUILD, USER_SCOTT,
    "Three-pane session manager UI", "idle",
    hoursAgo(30), hoursAgo(0.4), 18420, 6230,
  );
  insertSession.run(
    SESSION_AUTH, PROJ_BUILD, USER_SCOTT,
    "Cookie JWT auth for the web UI", "idle",
    hoursAgo(20), hoursAgo(8), 4100, 1800,
  );
  insertSession.run(
    SESSION_TUI, PROJ_BUILD, USER_SCOTT,
    "TUI skin over the same routes", "running",
    hoursAgo(5), hoursAgo(0.05), 2200, 900,
  );
  insertSession.run(
    SESSION_FLY, PROJ_INFRA, USER_SCOTT,
    "Bootstrap grok host on Fly.io", "idle",
    hoursAgo(72), hoursAgo(12), 8000, 2400,
  );
  insertSession.run(
    SESSION_NGINX, PROJ_INFRA, USER_SCOTT,
    "nginx ACP reverse proxy", "error",
    hoursAgo(40), hoursAgo(3), 1500, 400,
  );
  insertSession.run(
    SESSION_TAIL, PROJ_INFRA, USER_SCOTT,
    "Tailscale ACL for the grok box", "idle",
    hoursAgo(96), hoursAgo(50), 0, 0,
  );

  ensureSandbox(USER_SCOTT, PROJ_BUILD);
  ensureSandbox(USER_SCOTT, PROJ_INFRA);
  linkDep(USER_SCOTT, PROJ_BUILD, "infra", USER_SCOTT, PROJ_INFRA);

  const marker = path.join(sandboxPath(USER_SCOTT, PROJ_BUILD), "README");
  fs.writeFileSync(
    marker,
    "buildinator sandbox. Cross-project dep mounted at deps/infra.\n",
    "utf8",
  );
}

export function getDb(): InstanceType<typeof Database> {
  if (!globalForDb.__buildinatorDb) {
    ensurePersistenceDirs();
    const file = path.join(dataRoot(), "buildinator.sqlite");
    const db = new Database(file);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    seed(db);
    globalForDb.__buildinatorDb = db;
  }
  return globalForDb.__buildinatorDb;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return getDb()
    .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
    .get(username) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function toSessionUser(row: UserRow): SessionUser | null {
  if (row.disabled) return null;
  return {
    id: row.id,
    username: row.username,
    role: parseUserRole(row.role),
  };
}

function toManagedUser(row: UserRow): ManagedUser {
  return {
    id: row.id,
    username: row.username,
    role: parseUserRole(row.role),
    disabled: Boolean(row.disabled),
    createdAt: row.created_at,
  };
}

export function listManagedUsers(): ManagedUser[] {
  const rows = getDb()
    .prepare("SELECT * FROM users ORDER BY username COLLATE NOCASE")
    .all() as UserRow[];
  return rows.map(toManagedUser);
}

export function countActiveAdmins(exceptId?: string): number {
  if (exceptId) {
    const row = getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?",
      )
      .get(exceptId) as { n: number };
    return row.n;
  }
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0")
    .get() as { n: number };
  return row.n;
}

function wouldDropLastAdmin(current: UserRow, nextRole: UserRole, nextDisabled: boolean): boolean {
  const wasActiveAdmin = parseUserRole(current.role) === "admin" && !current.disabled;
  const staysActiveAdmin = nextRole === "admin" && !nextDisabled;
  return wasActiveAdmin && !staysActiveAdmin && countActiveAdmins(current.id) === 0;
}

export function insertUserRow(row: {
  id: string;
  username: string;
  passwordHash: string;
  role: UserRole;
  createdAt: string;
}): ManagedUser {
  getDb()
    .prepare(
      "INSERT INTO users (id, username, password_hash, role, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    )
    .run(row.id, row.username, row.passwordHash, row.role, row.createdAt);
  const created = findUserById(row.id);
  if (!created) throw new Error("failed to load created user");
  return toManagedUser(created);
}

export function updateUserRow(
  id: string,
  patch: { role?: UserRole; passwordHash?: string; disabled?: boolean },
): ManagedUser {
  const current = findUserById(id);
  if (!current) throw new NotFoundError("user not found");
  const nextRole = patch.role ?? parseUserRole(current.role);
  const nextDisabled = patch.disabled ?? Boolean(current.disabled);
  if (wouldDropLastAdmin(current, nextRole, nextDisabled)) {
    throw new AclError(400, "cannot remove the last admin");
  }
  getDb()
    .prepare("UPDATE users SET role = ?, password_hash = ?, disabled = ? WHERE id = ?")
    .run(
      nextRole,
      patch.passwordHash ?? current.password_hash,
      nextDisabled ? 1 : 0,
      id,
    );
  const updated = findUserById(id);
  if (!updated) throw new NotFoundError("user not found");
  return toManagedUser(updated);
}

export function deleteUserRow(id: string): void {
  const current = findUserById(id);
  if (!current) throw new NotFoundError("user not found");
  if (wouldDropLastAdmin(current, "read", true)) {
    throw new AclError(400, "cannot remove the last admin");
  }
  const owned = getDb()
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects WHERE owner_id = ?) +
         (SELECT COUNT(*) FROM sessions WHERE owner_id = ?) AS n`,
    )
    .get(id, id) as { n: number };
  if (owned.n > 0) {
    throw new AclError(409, "user owns projects or sessions; disable instead");
  }
  getDb().prepare("DELETE FROM users WHERE id = ?").run(id);
}

export function getProjectRow(id: string): ProjectRow | undefined {
  return getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
}

export function findOwnedProjectByName(ownerId: string, name: string): ProjectRow | undefined {
  return getDb()
    .prepare(
      "SELECT * FROM projects WHERE owner_id = ? AND name = ? COLLATE NOCASE",
    )
    .get(ownerId, name) as ProjectRow | undefined;
}

export function insertProject(row: {
  id: string;
  ownerId: string;
  name: string;
  createdAt: string;
}): ProjectRow {
  getDb()
    .prepare(
      "INSERT INTO projects (id, owner_id, name, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(row.id, row.ownerId, row.name, row.createdAt);
  const created = getProjectRow(row.id);
  if (!created) throw new Error("failed to load created project");
  return created;
}

export function listProjectRowsForOwner(ownerId: string): ProjectRow[] {
  return getDb()
    .prepare("SELECT * FROM projects WHERE owner_id = ? ORDER BY name")
    .all(ownerId) as ProjectRow[];
}

function linksFor(projectId: string): Project["links"] {
  return getDb()
    .prepare(
      `SELECT pl.id, pl.name, pl.linked_project_id AS projectId, p.name AS projectName
       FROM project_links pl
       JOIN projects p ON p.id = pl.linked_project_id
       WHERE pl.project_id = ?`,
    )
    .all(projectId) as Project["links"];
}

export function listProjectLinkTargets(projectId: string): Array<{
  name: string;
  targetOwnerId: string;
  targetProjectId: string;
}> {
  const out: Array<{ name: string; targetOwnerId: string; targetProjectId: string }> = [];
  for (const link of linksFor(projectId)) {
    const target = getProjectRow(link.projectId);
    if (!target) continue;
    out.push({
      name: link.name,
      targetOwnerId: target.owner_id,
      targetProjectId: target.id,
    });
  }
  return out;
}

setProjectLinkLister(listProjectLinkTargets);

export function toProject(row: ProjectRow, userId: string): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    cwd: displayCwd(row.name),
    sandboxPath: sandboxPath(row.owner_id, row.id),
    owned: row.owner_id === userId,
    links: linksFor(row.id),
  };
}

export function getSessionRow(id: string): SessionRow | undefined {
  return getDb().prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
}

export function shareRoleFor(sessionId: string, userId: string): ShareRole | null {
  const row = getDb()
    .prepare("SELECT role FROM session_shares WHERE session_id = ? AND user_id = ?")
    .get(sessionId, userId) as { role: ShareRole } | undefined;
  return row?.role ?? null;
}

const LIST_SQL = `
  SELECT
    s.*,
    p.name AS project_name,
    u.username AS owner_username,
    CASE
      WHEN s.owner_id = @userId THEN 'owner'
      WHEN sh.role = 'write' THEN 'write'
      WHEN sh.role = 'read' THEN 'read'
    END AS my_role,
    CASE WHEN s.owner_id != @userId THEN u.username ELSE NULL END AS shared_by
  FROM sessions s
  JOIN projects p ON p.id = s.project_id
  JOIN users u ON u.id = s.owner_id
  LEFT JOIN session_shares sh ON sh.session_id = s.id AND sh.user_id = @userId
  WHERE s.owner_id = @userId OR sh.user_id = @userId
`;

export function listSessionSummaries(userId: string, projectId?: string): SessionSummary[] {
  const sql = projectId ? `${LIST_SQL} AND s.project_id = @projectId ORDER BY s.updated_at DESC`
    : `${LIST_SQL} ORDER BY s.updated_at DESC`;
  const rows = getDb().prepare(sql).all({ userId, projectId }) as SessionListRow[];
  return rows.map(summaryFromListRow);
}

export function summaryFromListRow(row: SessionListRow): SessionSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    projectCwd: displayCwd(row.project_name),
    ownerId: row.owner_id,
    ownerUsername: row.owner_username,
    title: row.title,
    status: row.status as SessionSummary["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    variant: row.variant,
    approval: row.approval,
    tokenUsage: { input: row.token_input, output: row.token_output },
    myRole: row.my_role,
    sharedBy: row.shared_by ?? undefined,
  };
}

export function getAccessibleSummary(userId: string, sessionId: string): SessionSummary | undefined {
  const row = getDb()
    .prepare(`${LIST_SQL} AND s.id = @sessionId`)
    .get({ userId, sessionId }) as SessionListRow | undefined;
  return row ? summaryFromListRow(row) : undefined;
}

export function insertSession(row: {
  id: string;
  projectId: string;
  ownerId: string;
  title: string;
  status?: string;
  model?: string;
  variant?: string;
  approval?: string;
  createdAt: string;
  updatedAt: string;
  tokenInput?: number;
  tokenOutput?: number;
  acpSessionId?: string | null;
}): void {
  getDb()
    .prepare(
      `INSERT INTO sessions (
        id, project_id, owner_id, title, status, model, variant, approval,
        created_at, updated_at, token_input, token_output, acp_session_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.id,
      row.projectId,
      row.ownerId,
      row.title,
      row.status ?? "idle",
      row.model ?? "grok-4.6",
      row.variant ?? "high",
      row.approval ?? "always-approve",
      row.createdAt,
      row.updatedAt,
      row.tokenInput ?? 0,
      row.tokenOutput ?? 0,
      row.acpSessionId ?? null,
    );
}

export function updateSessionMeta(
  id: string,
  patch: Partial<{
    title: string;
    status: string;
    updatedAt: string;
    tokenInput: number;
    tokenOutput: number;
    acpSessionId: string | null;
    model: string;
    variant: string;
    approval: string;
  }>,
): void {
  const current = getSessionRow(id);
  if (!current) return;
  const acpSessionId =
    patch.acpSessionId === undefined ? current.acp_session_id : patch.acpSessionId;
  getDb()
    .prepare(
      `UPDATE sessions SET title = ?, status = ?, updated_at = ?, token_input = ?, token_output = ?, acp_session_id = ?, model = ?, variant = ?, approval = ? WHERE id = ?`,
    )
    .run(
      patch.title ?? current.title,
      patch.status ?? current.status,
      patch.updatedAt ?? current.updated_at,
      patch.tokenInput ?? current.token_input,
      patch.tokenOutput ?? current.token_output,
      acpSessionId,
      patch.model ?? current.model,
      patch.variant ?? current.variant,
      patch.approval ?? current.approval,
      id,
    );
}

export function deleteSessionRow(id: string): void {
  getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id);
}

export function listShareRows(sessionId: string): SessionShare[] {
  return getDb()
    .prepare(
      `SELECT sh.id, sh.session_id AS sessionId, sh.user_id AS userId,
              u.username, sh.role, sh.created_at AS createdAt
       FROM session_shares sh
       JOIN users u ON u.id = sh.user_id
       WHERE sh.session_id = ?
       ORDER BY u.username`,
    )
    .all(sessionId) as SessionShare[];
}

export function insertShare(row: {
  id: string;
  sessionId: string;
  userId: string;
  role: ShareRole;
  createdAt: string;
}): void {
  getDb()
    .prepare(
      `INSERT INTO session_shares (id, session_id, user_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(row.id, row.sessionId, row.userId, row.role, row.createdAt);
}

export function deleteShare(sessionId: string, shareId: string): boolean {
  const res = getDb()
    .prepare("DELETE FROM session_shares WHERE session_id = ? AND id = ?")
    .run(sessionId, shareId);
  return res.changes > 0;
}

export function deleteAllShares(sessionId: string): void {
  getDb().prepare("DELETE FROM session_shares WHERE session_id = ?").run(sessionId);
}

export function visibleProjects(userId: string): Project[] {
  const owned = listProjectRowsForOwner(userId);
  const extra = getDb()
    .prepare(
      `SELECT DISTINCT p.*
       FROM projects p
       JOIN sessions s ON s.project_id = p.id
       LEFT JOIN session_shares sh ON sh.session_id = s.id AND sh.user_id = ?
       WHERE p.owner_id != ?
         AND (s.owner_id = ? OR sh.user_id = ?)`,
    )
    .all(userId, userId, userId, userId) as ProjectRow[];
  const seen = new Set<string>();
  const out: Project[] = [];
  for (const row of [...owned, ...extra]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(toProject(row, userId));
  }
  return out;
}
