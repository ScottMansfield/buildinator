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
